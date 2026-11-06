"""When a learned card comes back: the first gap, and the reviews it brings in the days after.

Pure arithmetic over Anki's answers. A card is learned on its first answer with an interval of at
least a day. Its first gap is that interval. The echo says, for each day after learning, how many
reviews a learned card brought on average, measured on cards learned long enough ago. Both work
the same for SM-2 and FSRS, because they only look at what Anki did. Later, Anki's own FSRS
simulator could replace the echo.
"""

from __future__ import annotations

import math
from bisect import bisect_left
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence

from .sessions import DAY_MS, Answer

# The share of first gaps that came at least this soon: a little room, not the average.
_SHARE = 0.75
# A deck with few learned cards leans on the person's overall gap as if it had this many.
_LEAN = 20.0
ECHO_DAYS = 60
_ENOUGH_CARDS = 20
_GROWTH = 2.5


def first_gaps(answers: Iterable[Answer]) -> dict[int | None, list[int]]:
    """Each learned card's first interval in days, by home deck."""
    seen: set[int] = set()
    found: dict[int | None, list[int]] = defaultdict(list)
    for answer in answers:
        if answer.kind == 0 and answer.interval > 0 and answer.card_id not in seen:
            seen.add(answer.card_id)
            found[answer.deck_id].append(answer.interval)
    return found


def quantile(values: Sequence[float], share: float) -> float:
    ordered = sorted(values)
    position = share * (len(ordered) - 1)
    below = int(position)
    above = min(below + 1, len(ordered) - 1)
    return ordered[below] + (ordered[above] - ordered[below]) * (position - below)


def first_gap(gaps: Mapping[int | None, Sequence[int]], decks: Iterable[int], fallback: int) -> int:
    """Days until a card learned in these decks most likely comes back, rounded up.

    Measured from the decks' own cards, leaning on the person's overall gap when they are few,
    and ``fallback`` (the deck's graduating interval) without any history.
    """
    chosen = [gap for deck in decks for gap in gaps.get(deck, ())]
    everything = [gap for found in gaps.values() for gap in found]
    if not everything:
        return max(1, fallback)
    overall = quantile(everything, _SHARE)
    if not chosen:
        return max(1, math.ceil(overall))
    own = quantile(chosen, _SHARE)
    leaned = (len(chosen) * own + _LEAN * overall) / (len(chosen) + _LEAN)
    return max(1, math.ceil(leaned))


def echo(answers: Sequence[Answer], today_start_ms: int) -> tuple[float | None, ...]:
    """Reviews per learned card on each day after learning, index 0 being the day itself.

    None where too few cards were learned long enough ago to know.
    """
    learned: dict[int, int] = {}
    for answer in answers:
        if answer.kind == 0 and answer.interval > 0 and answer.card_id not in learned:
            learned[answer.card_id] = _day(answer.at_ms, today_start_ms)
    reviews = [0] * (ECHO_DAYS + 1)
    for answer in answers:
        start = learned.get(answer.card_id)
        if answer.kind in (1, 2) and start is not None:
            after = _day(answer.at_ms, today_start_ms) - start
            if 1 <= after <= ECHO_DAYS:
                reviews[after] += 1
    ages = sorted(-start for start in learned.values())
    found: list[float | None] = [None]
    for after in range(1, ECHO_DAYS + 1):
        # Cards learned at least ``after`` days before today could show that day completely.
        known = len(ages) - bisect_left(ages, after + 1)
        found.append(reviews[after] / known if known >= _ENOUGH_CARDS else None)
    return tuple(found)


def echo_with_fallback(measured: Sequence[float | None], gap: int) -> tuple[float, ...]:
    """The measured echo, and where it is unknown, one review at the first gap and then at
    intervals growing as Anki's do by default."""
    assumed = [0.0] * (ECHO_DAYS + 1)
    day, step = gap, gap
    while day <= ECHO_DAYS:
        assumed[day] = 1.0
        step = max(step + 1, round(step * _GROWTH))
        day += step
    return tuple(
        value if value is not None else assumed[index] for index, value in enumerate(measured)
    )


def _day(at_ms: int, today_start_ms: int) -> int:
    """The Anki day of a moment, counted from today: 0 today, -1 yesterday."""
    return math.floor((at_ms - today_start_ms) / DAY_MS)
