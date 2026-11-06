"""Writes the phone card: Statly's own deck, note type and note, and nothing else.

Each of these functions runs on Anki's collection worker, and only through the gate in
``modules/changes``, which checks the permission first.

People can edit the card on a phone like any other, so a sync may bring a broken one back. The
desktop then restores exactly this card and leaves everything else alone.
"""

from __future__ import annotations

import base64
import json
from typing import Any, cast

from anki.collection import Collection
from anki.notes import Note

from ...core.reader import STATLY_DECK_NAME as DECK_NAME
from ...core.reader import STATLY_NOTE_GUID as NOTE_GUID
from ...core.reader import CollectionReader
from ..mobile.card import MARKER, card_styles, front_template

NOTETYPE_NAME = "Statly Dashboard"
PRESET_NAME = "Statly Dashboard"
TITLE = "Statly"
PERMISSION = "mobile.card"
_NEW_CARDS_PER_DAY = 9999
_QUEUE_NEW = 0
_BACK_TEMPLATE = "{{FrontSide}}"
_FIELDS = ("Title", "Data")
_SNAPSHOT_KEYS = {"blocks", "tablet", "phone"}


def _note_ids(collection: Collection) -> list[Any]:
    return CollectionReader(collection).column(
        "SELECT id FROM notes WHERE guid = ? ORDER BY mod DESC", NOTE_GUID
    )


def is_set_up(collection: Collection) -> bool:
    return bool(_note_ids(collection))


def _is_ours(notetype: Any) -> bool:
    """Repairs may overwrite this note type, so a look-alike of the user's must never pass.

    A damaged template loses its marker, which is why the exact name counts too. Whatever the
    match, a changed shape does not pass: fixing it would force a full sync.
    """
    if notetype is None:
        return False
    templates = notetype["tmpls"]
    known = notetype["name"] == NOTETYPE_NAME or any(MARKER in t["qfmt"] for t in templates)
    fields = tuple(field["name"] for field in notetype["flds"])
    return known and len(templates) == 1 and fields == _FIELDS


def _find_notetype(collection: Collection) -> Any | None:
    for entry in collection.models.all_names_and_ids():
        notetype: Any = collection.models.get(cast(Any, entry.id))
        if _is_ours(notetype):
            return notetype
    return None


def _ensure_notetype(collection: Collection) -> Any:
    """Fields stay frozen after the first version: changing them would force a full sync."""
    notetype = _find_notetype(collection)
    if notetype is not None:
        return notetype
    # A note type someone reshaped stays behind unused: removing it would force a full sync.
    models = collection.models
    notetype = models.new(NOTETYPE_NAME)
    models.add_field(notetype, models.new_field("Title"))
    models.add_field(notetype, models.new_field("Data"))
    template = models.new_template("Dashboard")
    template["qfmt"] = front_template()
    template["afmt"] = _BACK_TEMPLATE
    models.add_template(notetype, template)
    notetype["css"] = card_styles()
    models.add_dict(notetype)
    return _find_notetype(collection)


def _ensure_deck(collection: Collection) -> Any:
    """Its own options keep a daily limit of 0 in another preset from hiding the card."""
    decks = collection.decks
    deck_id: Any = decks.id(DECK_NAME)
    deck: Any = decks.get(deck_id)
    preset = next((c for c in decks.all_config() if c["name"] == PRESET_NAME), None)
    if preset is None:
        preset = decks.add_config(PRESET_NAME)
        preset["new"]["perDay"] = _NEW_CARDS_PER_DAY
        decks.update_config(preset)
    if deck["conf"] != preset["id"]:
        deck["conf"] = preset["id"]
        decks.save(deck)
    return deck_id


def _add_note(collection: Collection, payload: str) -> Note:
    notetype = _ensure_notetype(collection)
    deck_id: Any = _ensure_deck(collection)
    note = collection.new_note(notetype)
    note.guid = NOTE_GUID
    note["Title"] = TITLE
    note["Data"] = payload
    collection.add_note(note, deck_id)
    return note


def set_up(collection: Collection, payload: str) -> None:
    """Runs only after the user switched this on, and after a backup."""
    if not is_set_up(collection):
        _add_note(collection, payload)


def _template_is_current(notetype: Any) -> bool:
    template = notetype["tmpls"][0]
    return (
        template["qfmt"] == front_template()
        and template["afmt"] == _BACK_TEMPLATE
        and notetype["css"] == card_styles()
    )


def _update_template(collection: Collection, note: Note) -> None:
    """Template text may change freely. Anki does not treat this as a schema change."""
    notetype: Any = note.note_type()
    if not _template_is_current(notetype):
        template = notetype["tmpls"][0]
        template["qfmt"] = front_template()
        template["afmt"] = _BACK_TEMPLATE
        notetype["css"] = card_styles()
        collection.models.update_dict(notetype, skip_checks=True)


def _readable(payload: str) -> bool:
    try:
        content = json.loads(base64.b64decode(payload, validate=True))
    except ValueError:
        return False
    return isinstance(content, dict) and content.keys() >= _SNAPSHOT_KEYS


def _card_is_in_place(collection: Collection, note: Note) -> bool:
    card = note.cards()[0]
    deck_id = collection.decks.id_for_name(DECK_NAME)
    return card.queue == _QUEUE_NEW and card.did == deck_id


def needs_repair(collection: Collection) -> bool:
    """Only reads, so it can run whenever. Anything found here is put right by the next write."""
    ids = _note_ids(collection)
    if len(ids) != 1:
        return True
    note = collection.get_note(ids[0])
    notetype = note.note_type()
    return not (
        _is_ours(notetype)
        and _template_is_current(notetype)
        and note["Title"] == TITLE
        and _readable(note["Data"])
        and _card_is_in_place(collection, note)
    )


def _repair_card(collection: Collection, note: Note) -> None:
    """An answered card leaves its queue, a filtered deck can take it. Both are undone here."""
    card = note.cards()[0]
    deck_id: Any = _ensure_deck(collection)
    if card.queue != _QUEUE_NEW:
        collection.sched.schedule_cards_as_new([card.id], reset_counts=True)
    card = note.cards()[0]
    if card.did != deck_id:
        collection.set_deck([card.id], deck_id)


def write_snapshot(collection: Collection, payload: str) -> bool:
    """Store new data and keep the user's undo history exactly as it was. False means not yet.

    A write without an undo entry would clear that history. So the write joins the user's last
    action: Ctrl+Z still undoes that action, and this write simply goes with it. With a redo
    waiting, any write would destroy it, so this waits for a later moment.
    """
    status = collection.undo_status()
    if status.redo:
        return False
    ids = _note_ids(collection)
    last_step = status.last_step
    note = collection.get_note(ids[0]) if ids else None
    if note is None or not _is_ours(note.note_type()):
        # Deleted, or moved to a note type that is not ours and has to stay as it is.
        collection.remove_notes(ids)
        note = _add_note(collection, payload)
    else:
        note["Title"] = TITLE
        note["Data"] = payload
        collection.update_note(note, skip_undo_entry=last_step == 0)
        if len(ids) > 1:
            # Two devices set up before their first sync. Only copies of this note go.
            collection.remove_notes(ids[1:])
    _repair_card(collection, note)
    _update_template(collection, note)
    if last_step != 0:
        collection.merge_undo_entries(last_step)
    return True


def remove(collection: Collection) -> None:
    """Remove the note, and the deck if nothing else lives there.

    Removing a deck takes its cards and subdecks along, and people can add both to this one. The
    note type stays: removing one forces a full sync.
    """
    ids = _note_ids(collection)
    if ids:
        collection.remove_notes(ids)
    decks = collection.decks
    deck_id: Any = decks.id_for_name(DECK_NAME)
    if deck_id is None:
        return
    if not decks.children(deck_id) and not decks.card_count(deck_id, include_subdecks=True):
        decks.remove([deck_id])
