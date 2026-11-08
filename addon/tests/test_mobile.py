"""The one part of Statly that writes. These tests run against real collections."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.core.contract import Contract
from statly.core.reader import STATLY_NOTE_GUID, CollectionReader
from statly.modules.changes import phone_card as writer
from statly.modules.mobile.card import MARKER, card_styles, front_template, viewer_script
from statly.modules.mobile.snapshot import build_snapshot, content_hash, encode_snapshot
from statly.modules.statistics import metrics


def schema(collection: Collection) -> int:
    database: Any = collection.db
    return database.scalar("select scm from col")


def fingerprint(collection: Collection) -> list[Any]:
    """Everything of the user's that must never change."""
    database: Any = collection.db
    notes = database.all(
        "select id, flds, mod from notes where guid != ? order by id", STATLY_NOTE_GUID
    )
    reader = CollectionReader(collection)
    excluded = reader.excluded_cards or (0,)
    marks = ",".join("?" * len(excluded))
    cards = database.all(
        f"select id, did, queue, due, ivl, reps from cards where id not in ({marks}) order by id",
        *excluded,
    )
    return [notes, cards, database.all("select * from revlog order by id")]


def answer_next(collection: Collection) -> None:
    scheduler: Any = collection.sched
    card = scheduler.getCard()
    states = collection._backend.get_scheduling_states(card.id)
    scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=CardAnswer.GOOD))


def payload(text: str = "one") -> str:
    content: dict[str, Any] = {"title": text, "blocks": {}, "tablet": [], "phone": []}
    return base64.b64encode(json.dumps(content).encode()).decode()


def data_of(collection: Collection) -> str:
    database: Any = collection.db
    note_id = database.scalar("select id from notes where guid = ?", STATLY_NOTE_GUID)
    return collection.get_note(note_id)["Data"]


def test_setup_leaves_the_users_data_and_the_schema_alone(collection: Collection) -> None:
    before = fingerprint(collection)
    schema_before = schema(collection)

    writer.set_up(collection, payload())

    assert fingerprint(collection) == before
    assert schema(collection) == schema_before
    assert writer.is_set_up(collection)


def test_setup_twice_changes_nothing(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    writer.set_up(collection, payload("two"))
    assert data_of(collection) == payload("one")


def test_the_card_is_new_and_ready_in_its_own_deck(collection: Collection) -> None:
    writer.set_up(collection, payload())
    deck_id = collection.decks.id_for_name(writer.DECK_NAME)
    assert deck_id is not None
    collection.decks.select(deck_id)
    assert collection.sched.counts()[0] == 1


def test_updates_join_the_users_last_action(collection: Collection) -> None:
    """Prototype finding: a write without an undo entry would wipe the undo history."""
    writer.set_up(collection, payload("one"))
    answer_next(collection)
    before = collection.undo_status()
    assert before.undo == "Answer Card"

    writer.write_snapshot(collection, payload("two"))

    after = collection.undo_status()
    assert data_of(collection) == payload("two")
    assert after.undo == "Answer Card"
    assert after.last_step == before.last_step


def test_undo_still_works_after_an_update(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    reviews = collection.db.scalar("select count() from revlog")  # type: ignore[union-attr]
    answer_next(collection)
    writer.write_snapshot(collection, payload("two"))

    collection.undo()

    assert collection.db.scalar("select count() from revlog") == reviews  # type: ignore[union-attr]


def test_a_waiting_redo_postpones_the_update(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    answer_next(collection)
    collection.undo()
    assert collection.undo_status().redo

    assert writer.write_snapshot(collection, payload("two")) is False

    assert data_of(collection) == payload("one")
    assert collection.undo_status().redo


def test_update_without_any_undo_history(tmp_path: Path) -> None:
    path = str(tmp_path / "fresh.anki2")
    collection = Collection(path)
    writer.set_up(collection, payload("one"))
    collection.close()

    reopened = Collection(path)
    assert reopened.undo_status().last_step == 0
    writer.write_snapshot(reopened, payload("two"))
    assert data_of(reopened) == payload("two")
    reopened.close()


def test_updates_never_change_the_schema_or_user_data(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    before = fingerprint(collection)
    schema_before = schema(collection)
    for version in range(5):
        writer.write_snapshot(collection, payload(str(version)))
    assert fingerprint(collection) == before
    assert schema(collection) == schema_before


def test_an_answered_card_goes_back_to_new(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    deck_id: Any = collection.decks.id_for_name(writer.DECK_NAME)
    collection.decks.select(deck_id)
    answer_next(collection)

    writer.write_snapshot(collection, payload("two"))

    database: Any = collection.db
    assert (
        database.scalar(
            "select queue from cards where id in "
            "(select c.id from cards c join notes n on n.id = c.nid where n.guid = ?)",
            STATLY_NOTE_GUID,
        )
        == 0
    )


def test_a_card_moved_elsewhere_comes_back(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    database: Any = collection.db
    card_id: Any = CollectionReader(collection).excluded_cards[0]
    default: Any = collection.decks.id("Default")
    collection.set_deck([card_id], default)

    writer.write_snapshot(collection, payload("two"))

    assert database.scalar("select did from cards where id = ?", card_id) == (
        collection.decks.id_for_name(writer.DECK_NAME)
    )


def test_duplicates_from_two_devices_are_cleaned_up(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    database: Any = collection.db
    note_type: Any = collection.models.by_name(writer.NOTETYPE_NAME)
    copy = collection.new_note(note_type)
    copy.guid = STATLY_NOTE_GUID
    copy["Title"] = "Statly"
    copy["Data"] = payload("copy")
    deck_id: Any = collection.decks.id_for_name(writer.DECK_NAME)
    collection.add_note(copy, deck_id)
    others = fingerprint(collection)[0]

    writer.write_snapshot(collection, payload("two"))

    assert database.scalar("select count() from notes where guid = ?", STATLY_NOTE_GUID) == 1
    assert fingerprint(collection)[0] == others


def test_template_updates_do_not_force_a_full_sync(collection: Collection) -> None:
    writer.set_up(collection, payload("one"))
    schema_before = schema(collection)
    notetype: Any = collection.models.by_name(writer.NOTETYPE_NAME)
    notetype["tmpls"][0]["qfmt"] = f"<!-- {MARKER} --> old {{{{Data}}}}"
    collection.models.update_dict(notetype)

    writer.write_snapshot(collection, payload("two"))

    updated: Any = collection.models.by_name(writer.NOTETYPE_NAME)
    assert updated["tmpls"][0]["qfmt"] == front_template()
    assert schema(collection) == schema_before


def own_note(collection: Collection) -> Any:
    database: Any = collection.db
    return collection.get_note(
        database.scalar("select id from notes where guid = ?", STATLY_NOTE_GUID)
    )


def edit_template(collection: Collection, change: Callable[[Any], None]) -> None:
    notetype: Any = own_note(collection).note_type()
    change(notetype)
    collection.models.update_dict(notetype, skip_checks=True)


def other_note_types(collection: Collection) -> list[Any]:
    own = own_note(collection).mid
    return [
        collection.models.get(cast(Any, entry.id))
        for entry in collection.models.all_names_and_ids()
        if entry.id != own and "Statly" not in entry.name
    ]


def cut_template(notetype: Any) -> None:
    notetype["tmpls"][0]["qfmt"] = notetype["tmpls"][0]["qfmt"][:200]


def empty_template(notetype: Any) -> None:
    notetype["tmpls"][0]["qfmt"] = "{{Title}}"


def cut_back(notetype: Any) -> None:
    notetype["tmpls"][0]["afmt"] = "oops"


def cut_styles(notetype: Any) -> None:
    notetype["css"] = ""


@pytest.mark.parametrize("damage", [cut_template, empty_template, cut_back, cut_styles])
def test_a_template_damaged_on_a_phone_comes_back(
    collection: Collection, damage: Callable[[Any], None]
) -> None:
    writer.set_up(collection, payload())
    edit_template(collection, damage)
    before, others, schema_before = (
        fingerprint(collection),
        other_note_types(collection),
        schema(collection),
    )
    assert writer.needs_repair(collection)

    writer.write_snapshot(collection, payload())

    notetype: Any = own_note(collection).note_type()
    assert notetype["tmpls"][0]["qfmt"] == front_template()
    assert notetype["css"] == card_styles()
    assert not writer.needs_repair(collection)
    assert fingerprint(collection) == before
    assert other_note_types(collection) == others
    assert schema(collection) == schema_before


@pytest.mark.parametrize("data", ["", "not base64!", "e30=", "AAAA", "<div>abc</div>"])
def test_data_damaged_on_a_phone_comes_back(collection: Collection, data: str) -> None:
    writer.set_up(collection, payload())
    note = own_note(collection)
    note["Data"] = data
    collection.update_note(note)
    assert writer.needs_repair(collection)

    writer.write_snapshot(collection, payload("fresh"))

    assert data_of(collection) == payload("fresh")
    assert not writer.needs_repair(collection)


def test_a_changed_title_comes_back(collection: Collection) -> None:
    writer.set_up(collection, payload())
    note = own_note(collection)
    note["Title"] = "typed by accident"
    collection.update_note(note)
    assert writer.needs_repair(collection)
    writer.write_snapshot(collection, payload())
    assert own_note(collection)["Title"] == writer.TITLE


def test_a_healthy_card_needs_no_repair(collection: Collection) -> None:
    writer.set_up(collection, payload())
    assert not writer.needs_repair(collection)


def test_a_deleted_note_comes_back_and_nothing_else_moves(collection: Collection) -> None:
    writer.set_up(collection, payload())
    before = fingerprint(collection)
    collection.remove_notes([own_note(collection).id])
    assert writer.needs_repair(collection)

    writer.write_snapshot(collection, payload("fresh"))

    assert data_of(collection) == payload("fresh")
    assert fingerprint(collection) == before
    assert not writer.needs_repair(collection)


def test_a_note_moved_to_someone_elses_type_leaves_that_type_alone(collection: Collection) -> None:
    writer.set_up(collection, payload())
    basic: Any = collection.models.by_name("Basic")
    before = json.dumps(basic, sort_keys=True)
    note = own_note(collection)
    notes_before = fingerprint(collection)
    database: Any = collection.db
    database.execute("update notes set mid = ? where id = ?", basic["id"], note.id)
    database.execute("update notes set flds = ? where id = ?", "x\x1fy", note.id)
    assert writer.needs_repair(collection)

    writer.write_snapshot(collection, payload("fresh"))

    assert json.dumps(collection.models.by_name("Basic"), sort_keys=True) == before
    assert own_note(collection).note_type()["name"].startswith(writer.NOTETYPE_NAME)
    assert data_of(collection) == payload("fresh")
    assert fingerprint(collection) == notes_before
    assert not writer.needs_repair(collection)


def test_a_look_alike_of_the_user_is_never_taken_for_ours(collection: Collection) -> None:
    models = collection.models
    lookalike = models.new("Statly Dashboard")
    models.add_field(lookalike, models.new_field("Title"))
    models.add_field(lookalike, models.new_field("Data"))
    models.add_field(lookalike, models.new_field("Mine"))
    template = models.new_template("Card")
    template["qfmt"] = "{{Title}}"
    template["afmt"] = "{{Data}}"
    models.add_template(lookalike, template)
    models.add_dict(lookalike)
    stored: Any = models.by_name("Statly Dashboard")
    before = json.dumps(stored, sort_keys=True)

    writer.set_up(collection, payload())

    assert json.dumps(models.get(stored["id"]), sort_keys=True) == before
    assert own_note(collection).mid != stored["id"]


def test_a_field_removed_on_a_phone_gets_a_clean_new_note_type(collection: Collection) -> None:
    writer.set_up(collection, payload())
    notetype: Any = own_note(collection).note_type()
    old = notetype["id"]
    collection.models.remove_field(notetype, notetype["flds"][0])
    collection.models.update_dict(notetype)
    schema_before = schema(collection)

    writer.write_snapshot(collection, payload("fresh"))

    assert own_note(collection).mid != old
    assert data_of(collection) == payload("fresh")
    assert schema(collection) == schema_before
    assert not writer.needs_repair(collection)


def test_repairs_keep_the_users_undo_step(collection: Collection) -> None:
    writer.set_up(collection, payload())
    edit_template(collection, cut_template)
    answer_next(collection)
    step = collection.undo_status().undo
    database: Any = collection.db
    reviews = database.scalar("select count() from revlog")

    writer.write_snapshot(collection, payload("fresh"))

    assert not writer.needs_repair(collection)
    assert collection.undo_status().undo == step
    collection.undo()
    assert database.scalar("select count() from revlog") == reviews - 1


def add_card_to(collection: Collection, deck_name: str) -> Any:
    notetype: Any = collection.models.by_name("Basic")
    note = collection.new_note(notetype)
    note["Front"] = "my own card"
    deck: Any = collection.decks.id(deck_name)
    collection.add_note(note, deck)
    return note


def test_removing_never_takes_a_card_someone_put_in_the_deck(collection: Collection) -> None:
    writer.set_up(collection, payload())
    mine = add_card_to(collection, writer.DECK_NAME)

    writer.remove(collection)

    assert collection.get_note(mine.id)["Front"] == "my own card"
    assert collection.decks.id_for_name(writer.DECK_NAME) is not None
    assert not writer.is_set_up(collection)


def test_removing_never_takes_a_subdeck(collection: Collection) -> None:
    writer.set_up(collection, payload())
    mine = add_card_to(collection, f"{writer.DECK_NAME}::Mine")

    writer.remove(collection)

    assert collection.get_note(mine.id)["Front"] == "my own card"


def test_removing_touches_only_statly(collection: Collection) -> None:
    before = fingerprint(collection)
    schema_before = schema(collection)
    writer.set_up(collection, payload())

    writer.remove(collection)

    assert not writer.is_set_up(collection)
    assert collection.decks.id_for_name(writer.DECK_NAME) is None
    assert fingerprint(collection) == before
    assert schema(collection) == schema_before


def test_statistics_never_count_the_card(collection: Collection) -> None:
    reader = CollectionReader(collection)
    before = metrics.card_states({"deckId": None}, reader)
    summary_range = {"start": "2006-01-01", "end": "2100-01-01", "deckId": None}
    reviews = metrics.summary(summary_range, reader)["reviews"]

    writer.set_up(collection, payload())
    deck_id: Any = collection.decks.id_for_name(writer.DECK_NAME)
    collection.decks.select(deck_id)
    answer_next(collection)

    fresh = CollectionReader(collection)
    assert metrics.card_states({"deckId": None}, fresh) == before
    assert metrics.summary(summary_range, fresh)["reviews"] == reviews


def test_the_rendered_card_keeps_its_data_and_stays_safe(collection: Collection) -> None:
    text = json.dumps({"title": "Äöü [sound:x.mp3] {{Data}} <b>"}, ensure_ascii=False)
    encoded = base64.b64encode(text.encode()).decode()
    writer.set_up(collection, encoded)
    card_id: Any = CollectionReader(collection).excluded_cards[0]

    html = collection.get_card(card_id).render_output().question_text

    assert encoded in html
    assert 'class="tappable"' in html
    assert "[anki:play" not in html


def test_the_card_script_stays_small() -> None:
    """Phones load it on every look, and the app's contract once slipped in through an import."""
    assert len(viewer_script()) < 40_000


def test_the_card_script_has_nothing_anki_would_rewrite() -> None:
    script = viewer_script()
    assert "{{" not in script
    assert "[sound:" not in script
    assert "</script" not in script


ALL_KINDS = (
    "review-summary",
    "learned-cards",
    "review-breakdown",
    "study-time",
    "success-rate",
    "due-cards",
    "deck-activity",
    "review-timeline",
    "answer-buttons",
    "due-forecast",
    "card-states",
    "study-rhythm",
    "review-heatmap",
)


def placed(kind: str, period: str = "today") -> dict[str, Any]:
    return {"id": kind, "type": kind, "x": 0, "y": 0, "w": 4, "h": 6, "period": period}


def snapshot_of(collection: Collection, *items: dict[str, Any], **options: Any) -> dict[str, Any]:
    language = options.pop("language", "en")
    devices = {"tablet": list(items), "phone": list(items)}
    return build_snapshot(
        CollectionReader(collection), devices, language, options.pop("custom", {}), **options
    )


def test_snapshot_covers_every_built_in_statistic(collection: Collection) -> None:
    snapshot = snapshot_of(collection, *[placed(kind) for kind in ALL_KINDS], language="de")
    assert len(snapshot["blocks"]) == 13
    assert snapshot["blocks"]["review-summary|today"]["label"] == "Wiederholungen"
    assert snapshot["blocks"]["review-heatmap|today"]["kind"] == "heatmap"


def test_learned_cards_count_each_card_once(collection: Collection) -> None:
    scheduler: Any = collection.sched
    answers = 0
    while answers < 6 and (card := scheduler.getCard()):
        states = collection._backend.get_scheduling_states(card.id)
        scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=1))
        answers += 1

    blocks = snapshot_of(
        collection, placed("learned-cards"), placed("review-summary"), placed("rating-summary")
    )["blocks"]

    # Every answer was Again, so no card moved to a later day: no reviews, only ratings.
    assert blocks["review-summary|today"]["value"] == "0"
    assert int(blocks["rating-summary|today"]["value"]) >= 6
    assert blocks["rating-summary|today"]["label"] == "Ratings"
    assert blocks["learned-cards|today"]["value"] == "3"
    assert blocks["learned-cards|today"]["label"] == "Learned cards"


def test_phone_and_tablet_share_their_blocks(collection: Collection) -> None:
    snapshot = build_snapshot(
        CollectionReader(collection),
        {"tablet": [placed("due-cards")], "phone": [{**placed("due-cards"), "w": 2}]},
        "en",
        {},
    )
    assert list(snapshot["blocks"]) == ["due-cards|today"]
    assert snapshot["tablet"][0]["w"] == 4
    assert snapshot["phone"][0]["w"] == 2


def test_each_block_shows_its_own_period(collection: Collection) -> None:
    snapshot = snapshot_of(
        collection, placed("review-summary", "last7"), placed("review-timeline", "last30")
    )
    assert snapshot["blocks"]["review-summary|last7"]["note"] == "Last 7 days"
    assert snapshot["blocks"]["review-timeline|last30"]["note"] == "Last 30 days"


def custom_widget(**changes: Any) -> dict[str, Any]:
    box = {"x": 0, "y": 0, "w": 50, "h": 50, "opacity": 1}
    text = {"size": 12, "bold": False, "align": "left", "color": "text"}
    return {
        "id": "mine",
        "name": "Mine",
        "description": "",
        "size": {"w": 4, "h": 6},
        "background": {"kind": "card"},
        "elements": [
            {**box, **text, "id": "t", "kind": "text", "text": "Hi"},
            {
                **box,
                **text,
                "id": "m",
                "kind": "metric",
                "source": "ratings",
                "range": "dashboard",
            },
            {
                **box,
                "id": "c",
                "kind": "chart",
                "source": "answerButtons",
                "chart": "bar",
                "range": "last30",
                "color": "accent",
            },
            {
                **box,
                "id": "p",
                "kind": "progress",
                "source": "dueCards",
                "range": "today",
                "goal": 4,
                "style": "ring",
                "color": "accent",
            },
            {**box, "id": "h", "kind": "heatmap"},
            {**box, "id": "s", "kind": "shape", "shape": "ellipse", "fill": "accent", "radius": 0},
        ],
        **changes,
    }


def test_tiles_know_their_other_time_ranges(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("review-summary"))
    facts = snapshot["blocks"]["review-summary|today"]["facts"]
    assert [fact["label"] for fact in facts] == ["Today", "Last 7 days", "Last 30 days"]


def test_the_heatmap_brings_its_facts_along(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("review-heatmap"))
    labels = [fact["label"] for fact in snapshot["blocks"]["review-heatmap|today"]["facts"]]
    assert "Longest streak" in labels


def test_the_card_gets_its_words_in_the_right_language(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("due-cards"), language="de")
    assert snapshot["words"]["back"] == "Zurück"


def test_backgrounds_travel_with_the_card(collection: Collection) -> None:
    devices: dict[str, list[Any]] = {"tablet": [], "phone": []}
    snapshot = build_snapshot(
        CollectionReader(collection),
        devices,
        "en",
        {},
        backgrounds={"phone": "data:image/jpeg;base64,AAAA", "tablet": None},
    )
    assert snapshot["backgrounds"] == {"tablet": None, "phone": "data:image/jpeg;base64,AAAA"}


def test_custom_widgets_reach_the_card_with_their_values(collection: Collection) -> None:
    item = placed("custom:mine", "last7")
    snapshot = snapshot_of(collection, item, custom={"mine": custom_widget()})
    block = snapshot["blocks"]["custom:mine|last7"]
    assert block["kind"] == "custom"
    assert block["widget"]["name"] == "Mine"
    values = block["values"]
    assert set(values) == {"m", "c", "p", "h"}
    assert values["m"]["text"] == "1"
    assert [bar["label"] for bar in values["c"]["bars"]] == ["Again", "Hard", "Good", "Easy"]
    assert 0 <= values["p"]["share"] <= 1
    assert len(values["h"]["levels"]) >= 364


def test_a_combined_chart_reaches_the_card_with_one_list_per_layer(collection: Collection) -> None:
    box = {"x": 0, "y": 0, "w": 100, "h": 100, "opacity": 1}
    layer = {"color": "accent", "axis": "auto"}
    chart = {
        **box,
        "id": "c",
        "kind": "chart",
        "source": "hours",
        "chart": "combined",
        "range": "last30",
        "color": "accent",
        "layers": [
            {**layer, "id": "a", "kind": "bar", "source": "hours"},
            {**layer, "id": "b", "kind": "line", "source": "focusHours"},
        ],
    }
    widget = custom_widget(elements=[chart])
    snapshot = snapshot_of(collection, placed("custom:mine", "last7"), custom={"mine": widget})
    values = snapshot["blocks"]["custom:mine|last7"]["values"]["c"]
    assert "bars" not in values
    hours, focus = values["layers"]
    assert len(hours) == len(focus) == 24
    assert all(0 <= point["value"] <= 100 for point in focus)


def picture(asset_id: str, background: bool = False) -> dict[str, Any]:
    asset = {"id": asset_id, "type": "image/png"}
    return {
        "x": 0,
        "y": 0,
        "w": 10,
        "h": 10,
        "opacity": 1,
        "id": asset_id[:8],
        "kind": "media",
        "asset": asset,
        "fit": "cover",
        "radius": 0,
    }


def test_pictures_are_shrunk_and_stay_within_a_budget(collection: Collection) -> None:
    widget = custom_widget(elements=[picture("a" * 64), picture("b" * 64)])
    seen: list[str] = []

    def thumbnail(asset: dict[str, str]) -> str:
        seen.append(asset["id"])
        return "x" * 200_000

    snapshot = snapshot_of(
        collection,
        placed("custom:mine"),
        custom={"mine": widget},
        thumbnail=thumbnail,
    )
    assert list(snapshot["blocks"]["custom:mine|today"]["media"]) == ["a" * 64]
    assert seen == ["a" * 64, "b" * 64]


def test_videos_stay_on_the_desktop(collection: Collection) -> None:
    video = {**picture("a" * 64), "asset": {"id": "a" * 64, "type": "video/webm"}}
    snapshot = snapshot_of(
        collection,
        placed("custom:mine"),
        custom={"mine": custom_widget(elements=[video])},
        thumbnail=lambda _asset: "data",  # type: ignore[arg-type]
    )
    assert snapshot["blocks"]["custom:mine|today"]["media"] == {}


def test_a_deleted_custom_widget_leaves_nothing_behind(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("custom:gone"), placed("due-cards"))
    assert list(snapshot["blocks"]) == ["due-cards|today"]
    assert len(snapshot["phone"]) == 1


def test_an_unchanged_dashboard_needs_no_write(collection: Collection) -> None:
    first = snapshot_of(collection, placed("due-cards"))
    assert content_hash(first) == content_hash(snapshot_of(collection, placed("due-cards")))


def test_snapshot_encoding_survives_umlauts(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("due-cards"), language="de")
    encoded = encode_snapshot(snapshot, datetime(2026, 11, 1, 9, 30), "de")
    decoded = json.loads(base64.b64decode(encoded))
    assert decoded["updated"] == "Aktualisiert 01.11.2026 09:30"
    assert decoded["blocks"]["due-cards|today"]["label"] == "Fällige Karten"


INSIGHT_KINDS = (
    "study-overview",
    "period-summary",
    "answer-mix",
    "answer-speed",
    "study-sessions",
    "deck-table",
    "forgotten-cards",
    "weakest-decks",
    "new-cards-from",
)


def test_the_closer_looks_reach_the_card_and_fit_the_contract(collection: Collection) -> None:
    items = [placed(kind, "last30") for kind in (*INSIGHT_KINDS, "day-notes")]
    snapshot = snapshot_of(collection, *items, language="de")

    Contract().check_result("mobile.preview", snapshot)
    assert set(snapshot["blocks"]) == {f"{kind}|last30" for kind in INSIGHT_KINDS}
    assert snapshot["blocks"]["deck-table|last30"]["kind"] == "table"
    assert snapshot["blocks"]["deck-table|last30"]["columns"][0] == "Stabilität"
    assert snapshot["blocks"]["study-overview|last30"]["kind"] == "heatmap"


def test_day_notes_never_go_onto_the_synced_card(collection: Collection) -> None:
    snapshot = snapshot_of(collection, placed("day-notes"))
    assert snapshot["blocks"] == {}
    assert snapshot["phone"] == []


def test_custom_widgets_can_use_every_new_source(collection: Collection) -> None:
    box = {"x": 0, "y": 0, "w": 50, "h": 50, "opacity": 1}
    text = {"size": 12, "bold": False, "align": "left", "color": "text"}
    metrics = ("newCards", "secondsPerRating", "focus", "matureShare", "forgottenCards")
    series = (
        "retentionTimeline",
        "speedTimeline",
        "timeTimeline",
        "newTimeline",
        "forgottenCards",
        "weakestDecks",
        "newCardsFrom",
        "deckStability",
        "sessionHours",
    )
    elements = [
        *(
            {**box, **text, "id": f"m{index}", "kind": "metric", "source": source, "range": "last7"}
            for index, source in enumerate(metrics)
        ),
        *(
            {
                **box,
                "id": f"c{index}",
                "kind": "chart",
                "source": source,
                "chart": "line",
                "range": "last7",
                "color": "accent",
            }
            for index, source in enumerate(series)
        ),
        *(
            {**box, "id": f"h{mode}", "kind": "heatmap", "mode": mode}
            for mode in ("reviews", "ratings", "retention", "speed", "time", "new")
        ),
    ]
    widget = custom_widget(elements=elements)
    snapshot = snapshot_of(collection, placed("custom:mine", "last7"), custom={"mine": widget})

    Contract().check_result("mobile.preview", snapshot)
    values = snapshot["blocks"]["custom:mine|last7"]["values"]
    assert len(values) == len(elements)
    assert len(values["c3"]["bars"]) == 7
    assert len(values["c8"]["bars"]) == 24
    assert all(len(values[f"h{mode}"]["levels"]) >= 364 for mode in ("retention", "speed"))
