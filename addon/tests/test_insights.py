"""Exact results of the closer looks: forgotten cards, decks, days, pace, sessions and notes."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.core.storage import JsonStore
from statly.modules.notes import NoteStore
from statly.modules.statistics import insights
from test_statistics import Log, add_deck_card, range_of, reader_for


@pytest.fixture
def log(collection: Collection) -> Log:
    return Log(collection)


def answer(collection: Collection, rating: Any) -> int:
    scheduler: Any = collection.sched
    card = scheduler.getCard()
    states = collection._backend.get_scheduling_states(card.id)
    scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=rating))
    return int(card.id)


def test_a_first_sight_is_never_forgetting(collection: Collection) -> None:
    """Uses Anki's real scheduler, so the rule follows what Anki writes into the log."""
    first = answer(collection, CardAnswer.AGAIN)
    database: Any = collection.db
    kind, last_interval = database.first(
        "select type, lastIvl from revlog where cid = ? order by id", first
    )
    assert (kind, last_interval) == (0, 0)
    while answer(collection, CardAnswer.AGAIN) != first:
        pass

    result = insights.forgotten(range_of(collection), reader_for(collection))

    forgotten = {card["cardId"]: card for card in result["cards"]}
    assert (forgotten[first]["forgot"], forgotten[first]["seen"]) == (1, 1)
    assert forgotten[first]["intervalDays"] is None


def test_forgotten_cards_come_most_forgotten_first_with_their_words(log: Log) -> None:
    database: Any = log.database
    database.execute(
        "update notes set flds = ?, sfld = ? where id = (select nid from cards where id = ?)",
        "{{c1::Fascia::hint}} <b>thoracolumbalis</b>\x1fback",
        "{{c1::Fascia::hint}} <b>thoracolumbalis</b>",
        log.card_ids[1],
    )
    database.execute("update cards set type = 2, queue = 2, ivl = 3 where id = ?", log.card_ids[1])
    for ease in (1, 1, 3):
        log.review(card=1, ease=ease)
    for ease in (1, 3, 3, 3):
        log.review(card=2, ease=ease)
    log.review(card=0, ease=3)
    log.review(card=0, ease=1, kind=0, last_interval=0)

    result = insights.forgotten(range_of(log.collection), reader_for(log.collection))

    assert result["total"] == 2
    first, second = result["cards"]
    assert (first["cardId"], first["forgot"], first["seen"]) == (log.card_ids[1], 2, 3)
    assert first["text"] == "Fascia thoracolumbalis"
    assert first["intervalDays"] == 3
    assert first["deck"] == "Test"
    assert (second["cardId"], second["forgot"], second["seen"]) == (log.card_ids[2], 1, 4)


def test_forgotten_cards_skip_deleted_ones_but_count_them(log: Log) -> None:
    log.review(card=99, ease=1)
    log.review(card=1, ease=1)

    result = insights.forgotten(
        {**range_of(log.collection), "limit": 5}, reader_for(log.collection)
    )

    assert result["total"] == 2
    assert [card["cardId"] for card in result["cards"]] == [log.card_ids[1]]


def test_daily_fills_every_day_and_counts_each_kind(log: Log) -> None:
    log.review(day=-2, ease=1, kind=0, last_interval=0, interval=-60, elapsed_ms=4000)
    log.review(day=-2, ease=3, kind=0, last_interval=-60, interval=1, elapsed_ms=2000)
    log.review(day=0, card=1, ease=3, elapsed_ms=6000)
    log.review(day=0, card=2, ease=1, interval=-600, elapsed_ms=8000)

    days = insights.daily(range_of(log.collection, 3), reader_for(log.collection))["days"]

    assert [day["ratings"] for day in days] == [2, 0, 2]
    assert days[0] | {"date": ""} == {
        "date": "",
        "reviews": 1,
        "ratings": 2,
        "timeMs": 6000,
        "newCards": 1,
        "checked": 0,
        "passed": 0,
    }
    assert (days[2]["reviews"], days[2]["checked"], days[2]["passed"]) == (1, 2, 1)


def test_answer_mix_tells_buttons_and_kinds_apart(log: Log) -> None:
    log.review(ease=1, kind=0, last_interval=0)
    log.review(ease=3, kind=0, last_interval=-60)
    log.review(ease=2, kind=1)
    log.review(ease=4, kind=3)
    log.review(ease=3, kind=2)

    mix = insights.answer_mix(range_of(log.collection), reader_for(log.collection))

    assert mix == {
        "again": 1,
        "hard": 1,
        "good": 2,
        "easy": 1,
        "new": 1,
        "learning": 1,
        "review": 2,
        "relearning": 1,
    }


def test_weakest_decks_put_well_checked_decks_first(log: Log) -> None:
    collection = log.collection
    weak, weak_card = add_deck_card(collection, "Studies::Weak")
    _strong, strong_card = add_deck_card(collection, "Studies::Strong")
    _rare, rare_card = add_deck_card(collection, "Rare")
    for index in range(10):
        log.review(card=weak_card, ease=1 if index < 4 else 3)
        log.review(card=strong_card, ease=1 if index < 1 else 3)
    log.review(card=rare_card, ease=1)
    log.review(card=strong_card, ease=3, kind=0, last_interval=0)

    result = insights.topics(range_of(collection), reader_for(collection))

    assert [(deck["name"], deck["path"]) for deck in result["weakest"]] == [
        ("Weak", "Studies"),
        ("Strong", "Studies"),
        ("Rare", ""),
    ]
    assert result["weakest"][0]["deckId"] == weak
    assert (result["weakest"][0]["checked"], result["weakest"][0]["passed"]) == (10, 6)
    assert result["retention"] == pytest.approx(15 / 21)
    assert result["newFrom"] == [
        {"deckId": result["weakest"][1]["deckId"], "name": "Strong", "path": "Studies", "cards": 1}
    ]
    assert result["newCards"] == 1


def test_deck_table_opens_folders_and_adds_up_subdecks(log: Log) -> None:
    collection = log.collection
    database: Any = log.database
    anatomy, anatomy_card = add_deck_card(collection, "School::Anatomy")
    _muscles, muscle_card = add_deck_card(collection, "School::Anatomy::Muscles")
    _chemistry, chemistry_card = add_deck_card(collection, "School::Chemistry")
    database.execute("update cards set type = 2, queue = 2, ivl = 30 where id = ?", muscle_card)
    log.review(card=anatomy_card, day=-6, elapsed_ms=1000)
    log.review(card=muscle_card, day=0, elapsed_ms=2000)
    log.review(card=muscle_card, day=0, ease=1, interval=-600, elapsed_ms=3000)
    log.review(card=chemistry_card, day=-1, elapsed_ms=4000)

    table = insights.deck_table(range_of(collection, 7), reader_for(collection))

    rows = {row["name"]: row for row in table["rows"]}
    assert [row["name"] for row in table["rows"] if row["parentId"] is None] == [
        "Anatomy",
        "Chemistry",
        "Test",
    ]
    assert rows["Anatomy"]["path"] == "School"
    assert rows["Anatomy"]["deckId"] == anatomy
    assert (rows["Anatomy"]["count"], rows["Anatomy"]["timeMs"]) == (2, 6000)
    assert rows["Anatomy"]["series"] == [1, 0, 0, 0, 0, 0, 1]
    assert rows["Anatomy"]["children"] == 1
    assert rows["Anatomy"]["matureShare"] == pytest.approx(0.5)
    assert (rows["Muscles"]["parentId"], rows["Muscles"]["depth"]) == (anatomy, 1)
    assert rows["Muscles"]["retention"] == pytest.approx(0.5)
    assert table["buckets"][0] == range_of(collection, 7)["start"]


def test_deck_ratings_count_every_answer(log: Log) -> None:
    _deck, card = add_deck_card(log.collection, "Solo")
    log.review(card=card, ease=1, interval=-600)
    log.review(card=card, ease=3)

    params = {**range_of(log.collection), "measure": "ratings"}
    rows = insights.deck_table(params, reader_for(log.collection))["rows"]

    assert next(row for row in rows if row["name"] == "Solo")["count"] == 2


def test_stability_compares_decks_with_cards_of_the_same_age(log: Log) -> None:
    collection = log.collection
    database: Any = log.database
    for name, stability in (("Firm", 20.0), ("Shaky", 5.0)):
        for _ in range(20):
            _deck, card = add_deck_card(collection, name)
            database.execute(
                "update cards set type = 2, queue = 2, ivl = 7, data = ? where id = ?",
                f'{{"s":{stability},"d":5.0}}',
                card,
            )
            log.review(card=card, day=-5)

    table = insights.deck_table(range_of(collection, 30), reader_for(collection))

    rows = {row["name"]: row for row in table["rows"]}
    assert table["stabilityKind"] == "stability"
    assert rows["Firm"]["stability"] == pytest.approx(2.0)
    assert rows["Shaky"]["stability"] == pytest.approx(0.5)
    assert rows["Firm"]["stabilityDays"] == pytest.approx(20.0)


def test_speed_measures_against_the_usual_pace(log: Log) -> None:
    for day in range(1, 41):
        log.review(day=-day, elapsed_ms=5000)
    for _ in range(3):
        log.review(day=0, elapsed_ms=5000)
    log.review(day=0, elapsed_ms=30_000)

    result = insights.speed(range_of(log.collection, 1), reader_for(log.collection))

    current = result["current"]
    assert current["answers"] == 4
    assert current["focus"] == pytest.approx(0.75)
    assert current["medianMs"] == 5125
    assert result["usualMs"]["review"] == 5125
    assert sum(current["histogram"]) == 4
    quantiles = current["quantiles"]
    assert quantiles is not None
    assert quantiles[2] == pytest.approx(0.0)
    assert quantiles[4] == pytest.approx(math.log(30_125 / 5125) / insights.SPREAD_MIN)
    previous = result["previous"]
    assert previous is not None and previous["answers"] == 1


def test_sessions_break_after_a_pause(log: Log) -> None:
    log.review(day=0, hour=9, elapsed_ms=5000)
    log.review(day=0, hour=9.02, elapsed_ms=5000)
    log.review(day=0, hour=14, ease=1, elapsed_ms=5000)
    log.review(day=-1, hour=20, elapsed_ms=5000)

    result = insights.sessions(range_of(log.collection, 3), reader_for(log.collection))

    days = result["days"]
    assert len(days) == 3
    assert [len(day["sessions"]) for day in days] == [0, 1, 2]
    morning, afternoon = days[2]["sessions"]
    assert morning["start"] == 9 * 3600 - 5
    assert morning["ratings"] == 2
    assert afternoon["retention"] == pytest.approx(0.0)
    assert afternoon["focus"] is None
    assert sum(hour["ratings"] for hour in result["hours"]) == 4


def test_notes_are_kept_by_day_and_an_empty_one_is_removed(tmp_path: Path) -> None:
    notes = NoteStore(JsonStore(lambda: tmp_path))
    notes.put("2026-10-30", "  Repro exam review.  ")
    notes.put("2026-11-02", "Short day")

    assert notes.between("2026-10-01", "2026-10-31") == [
        {"date": "2026-10-30", "text": "Repro exam review."}
    ]
    notes.put("2026-10-30", "")
    assert notes.between("2026-01-01", "2026-12-31") == [
        {"date": "2026-11-02", "text": "Short day"}
    ]
