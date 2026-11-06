from __future__ import annotations

from typing import Any

import pytest
from anki.collection import Collection
from anki.decks import DeckId

from statly.core.errors import NotAllowed
from statly.core.reader import CollectionReader, checked_sql


@pytest.mark.parametrize(
    "sql",
    [
        "with x as (select 1) delete from revlog",
        "with x as (select 1) select * from x",
        "delete from revlog",
        "update cards set due = 0",
        "insert into revlog default values",
        "pragma query_only",
        "explain select 1",
        "values (1)",
        "-- comment\nselect 1",
        "/* comment */ select 1",
        "select 1; delete from revlog",
        "select 1 -- comment",
        "select 1 /* comment */",
        "selectivity",
        "",
    ],
)
def test_rejects_everything_except_plain_select(sql: str) -> None:
    with pytest.raises(NotAllowed):
        checked_sql(sql)


@pytest.mark.parametrize(
    "sql",
    ["select 1", "SELECT 1", "  select 1  ", "select\n  count()\nfrom revlog"],
)
def test_accepts_plain_select(sql: str) -> None:
    assert checked_sql(sql) == sql.strip()


def test_reads_real_values(collection: Collection) -> None:
    reader = CollectionReader(collection)
    assert reader.scalar("select count() from cards") == 3
    assert reader.column("select ease from revlog") == [3]
    assert reader.rows("select count(), sum(ease) from revlog") == [[1, 3]]
    assert reader.today == collection.sched.today
    assert reader.day_cutoff == collection.sched.day_cutoff


def test_reading_leaves_the_review_session_untouched(collection: Collection) -> None:
    status_before = collection.undo_status()
    modified_before = collection.mod
    counts_before = collection.sched.counts()

    reader = CollectionReader(collection)
    reader.rows("  select id from revlog")
    reader.scalar("SELECT\ncount() from cards")
    reader.column("select id from notes")

    status_after = collection.undo_status()
    assert status_after.undo == status_before.undo == "Answer Card"
    assert status_after.last_step == status_before.last_step
    assert collection.mod == modified_before
    assert collection.sched.counts() == counts_before
    assert collection.undo().changes is not None


def deck_named(collection: Collection, name: str) -> int:
    deck_id = collection.decks.id(name)
    assert deck_id is not None
    return int(deck_id)


def test_deck_options_follow_the_limit_that_applies_today(collection: Collection) -> None:
    reader = CollectionReader(collection)
    deck_id = deck_named(collection, "Test")
    options = reader.deck_options(deck_id)
    assert options is not None
    assert (options.new_per_day, options.reviews_per_day) == (20, 200)
    assert options.max_answer_seconds == 60
    assert options.learning_steps_minutes == (1.0, 10.0)
    assert (options.graduating_days, options.easy_days) == (1, 4)

    deck: Any = collection.decks.get(DeckId(deck_id))
    deck["newLimit"] = 30
    collection.decks.save(deck)
    assert reader.deck_options(deck_id).new_per_day == 30  # type: ignore[union-attr]

    deck = collection.decks.get(DeckId(deck_id))
    deck["newLimitToday"] = {"limit": 85, "today": collection.sched.today}
    collection.decks.save(deck)
    assert reader.deck_options(deck_id).new_per_day == 85  # type: ignore[union-attr]

    deck = collection.decks.get(DeckId(deck_id))
    deck["newLimitToday"] = {"limit": 85, "today": collection.sched.today - 1}
    collection.decks.save(deck)
    assert reader.deck_options(deck_id).new_per_day == 30  # type: ignore[union-attr]


def test_filtered_and_missing_decks_have_no_options(collection: Collection) -> None:
    reader = CollectionReader(collection)
    filtered = collection.decks.new_filtered("Cram")
    assert reader.deck_options(filtered) is None
    assert reader.deck_options(123456789) is None
    assert reader.filtered_deck_ids() == {int(filtered)}


def test_deck_families_hold_subdecks_and_report_missing_decks(collection: Collection) -> None:
    reader = CollectionReader(collection)
    parent = deck_named(collection, "Medizin")
    child = deck_named(collection, "Medizin::Anatomie")
    grandchild = deck_named(collection, "Medizin::Anatomie::Knochen")
    collection.decks.id("Medizinball")
    collection.decks.new_filtered("Medizin::Cram")

    families = reader.deck_families([parent, 987654321])

    assert families.members == {parent: (parent, *sorted([child, grandchild]))}
    assert families.missing == (987654321,)


def test_reading_options_leaves_the_review_session_untouched(collection: Collection) -> None:
    status_before = collection.undo_status()
    modified_before = collection.mod
    reader = CollectionReader(collection)

    reader.deck_options(deck_named(collection, "Test"))
    reader.deck_families([deck_named(collection, "Test")])
    reader.filtered_deck_ids()
    reader.config("rollover")

    status_after = collection.undo_status()
    assert status_after.undo == status_before.undo == "Answer Card"
    assert status_after.last_step == status_before.last_step
    assert collection.mod == modified_before


def test_anki_sqlite_knows_the_functions_goals_need(collection: Collection) -> None:
    reader = CollectionReader(collection)
    gaps = reader.column("SELECT r.id - LAG(r.id) OVER (ORDER BY r.id) FROM revlog AS r")
    assert gaps == [None]
    days = reader.scalar("SELECT GROUP_CONCAT(DISTINCT r.ease) FROM revlog AS r")
    assert days == "3"
