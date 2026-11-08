"""How much time went into new cards, by day, week or month, compared with the usual pace.

Only notes that still exist count, with their cards as they are now and the current deck of
their first card, as every other statistic counts decks. A note that was added and then undone
or deleted therefore drops out by itself.

"Usual" is the time per card over all decks and every note ever measured, so a deck or a range
can be compared with how the person makes cards in general.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any

from ...core.reader import CollectionReader
from ..statistics.calendar import AnkiCalendar
from ..statistics.scope import bucket_of, deck_ids, granularity_of, period_from_params

# Stays well below SQLite's limit for parameters in one statement.
_CHUNK = 500


def _current(reader: CollectionReader, note_ids: Sequence[int]) -> dict[int, tuple[int, int]]:
    """Each note that still exists: the home deck of its first card and how many cards it has."""
    found: dict[int, tuple[int, int]] = {}
    for start in range(0, len(note_ids), _CHUNK):
        chunk = note_ids[start : start + _CHUNK]
        marks = ", ".join("?" for _ in chunk)
        rows = reader.rows(
            f"""
            SELECT nid, CASE WHEN odid THEN odid ELSE did END, ord
            FROM cards WHERE nid IN ({marks})
            """,
            *chunk,
        )
        first: dict[int, tuple[int, int]] = {}
        counts: dict[int, int] = {}
        for note_id, deck_id, order in rows:
            counts[note_id] = counts.get(note_id, 0) + 1
            if note_id not in first or order < first[note_id][1]:
                first[note_id] = (deck_id, order)
        for note_id, (deck_id, _order) in first.items():
            found[note_id] = (deck_id, counts[note_id])
    return found


def summarize(
    params: Any, reader: CollectionReader, measured: Sequence[Sequence[Any]]
) -> dict[str, Any]:
    """``measured`` holds rows of note id, deck, cards, added at (ms) and duration (ms)."""
    calendar = AnkiCalendar(reader.day_cutoff)
    period = period_from_params(params, calendar)
    decks = deck_ids(reader, params["deckId"])
    wanted = set(decks) if decks is not None else None
    alive = _current(reader, [int(row[0]) for row in measured])

    granularity = granularity_of(period)
    buckets: dict[date, dict[str, Any]] = {}
    for offset in range(period.days):
        start = bucket_of(period.first_day + timedelta(days=offset), granularity)
        buckets.setdefault(
            start, {"date": start.isoformat(), "seconds": 0.0, "cards": 0, "notes": 0}
        )

    usual_seconds, usual_cards = 0.0, 0
    first_measured: int | None = None
    start_ms, end_ms = period.bounds()
    for note_id, _deck, _cards, added_at, duration_ms in measured:
        now = alive.get(int(note_id))
        if now is None:
            continue
        deck_id, cards = now
        seconds = duration_ms / 1000
        usual_seconds += seconds
        usual_cards += cards
        if first_measured is None:
            first_measured = int(added_at)
        if not start_ms <= added_at < end_ms or (wanted is not None and deck_id not in wanted):
            continue
        day = calendar.day_of(int(added_at) // 1000)
        bucket = buckets.get(bucket_of(day, granularity))
        if bucket is None:
            continue
        bucket["seconds"] += seconds
        bucket["cards"] += cards
        bucket["notes"] += 1

    items = list(buckets.values())
    return {
        "granularity": granularity,
        "items": items,
        "total": {
            "seconds": sum(item["seconds"] for item in items),
            "cards": sum(item["cards"] for item in items),
            "notes": sum(item["notes"] for item in items),
        },
        "usualSecondsPerCard": usual_seconds / usual_cards if usual_cards else None,
        "measuredSince": (
            calendar.day_of(first_measured // 1000).isoformat()
            if first_measured is not None
            else None
        ),
    }
