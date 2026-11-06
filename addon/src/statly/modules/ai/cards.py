"""What an AI may read about cards, once a person has allowed it. Nothing here can write."""

from __future__ import annotations

import html
import re
from typing import Any

from ...core.errors import InvalidParams
from ...core.reader import CollectionReader
from ..statistics.calendar import AnkiCalendar

_FIELD_SEPARATOR = "\x1f"
_MAX_FIELD_CHARS = 1500
_FRONT_CHARS = 100
_RECENT_REVIEWS = 5
_TAG = re.compile(r"<[^>]+>")
_MEDIA = re.compile(r"\[(?:sound|anki):[^\]]*\]")
_QUEUE_STATES = {
    -3: "buried",
    -2: "buried",
    -1: "suspended",
    0: "new",
    1: "learning",
    2: "review",
    3: "learning",
}


def plain_text(field: str, limit: int = _MAX_FIELD_CHARS) -> str:
    """Models only need the words, and markup would just cost tokens."""
    text = _MEDIA.sub("", _TAG.sub(" ", field))
    return " ".join(html.unescape(text).split())[:limit]


def _review_day(reader: CollectionReader, millis: int | None) -> str | None:
    if millis is None:
        return None
    return AnkiCalendar(reader.day_cutoff).day_of(millis // 1000).isoformat()


def find(params: Any, reader: CollectionReader) -> list[dict[str, Any]]:
    try:
        matches = reader.find_cards(params["query"])
    except Exception:  # noqa: BLE001
        # Anki rejects a broken search with its own error, and the model can simply try again.
        raise InvalidParams("Anki cannot read this search.") from None
    decks = reader.deck_names()
    found: list[dict[str, Any]] = []
    for card_id in matches[: params["limit"]]:
        row = reader.rows(
            "SELECT c.did, n.flds FROM cards AS c JOIN notes AS n ON n.id = c.nid WHERE c.id = ?",
            card_id,
        )
        if row:
            last = reader.scalar("SELECT MAX(id) FROM revlog WHERE cid = ?", card_id)
            found.append(
                {
                    "cardId": card_id,
                    "deck": decks.get(row[0][0], ""),
                    "front": plain_text(row[0][1].split(_FIELD_SEPARATOR)[0], _FRONT_CHARS),
                    "lastReview": _review_day(reader, last),
                }
            )
    return found


def details(params: Any, reader: CollectionReader) -> dict[str, Any]:
    card_id = params["cardId"]
    if card_id in reader.excluded_cards:
        raise InvalidParams("There is no such card.")
    rows = reader.rows(
        "SELECT c.did, c.queue, c.ivl, c.reps, c.lapses, n.flds, n.tags, n.mid "
        "FROM cards AS c JOIN notes AS n ON n.id = c.nid WHERE c.id = ?",
        card_id,
    )
    if not rows:
        raise InvalidParams("There is no such card.")
    deck, queue, interval, reps, lapses, fields, tags, notetype = rows[0]
    names = reader.column("SELECT name FROM fields WHERE ntid = ? ORDER BY ord", notetype)
    values = fields.split(_FIELD_SEPARATOR)
    recent = reader.rows(
        "SELECT id, ease FROM revlog WHERE cid = ? ORDER BY id DESC LIMIT ?",
        card_id,
        _RECENT_REVIEWS,
    )
    history = [{"date": _review_day(reader, row[0]), "answer": row[1]} for row in recent]
    return {
        "cardId": card_id,
        "deck": reader.deck_names().get(deck, ""),
        "fields": {name: plain_text(value) for name, value in zip(names, values, strict=False)},
        "tags": tags.split(),
        "state": _QUEUE_STATES.get(queue, "new"),
        "intervalDays": max(0, interval),
        "ratings": reps,
        "lapses": lapses,
        "lastReview": history[0]["date"] if history else None,
        "recent": history,
    }
