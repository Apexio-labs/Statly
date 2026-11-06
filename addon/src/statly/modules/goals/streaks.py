"""Streaks are worked out from the days, never counted up, so they cannot drift. Pure."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

MILESTONES = (3, 7, 14, 30, 50, 100)

# met: the goal was reached. missed: it was not. rest: a day off or nothing to do, which neither
# counts nor breaks. pending: today, not reached yet, which puts the streak at risk only.
RESULTS = ("met", "missed", "rest", "pending")


@dataclass(frozen=True)
class DayResult:
    day: date
    result: str


@dataclass(frozen=True)
class Streak:
    current: int
    best: int
    at_risk: bool
    milestone: int | None


def streak(results: Sequence[DayResult], today: date, best_before: int = 0) -> Streak:
    """``results`` hold one entry per day since the goal began, in any order."""
    ordered = sorted(results, key=lambda entry: entry.day)
    longest = run = 0
    for entry in ordered:
        if entry.result == "met":
            run += 1
            longest = max(longest, run)
        elif entry.result == "missed":
            run = 0
    current = 0
    at_risk = False
    met_today = False
    for entry in reversed(ordered):
        if entry.result == "pending" and entry.day == today:
            at_risk = True
        elif entry.result == "met":
            current += 1
            met_today = met_today or entry.day == today
        elif entry.result == "missed":
            break
    milestone = current if met_today and current in MILESTONES else None
    return Streak(current, max(best_before, longest), at_risk and current > 0, milestone)
