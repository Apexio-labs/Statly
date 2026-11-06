"""What Anki's history says about each answer's real time. Pure: no SQL, no clock.

Anki keeps the time from question to answer, but stops counting at the deck's limit (mostly 60
seconds), and keeps nothing of a look that was undone. Answers are stored to the millisecond, so
the gap to the previous answer tells more:

- Below the limit, Anki's time is exact.
- At the limit, the answer took between the limit and the gap, unless the gap was a break.
- A gap clearly longer than usual, but shorter than a break, most likely held an undo or an edit
  of that card, so the extra time belongs to it. Without the stopwatch this is the best guess.
- Where the stopwatch measured an answer, its time replaces all of this.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from statistics import median
from typing import NamedTuple

from .censored import Observation

# A gap longer than this many usual gaps, or than the limit plus a minute, ends a session.
_BREAK_TIMES = 5.0
_BREAK_AFTER_LIMIT = 60.0
# Time outside a card counts towards it from three usual gaps on, for at most two minutes.
_EXTRA_FROM = 3.0
_EXTRA_AT_MOST = 120.0
# Anki's clock stops at the limit. Times this close to it count as cut off.
_AT_LIMIT = 0.5
_DEFAULT_BETWEEN = 3.0
_HALF_LIFE_DAYS = 30.0
DAY_MS = 86_400_000

LEARN = "learn"
REVIEW = "review"
RELEARN = "relearn"


class Answer(NamedTuple):
    """One answer from Anki's history. Tuples, because there are tens of thousands of them."""

    at_ms: int
    card_id: int
    deck_id: int | None
    kind: int
    """Anki's answer type: 0 learning, 1 review, 2 relearning, 3 in a filtered deck."""
    taken_ms: int
    interval: int = 0
    """The interval Anki gave: days when positive, seconds of a learning step when negative."""


def state_of(kind: int) -> str:
    return LEARN if kind == 0 else RELEARN if kind == 2 else REVIEW


class Observed(NamedTuple):
    """One answer as the model sees it."""

    answer: Answer
    state: str
    observation: Observation
    day: int
    """Days before today: 0 is today, 1 yesterday."""


@dataclass(frozen=True)
class History:
    observed: tuple[Observed, ...]
    between: float
    """Typical seconds between two cards: the next one appearing, reading it, moving on."""


def read_history(
    answers: Sequence[Answer],
    limit_of: Callable[[int | None], float],
    today_start_ms: int,
    measured: Mapping[tuple[int, int], float] | None = None,
) -> History:
    """Turn answers, oldest first, into observations. ``measured`` maps (card, second) to time."""
    limits: dict[int | None, float] = {}
    gaps: list[float | None] = []
    previous: int | None = None
    for answer in answers:
        gaps.append(None if previous is None else (answer.at_ms - previous) / 1000)
        previous = answer.at_ms
        if answer.deck_id not in limits:
            limits[answer.deck_id] = limit_of(answer.deck_id)
    usual = median([gap for gap in gaps if gap is not None and gap < 600] or [20.0])
    ends = {deck: _ends_session(limit, usual) for deck, limit in limits.items()}

    outside: list[float] = []
    for answer, gap in zip(answers, gaps, strict=True):
        taken = answer.taken_ms / 1000
        if (
            gap is not None
            and taken < limits[answer.deck_id] - _AT_LIMIT
            and gap < ends[answer.deck_id]
        ):
            outside.append(max(gap - taken, 0.0))
    between = min(max(median(outside), 0.5), 30.0) if outside else _DEFAULT_BETWEEN

    measured = measured or {}
    states = {0: LEARN, 2: RELEARN}
    decay = math.log(0.5) / (_HALF_LIFE_DAYS * DAY_MS)
    observed: list[Observed] = []
    for answer, gap in zip(answers, gaps, strict=True):
        limit = limits[answer.deck_id]
        taken = answer.taken_ms / 1000
        joined = gap is not None and gap < ends[answer.deck_id]
        before_today = today_start_ms - answer.at_ms
        weight = math.exp(decay * before_today) if before_today > 0 else 1.0
        # Anki writes an answer a moment after the button, so the second may have turned.
        second = answer.at_ms // 1000
        stopwatch = measured.get((answer.card_id, second)) or measured.get(
            (answer.card_id, second - 1)
        )
        if stopwatch is not None:
            low = high = stopwatch
        elif taken < limit - _AT_LIMIT:
            low = high = taken
            if joined and gap is not None and gap - taken > _EXTRA_FROM * between:
                low = high = taken + min(gap - taken - between, _EXTRA_AT_MOST)
        elif joined and gap is not None and gap - between > limit + _AT_LIMIT:
            low, high = limit, gap - between
        elif joined:
            low = high = limit
        else:
            low, high = limit, math.inf
        day = before_today // DAY_MS + 1 if before_today > 0 else 0
        observed.append(
            Observed(answer, states.get(answer.kind, REVIEW), Observation(low, high, weight), day)
        )
    return History(tuple(observed), between)


def _ends_session(limit: float, usual: float) -> float:
    return max(limit + _BREAK_AFTER_LIMIT, _BREAK_TIMES * usual)
