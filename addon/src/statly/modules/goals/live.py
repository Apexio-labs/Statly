"""Counting along while the person studies, so Statly can say the moment a day's goal is met.

The real count comes from Anki's history after the session, as always. This is a quick tally in
memory, one answer at a time, with no SQL: the reviewer must never wait for a goal.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

NEW = "new"
REVIEW = "review"


@dataclass
class LiveGoal:
    goal_id: str
    name: str
    decks: frozenset[int]
    new_left: int
    reviews_left: int
    streak_after: int
    """The streak once today is met."""
    valid_until: float
    """When the Anki day ends, in seconds since 1970. After that these numbers mean nothing."""
    reached: bool = False


def live_goal(goal: Mapping[str, Any], status: Mapping[str, Any]) -> LiveGoal | None:
    """What is still to do today, from a goal's status. None when there is nothing to reach."""
    if status["state"] not in ("active", "buffer") or status["target"] <= 0:
        return None
    new_left = status["newCards"]["target"] - status["newCards"]["done"]
    reviews = status["reviews"]
    reviews_left = reviews["target"] - reviews["done"] if reviews["counted"] else 0
    if new_left <= 0 and reviews_left <= 0:
        return None
    return LiveGoal(
        goal_id=goal["id"],
        name=goal["name"],
        decks=frozenset(int(deck["deckId"]) for deck in status["decks"]),
        new_left=new_left,
        reviews_left=reviews_left,
        streak_after=int(status["streak"]["current"]) + 1,
        valid_until=float(status["refreshAt"]),
    )


def kind_of(card_type: int, type_after: int, queue_after: int) -> str | None:
    """What an answer did for a goal, from the card before and after it.

    A card that was never learned and now is, counts as learned. A learned card counts as
    reviewed when the answer moves it to a later day, the same rule as Statly's statistics: a
    card that lapses counts only once it leaves its relearning steps for today.
    """
    if card_type in (0, 1) and type_after == 2:
        return NEW
    if card_type in (2, 3) and queue_after in (2, 3):
        return REVIEW
    return None


class LiveCounter:
    def __init__(self) -> None:
        self._goals: list[LiveGoal] = []
        self._counted: dict[int, list[tuple[LiveGoal, str]]] = {}

    def seed(self, goals: Iterable[LiveGoal]) -> None:
        self._goals = list(goals)
        self._counted.clear()

    def wants(self, deck_id: int, now: float) -> bool:
        return any(
            not goal.reached and now < goal.valid_until and deck_id in goal.decks
            for goal in self._goals
        )

    def count(self, key: int, deck_id: int, kind: str, now: float) -> list[LiveGoal]:
        """Count one answer. Returns the goals this answer completed."""
        reached: list[LiveGoal] = []
        for goal in self._goals:
            if goal.reached or now >= goal.valid_until or deck_id not in goal.decks:
                continue
            if kind == NEW:
                goal.new_left -= 1
            elif goal.reviews_left > 0:
                goal.reviews_left -= 1
            else:
                continue
            self._counted.setdefault(key, []).append((goal, kind))
            if goal.new_left <= 0 and goal.reviews_left <= 0:
                goal.reached = True
                reached.append(goal)
        return reached

    def undo(self, key: int) -> None:
        """An answer was taken back. A note already shown stays shown, but the count is fixed."""
        for goal, kind in self._counted.pop(key, []):
            if kind == NEW:
                goal.new_left += 1
            else:
                goal.reviews_left += 1
