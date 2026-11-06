"""The stopwatch's table in Statly's own database. Card ids and times only, never card content."""

from __future__ import annotations

from collections.abc import Iterable

from ...core.localdb import Tables
from ..review import Attempt


def _attempts_table(tables: Tables) -> None:
    tables.run(
        """CREATE TABLE attempts (
            id INTEGER PRIMARY KEY,
            card_id INTEGER NOT NULL,
            deck_id INTEGER NOT NULL,
            card_type INTEGER NOT NULL,
            queue INTEGER NOT NULL,
            shown_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            inactive_ms INTEGER NOT NULL,
            ease INTEGER NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        )"""
    )
    tables.run("CREATE INDEX attempts_by_time ON attempts (shown_at)")
    tables.run("CREATE INDEX attempts_by_card ON attempts (card_id, shown_at)")


SCHEMA = (_attempts_table,)


def row_of(attempt: Attempt) -> tuple[int, ...]:
    return (
        attempt.card_id,
        attempt.deck_id,
        attempt.card_type,
        attempt.queue,
        round(attempt.shown_at * 1000),
        round(attempt.seconds * 1000),
        round(attempt.inactive * 1000),
        attempt.ease,
        int(attempt.undone),
    )


def add(tables: Tables, rows: Iterable[tuple[int, ...]]) -> None:
    tables.run_many(
        """INSERT INTO attempts (card_id, deck_id, card_type, queue, shown_at, duration_ms,
            inactive_ms, ease, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )


def mark_undone(tables: Tables, card_id: int, shown_at_ms: int) -> None:
    tables.run(
        "UPDATE attempts SET undone = 1 WHERE card_id = ? AND shown_at = ?",
        (card_id, shown_at_ms),
    )
