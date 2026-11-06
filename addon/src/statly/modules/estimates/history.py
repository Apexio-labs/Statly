"""The one SQL of the study time model: answers of the last 90 days, oldest first."""

from __future__ import annotations

from ...core.reader import CollectionReader
from ..statistics.scope import placeholders
from .sessions import DAY_MS, Answer

DAYS = 90
# Older answers count little next to recent ones, so a very busy person's history is cut here.
# It keeps the model within its time budget: 25,000 answers are read in about 25 ms.
MOST_ANSWERS = 25_000


def answers(reader: CollectionReader, today_start_ms: int) -> list[Answer]:
    """The newest answers by button of the last ``DAYS`` days, oldest first.

    Cards deleted since keep their answers, with no deck.
    """
    excluded = reader.excluded_cards
    skip = f"AND r.cid NOT IN ({placeholders(excluded)})" if excluded else ""
    found = [
        Answer(
            int(at),
            int(card),
            int(deck) if deck is not None else None,
            int(kind),
            int(taken),
            int(interval),
        )
        for at, card, deck, kind, taken, interval in reader.rows(
            f"""SELECT r.id, r.cid, CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END, r.type,
                r.time, r.ivl
            FROM revlog AS r LEFT JOIN cards AS c ON c.id = r.cid
            WHERE r.id >= ? AND r.ease > 0 AND r.type IN (0, 1, 2, 3) {skip}
            ORDER BY r.id DESC LIMIT ?""",
            today_start_ms - DAYS * DAY_MS,
            *excluded,
            MOST_ANSWERS,
        )
    ]
    found.reverse()
    return found
