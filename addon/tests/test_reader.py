from __future__ import annotations

import pytest
from anki.collection import Collection

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
