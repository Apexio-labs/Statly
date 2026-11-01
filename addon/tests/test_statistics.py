"""Exact results on real collections. Each test states what the numbers must be."""

from __future__ import annotations

import base64
import hashlib
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.core.contract import Contract
from statly.core.errors import InvalidParams
from statly.core.reader import CollectionReader
from statly.modules.mobile import writer
from statly.modules.statistics import _METRICS, anki_stats, metrics
from statly.modules.statistics.cache import ResultCache
from statly.modules.statistics.calendar import AnkiCalendar

HOUR = 3600
DAY = 86_400
ANKI_VIEWS = list(anki_stats._VIEWS)


class Log:
    """Adds review rows at exact moments relative to the current Anki day."""

    def __init__(self, collection: Collection) -> None:
        self.collection = collection
        self.database: Any = collection.db
        self.database.execute("delete from revlog")
        self.card_ids: list[int] = self.database.list("select id from cards order by id")
        self.next_ms = 0

    @property
    def today_start(self) -> int:
        return self.collection.sched.day_cutoff - DAY

    def review(
        self,
        day: int = 0,
        *,
        hour: float = 12,
        card: int = 0,
        ease: int = 3,
        kind: int = 1,
        last_interval: int = 10,
        interval: int = 12,
        elapsed_ms: int = 5000,
    ) -> None:
        self.next_ms += 1
        moment = (self.today_start + day * DAY + int(hour * HOUR)) * 1000 + self.next_ms
        self.database.execute(
            "insert into revlog values (?, ?, -1, ?, ?, ?, 2500, ?, ?)",
            moment,
            card if card > 3 else self.card_ids[card],
            ease,
            interval,
            last_interval,
            elapsed_ms,
            kind,
        )


@pytest.fixture
def log(collection: Collection) -> Log:
    return Log(collection)


def reader_for(collection: Collection) -> CollectionReader:
    return CollectionReader(collection)


def anki_today(collection: Collection) -> date:
    return AnkiCalendar(collection.sched.day_cutoff).today


def range_of(collection: Collection, days: int = 7, deck_id: int | None = None) -> dict[str, Any]:
    today = anki_today(collection)
    return {
        "start": (today - timedelta(days=days - 1)).isoformat(),
        "end": today.isoformat(),
        "deckId": deck_id,
    }


def add_deck_card(collection: Collection, deck_name: str) -> tuple[int, int]:
    notetype: Any = collection.models.by_name("Basic")
    note = collection.new_note(notetype)
    note["Front"] = deck_name
    deck_id: Any = collection.decks.id(deck_name)
    collection.add_note(note, deck_id)
    return int(deck_id), note.cards()[0].id


def test_summary_counts_answers_and_ignores_manual_changes(log: Log) -> None:
    log.review(ease=1, elapsed_ms=1000)
    log.review(ease=3, elapsed_ms=2000)
    log.review(ease=4, elapsed_ms=3000)
    log.review(ease=0, kind=4, elapsed_ms=9999)
    log.review(ease=0, kind=5, elapsed_ms=9999)

    result = metrics.summary(range_of(log.collection), reader_for(log.collection))

    assert result["reviews"] == 3
    assert result["studyTimeMs"] == 6000
    assert result["successRate"] == pytest.approx(2 / 3)
    assert result["activeDays"] == 1


def test_retention_only_counts_mature_review_answers(log: Log) -> None:
    log.review(kind=1, ease=3, last_interval=10)
    log.review(kind=1, ease=1, last_interval=10)
    log.review(kind=0, ease=1, last_interval=0)
    log.review(kind=1, ease=1, last_interval=-600)

    result = metrics.summary(range_of(log.collection), reader_for(log.collection))

    assert result["retention"] == pytest.approx(0.5)
    assert result["successRate"] == pytest.approx(0.25)


def test_empty_range_has_no_rates(log: Log) -> None:
    result = metrics.summary(range_of(log.collection), reader_for(log.collection))
    assert result == {
        "reviews": 0,
        "studyTimeMs": 0,
        "successRate": None,
        "retention": None,
        "activeDays": 0,
    }


def test_rollover_decides_which_day_a_review_belongs_to(log: Log) -> None:
    """Prototype bug: a review at 02:00 counted for the new calendar day."""
    log.collection.set_config("rollover", 4)
    today_start = log.today_start
    assert datetime.fromtimestamp(today_start).hour == 4

    log.review(day=-1, hour=23)  # 03:00 local, still the previous Anki day
    log.review(day=0, hour=1)  # 05:00 local, the current Anki day

    today = anki_today(log.collection)
    only_today = {"start": today.isoformat(), "end": today.isoformat(), "deckId": None}
    assert metrics.summary(only_today, reader_for(log.collection))["reviews"] == 1


def test_streak_continues_across_new_year(log: Log) -> None:
    """Prototype bug: both streaks stopped at the start of the selected year."""
    today = anki_today(log.collection)
    days_into_year = (today - date(today.year, 1, 1)).days
    for offset in range(days_into_year + 10):
        log.review(day=-offset)

    result = metrics.heatmap({"year": None, "deckId": None}, reader_for(log.collection))

    assert result["currentStreak"] == days_into_year + 10
    assert result["longestStreak"] == days_into_year + 10


def test_unfinished_today_does_not_end_a_streak(log: Log) -> None:
    log.review(day=-1)
    log.review(day=-2)
    result = metrics.heatmap({"year": None, "deckId": None}, reader_for(log.collection))
    assert result["currentStreak"] == 2


def test_a_missed_day_ends_the_current_streak_but_not_the_longest(log: Log) -> None:
    for day in (0, -2, -3, -4):
        log.review(day=day)
    result = metrics.heatmap({"year": None, "deckId": None}, reader_for(log.collection))
    assert result["currentStreak"] == 1
    assert result["longestStreak"] == 3


def test_heatmap_reports_the_year_with_real_dates(log: Log) -> None:
    today = anki_today(log.collection)
    log.review(day=0)
    log.review(day=0)
    log.review(day=-370)

    result = metrics.heatmap({"year": None, "deckId": None}, reader_for(log.collection))
    assert {"date": today.isoformat(), "reviews": 2} in result["days"]
    assert result["firstYear"] <= today.year - 1
    assert result["lastYear"] == today.year
    assert result["today"] == today.isoformat()

    last_year = metrics.heatmap(
        {"year": today.year - 1, "deckId": None}, reader_for(log.collection)
    )
    assert last_year["year"] == today.year - 1


def test_deleted_cards_stay_in_the_history(log: Log) -> None:
    """Prototype bug: joining cards dropped the reviews of deleted cards."""
    log.review()
    log.review(card=999_999)

    reader = reader_for(log.collection)
    assert metrics.summary(range_of(log.collection), reader)["reviews"] == 2
    activity = metrics.deck_activity(range_of(log.collection), reader)
    assert {"deckId": None, "name": None, "reviews": 1} in activity


def test_orphaned_deck_does_not_break_activity(log: Log) -> None:
    """Prototype bug: a card in a deck that no longer exists crashed the dashboard."""
    log.review()
    log.database.execute("update cards set did = 424242 where id = ?", log.card_ids[0])
    activity = metrics.deck_activity(range_of(log.collection), reader_for(log.collection))
    assert activity == [{"deckId": None, "name": None, "reviews": 1}]


def test_filtered_cards_count_for_their_home_deck(log: Log) -> None:
    """Prototype bug: cards in a filtered deck vanished from their real deck."""
    home_id, card_id = add_deck_card(log.collection, "Home")
    log.review(card=card_id)
    log.database.execute("update cards set did = 1, odid = ? where id = ?", home_id, card_id)

    reader = reader_for(log.collection)
    activity = metrics.deck_activity(range_of(log.collection), reader)
    assert activity == [{"deckId": home_id, "name": "Home", "reviews": 1}]
    assert metrics.summary(range_of(log.collection, deck_id=home_id), reader)["reviews"] == 1
    assert metrics.card_states({"deckId": home_id}, reader)["new"] == 1


def test_deck_filter_includes_subdecks_only(log: Log) -> None:
    parent_id, parent_card = add_deck_card(log.collection, "Lang")
    _, child_card = add_deck_card(log.collection, "Lang::Spanish")
    _, other_card = add_deck_card(log.collection, "Language")
    for card in (parent_card, child_card, other_card):
        log.review(card=card)

    result = metrics.summary(
        range_of(log.collection, deck_id=parent_id), reader_for(log.collection)
    )
    assert result["reviews"] == 2


def test_unknown_deck_is_reported(log: Log) -> None:
    with pytest.raises(InvalidParams):
        metrics.summary(range_of(log.collection, deck_id=5), reader_for(log.collection))


def test_due_ignores_cards_that_are_not_due_yet(log: Log) -> None:
    """Prototype bug: future day-learning cards always counted as due."""
    today = log.collection.sched.today
    now = int(time.time())
    rows = [
        (2, today - 3),  # overdue review
        (2, today),  # due review
        (2, today + 1),  # future review
        (3, today),  # due day learning
        (3, today + 1),  # future day learning
        (1, now - 60),  # due learning
        (1, now + DAY * 2),  # future learning
    ]
    log.database.execute("delete from cards")
    for index, (queue, due) in enumerate(rows, start=1):
        log.database.execute(
            "insert into cards values (?, 1, 1, 0, 0, -1, 2, ?, ?, 1, 2500, 1, 0, 0, 0, 0, 0, '')",
            index,
            queue,
            due,
        )

    assert metrics.due({"deckId": None}, reader_for(log.collection)) == {"cards": 4}


def test_forecast_moves_overdue_cards_to_today_and_uses_anki_days(log: Log) -> None:
    """Prototype bug: offsets came from Anki's day, dates from the wall clock."""
    today = log.collection.sched.today
    log.database.execute("delete from cards")
    for index, due in enumerate((today - 5, today, today + 2, today + 6, today + 7), start=1):
        log.database.execute(
            "insert into cards values (?, 1, 1, 0, 0, -1, 2, 2, ?, 1, 2500, 1, 0, 0, 0, 0, 0, '')",
            index,
            due,
        )

    result = metrics.forecast({"deckId": None}, reader_for(log.collection))

    first = anki_today(log.collection)
    assert [item["cards"] for item in result] == [2, 0, 1, 0, 0, 0, 1]
    assert result[2]["date"] == (first + timedelta(days=2)).isoformat()


def test_card_states_group_every_queue(log: Log) -> None:
    log.database.execute("delete from cards")
    for index, queue in enumerate((0, 0, 1, 3, 2, -1, -2, -3, 4), start=1):
        log.database.execute(
            "insert into cards values (?, 1, 1, 0, 0, -1, 2, ?, 0, 1, 2500, 1, 0, 0, 0, 0, 0, '')",
            index,
            queue,
        )

    result = metrics.card_states({"deckId": None}, reader_for(log.collection))

    assert result == {
        "new": 2,
        "learning": 2,
        "review": 1,
        "suspended": 1,
        "buried": 2,
        "other": 1,
    }


def test_categories_count_unique_cards(log: Log) -> None:
    log.review(card=0, kind=0, ease=1)
    log.review(card=0, kind=1, ease=3, interval=30)
    log.review(card=1, kind=2, ease=3, interval=2)
    log.database.execute("update cards set queue = -1 where id = ?", log.card_ids[1])

    result = metrics.categories(range_of(log.collection), reader_for(log.collection))

    assert result == {
        "total": 2,
        "failed": 1,
        "new": 1,
        "reviewed": 1,
        "relearned": 1,
        "longInterval": 1,
        "suspended": 1,
        "buried": 0,
    }


def test_answer_buttons(log: Log) -> None:
    for ease in (1, 1, 2, 3, 3, 3, 4):
        log.review(ease=ease)
    assert metrics.answer_buttons(range_of(log.collection), reader_for(log.collection)) == {
        "again": 2,
        "hard": 1,
        "good": 3,
        "easy": 1,
    }


def test_rhythm_uses_local_time(log: Log) -> None:
    moment = datetime.fromtimestamp(log.today_start + 6 * HOUR)
    log.review(hour=6)
    log.review(hour=6)

    result = metrics.rhythm(range_of(log.collection), reader_for(log.collection))

    assert result["hours"][moment.hour] == 2
    assert result["weekdays"][moment.weekday()] == 2
    assert sum(result["hours"]) == sum(result["weekdays"]) == 2


@pytest.mark.parametrize(
    ("days", "granularity"), [(7, "day"), (31, "day"), (32, "week"), (180, "week"), (181, "month")]
)
def test_timeline_chooses_its_granularity(log: Log, days: int, granularity: str) -> None:
    result = metrics.timeline(range_of(log.collection, days), reader_for(log.collection))
    assert result["granularity"] == granularity


def test_timeline_fills_gaps_and_tracks_the_average(log: Log) -> None:
    log.review(day=0)
    log.review(day=0)
    log.review(day=-2)

    result = metrics.timeline(range_of(log.collection, days=3), reader_for(log.collection))

    assert [item["reviews"] for item in result["items"]] == [1, 0, 2]
    assert result["items"][-1]["runningAverage"] == pytest.approx(1)


def test_today_reports_the_first_review(log: Log) -> None:
    today = anki_today(log.collection)
    assert metrics.today({}, reader_for(log.collection)) == {
        "date": today.isoformat(),
        "firstReview": None,
    }
    log.review(day=-3)
    first = metrics.today({}, reader_for(log.collection))["firstReview"]
    assert first == (today - timedelta(days=3)).isoformat()


def test_range_cannot_be_reversed_or_invalid(log: Log) -> None:
    reader = reader_for(log.collection)
    for start, end in (("2024-02-30", "2024-03-01"), ("2024-03-02", "2024-03-01")):
        with pytest.raises(InvalidParams):
            metrics.summary({"start": start, "end": end, "deckId": None}, reader)


def table_fingerprint(collection: Collection) -> dict[str, str]:
    database: Any = collection.db
    tables = database.list("select name from sqlite_master where type = 'table'")
    return {
        table: hashlib.sha256(repr(database.all(f"select * from {table}")).encode()).hexdigest()
        for table in tables
        if table != "sqlite_stat1"
    }


def all_calls(collection: Collection) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    for name in _METRICS:
        if name in ("statistics.today", "statistics.decks"):
            params: dict[str, Any] = {}
        elif name == "statistics.heatmap":
            params = {"year": None, "deckId": None}
        elif name in ("statistics.due", "statistics.forecast", "statistics.cardStates"):
            params = {"deckId": None}
        else:
            params = range_of(collection, 30)
        calls.append((name, params))
    return calls


def test_running_everything_mid_review_changes_nothing(collection: Collection) -> None:
    """The promise that matters most: statistics cannot touch cards or the review session."""
    tables_before = table_fingerprint(collection)
    undo_before = collection.undo_status()
    counts_before = collection.sched.counts()
    modified_before = collection.mod
    schema_before: Any = collection.db.scalar("select scm from col")  # type: ignore[union-attr]

    reader = reader_for(collection)
    for name, params in all_calls(collection):
        _METRICS[name](params, reader)

    undo_after = collection.undo_status()
    assert table_fingerprint(collection) == tables_before
    assert undo_after.undo == undo_before.undo == "Answer Card"
    assert undo_after.last_step == undo_before.last_step
    assert collection.sched.counts() == counts_before
    assert collection.mod == modified_before
    assert collection.db.scalar("select scm from col") == schema_before  # type: ignore[union-attr]


class Counting:
    def __init__(self, handler: Callable[[Any, CollectionReader], Any]) -> None:
        self.handler = handler
        self.calls = 0

    def __call__(self, params: Any, reader: CollectionReader) -> Any:
        self.calls += 1
        return self.handler(params, reader)


def test_cache_returns_stored_results_until_the_data_changes(log: Log) -> None:
    counting = Counting(metrics.summary)
    cached = ResultCache().wrap("summary", counting)
    params = range_of(log.collection)
    reader = reader_for(log.collection)

    cached(params, reader)
    cached(params, reader)
    assert counting.calls == 1

    cached({**params, "deckId": None, "end": params["end"]}, reader)
    assert counting.calls == 1

    log.review()
    assert cached(params, reader)["reviews"] == 1
    assert counting.calls == 2


def test_cache_can_be_cleared(log: Log) -> None:
    cache = ResultCache()
    counting = Counting(metrics.summary)
    cached = cache.wrap("summary", counting)
    params = range_of(log.collection)
    reader = reader_for(log.collection)
    cached(params, reader)
    cache.clear()
    cached(params, reader)
    assert counting.calls == 2


def anki_view(collection: Collection, view: str, range_: str = "all", option: bool = False) -> Any:
    reader = reader_for(collection)
    params = {"view": view, "deckId": None, "range": range_, "option": option}
    return anki_stats.view(params, anki_stats.load({"deckId": None}, reader), reader)


@pytest.mark.parametrize("view", ANKI_VIEWS)
def test_every_anki_view_fits_the_contract(collection: Collection, view: str) -> None:
    for option in (False, True):
        Contract().check_result("statistics.ankiView", anki_view(collection, view, "all", option))


@pytest.mark.parametrize("range_", ["month", "threeMonths", "year", "all", "half", "most"])
def test_anki_views_take_every_range(collection: Collection, range_: str) -> None:
    for view in ANKI_VIEWS:
        Contract().check_result("statistics.ankiView", anki_view(collection, view, range_))


def test_anki_views_change_nothing_mid_review(collection: Collection) -> None:
    tables_before = table_fingerprint(collection)
    undo_before = collection.undo_status()
    counts_before = collection.sched.counts()
    modified_before = collection.mod
    schema_before: Any = collection.db.scalar("select scm from col")  # type: ignore[union-attr]

    for view in ANKI_VIEWS:
        anki_view(collection, view)
    deck: Any = collection.decks.id("Test")
    reader_for(collection).graphs(deck)

    undo_after = collection.undo_status()
    assert table_fingerprint(collection) == tables_before
    assert undo_after.undo == undo_before.undo == "Answer Card"
    assert undo_after.last_step == undo_before.last_step
    assert collection.sched.counts() == counts_before
    assert collection.mod == modified_before
    assert collection.db.scalar("select scm from col") == schema_before  # type: ignore[union-attr]


def test_anki_reviews_agree_with_the_review_log(collection: Collection) -> None:
    database: Any = collection.db
    logged = database.scalar("select count() from revlog where type in (0, 1, 2, 3)")
    result = anki_view(collection, "reviews")
    assert sum(sum(point["values"]) for point in result["points"]) == logged


def test_anki_review_time_is_reported_in_minutes(collection: Collection) -> None:
    database: Any = collection.db
    database.execute("update revlog set time = 60000")
    logged = database.scalar("select count() from revlog")
    result = anki_view(collection, "reviews", "all", True)
    assert result["unit"] == "minutes"
    assert round(sum(sum(point["values"]) for point in result["points"])) == logged


def test_anki_counts_can_keep_suspended_cards_apart(collection: Collection) -> None:
    card = collection.find_cards("")[0]
    collection.sched.suspend_cards([card])
    apart = {
        item["name"]: item["value"]
        for item in anki_view(collection, "card-counts", "all", True)["items"]
    }
    together = {
        item["name"]: item["value"] for item in anki_view(collection, "card-counts")["items"]
    }
    assert apart["suspended"] == 1
    assert together["suspended"] == 0


def test_anki_statistics_skip_the_phone_card(collection: Collection) -> None:
    before = anki_view(collection, "card-counts")["total"]
    writer.set_up(collection, base64.b64encode(b"{}").decode())
    assert anki_view(collection, "card-counts")["total"] == before


def test_anki_statistics_follow_the_deck(collection: Collection) -> None:
    reader = reader_for(collection)
    other: Any = collection.decks.id('Other: with "quotes" and *stars*')
    empty = reader.graphs(other)
    assert sum(dict(empty.added.added).values()) == 0
    assert reader.graphs(123456789).today.answer_count == 0


def test_fsrs_sections_say_so_without_fsrs(collection: Collection) -> None:
    collection.set_config("fsrs", False)
    assert anki_view(collection, "stability")["available"] is False
    assert anki_view(collection, "retrievability")["available"] is False
    assert anki_view(collection, "difficulty")["mode"] == "ease"


def test_fsrs_sections_fill_up_with_fsrs(tmp_path: Path) -> None:
    """A fresh collection, because Anki settles on FSRS before the first review."""
    collection = Collection(str(tmp_path / "fsrs.anki2"))
    collection.set_config("fsrs", True)
    deck: Any = collection.decks.id("Test")
    for index in range(4):
        note = collection.newNote()
        note["Front"] = f"front {index}"
        collection.add_note(note, deck)
    collection.decks.select(deck)
    scheduler: Any = collection.sched
    for _ in range(3):
        card = scheduler.getCard()
        states = collection._backend.get_scheduling_states(card.id)
        scheduler.answer_card(
            scheduler.build_answer(card=card, states=states, rating=CardAnswer.EASY)
        )
    stability = anki_view(collection, "stability")
    assert stability["available"] is True
    assert stability["points"]
    assert anki_view(collection, "difficulty")["mode"] == "difficulty"
    assert anki_view(collection, "retrievability")["facts"][0]["name"] == "averageRetrievability"
    collection.close()


def test_bars_never_lose_cards_at_their_edges() -> None:
    counts = {0: 2, 3: 4, 7: 1, 45: 3}
    points = anki_stats._bars(counts, 0, 45, 5)
    assert sum(point["value"] for point in points) == 10
    assert points[-1]["running"] == 1


def test_quantiles_walk_counted_cards() -> None:
    counts = {1: 50, 10: 40, 100: 10}
    assert anki_stats._quantile(counts, 0.5) == 1
    assert anki_stats._quantile(counts, 0.95) == 100
    assert anki_stats._quantile({}, 0.5) == 0


def test_long_histories_stay_within_the_bars_a_chart_can_show() -> None:
    bins = list(anki_stats._time_bins(-3000, 0))
    assert len(bins) <= 60
    assert bins[0][0] == -3000
    assert bins[-1][1] == 0
    assert all(later[0] == earlier[1] + 1 for earlier, later in pairwise(bins))
