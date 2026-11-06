"""How long someone really spent on a card, from the stopwatch's attempts. Pure arithmetic."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Timed:
    card_id: int
    seconds: float
    inactive: float
    undone: bool


def time_at_card(attempts: Sequence[Timed]) -> list[tuple[int, float]]:
    """Each answer that stands, with all the time its card took, undone looks included.

    Anki keeps only the last look: 40 seconds, undo, then 1 second leaves 1 second in Anki's
    history, while the person spent 41. Time with Anki in the background does not count.
    Attempts must be in the order they happened.
    """
    found: list[tuple[int, float]] = []
    carried: dict[int, float] = {}
    for attempt in attempts:
        active = max(0.0, attempt.seconds - attempt.inactive)
        total = carried.pop(attempt.card_id, 0.0) + active
        if attempt.undone:
            carried[attempt.card_id] = total
        else:
            found.append((attempt.card_id, total))
    return found


def measured_answers(
    rows: Sequence[tuple[int, int, int, int, int]],
) -> dict[tuple[int, int], float]:
    """Stopwatch rows (card, shown ms, duration ms, background ms, undone), oldest first.

    Returns the time each answer that stands took, undone looks included, keyed by card and the
    second it was given, which is when Anki's history has it too.
    """
    found: dict[tuple[int, int], float] = {}
    carried: dict[int, float] = {}
    for card_id, shown_ms, duration_ms, inactive_ms, undone in rows:
        active = max(0.0, (duration_ms - inactive_ms) / 1000)
        total = carried.pop(card_id, 0.0) + active
        if undone:
            carried[card_id] = total
        else:
            found[(card_id, (shown_ms + duration_ms) // 1000)] = total
    return found
