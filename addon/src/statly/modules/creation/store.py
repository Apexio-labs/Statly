"""The creation stopwatch's table in Statly's own database. Ids and times only, never content."""

from __future__ import annotations

from typing import Any

from ...core.localdb import Tables
from .clock import Created


def _creations_table(tables: Tables) -> None:
    tables.run(
        """CREATE TABLE creations (
            note_id INTEGER PRIMARY KEY,
            deck_id INTEGER NOT NULL,
            cards INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            capped INTEGER NOT NULL DEFAULT 0,
            precise INTEGER NOT NULL DEFAULT 1
        )"""
    )
    tables.run("CREATE INDEX creations_by_time ON creations (added_at)")


SCHEMA = (_creations_table,)


def add(tables: Tables, created: Created) -> None:
    tables.run(
        """INSERT OR REPLACE INTO creations
            (note_id, deck_id, cards, added_at, duration_ms, capped, precise)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            created.note_id,
            created.deck_id,
            created.cards,
            round(created.added_at * 1000),
            round(created.seconds * 1000),
            int(created.capped),
            int(created.precise),
        ),
    )


def everything(tables: Tables) -> list[tuple[Any, ...]]:
    """Every measured note: id, deck, cards, when in milliseconds and how long in milliseconds."""
    return tables.rows(
        "SELECT note_id, deck_id, cards, added_at, duration_ms FROM creations ORDER BY added_at"
    )
