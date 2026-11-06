"""What one computer shares about its goals, and how the shares of all computers come together.

Pure: no Anki, no files, no clock. Each computer shares its goals, the goals it deleted or
archived, the day's goals it fixed in the last week and its best streaks. Everything else, such
as what was learned, every computer reads from Anki's own history, which syncs anyway, so all of
them arrive at the same numbers.

The rules, so that nothing is lost when two computers change things before they sync:

- The newest change of a goal wins.
- Deleting wins over any change, so a deleted goal does not come back.
- Archiving counts as a change: the newer of archiving and editing wins.
- For a day, the goal that was fixed first on any computer applies, so all computers count the
  same day's goal.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, cast

from ..changes.goal_sync import MAX_BYTES, size_of

VERSION = 1
DAYS_SHARED = 7
KEEP_DELETED_DAYS = 60
# The numbers a day's goal was fixed with, in the order they are shared.
FROZEN = ("newTarget", "reviewsTarget", "openAtStart", "reviewsAtStart", "newestCard")


@dataclass
class Merged:
    """What this computer takes over from the others."""

    put: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    remove: list[str] = field(default_factory=list[str])
    deleted: dict[str, int] = field(default_factory=dict[str, int])
    days: dict[str, dict[str, dict[str, Any]]] = field(
        default_factory=dict[str, dict[str, dict[str, Any]]]
    )
    best: dict[str, int] = field(default_factory=dict[str, int])


def build_state(
    device: str,
    goals: Iterable[Mapping[str, Any]],
    deleted: Mapping[str, int],
    books: Mapping[str, Mapping[str, Any]],
    today: date,
    now: int,
) -> dict[str, Any]:
    """This computer's share, kept below ``MAX_BYTES``."""
    since = (today - timedelta(days=DAYS_SHARED - 1)).isoformat()
    oldest = now - KEEP_DELETED_DAYS * 86_400
    shared: list[dict[str, Any]] = []
    archived: dict[str, int] = {}
    days: dict[str, dict[str, list[Any]]] = {}
    best: dict[str, int] = {}
    for goal in goals:
        if goal["archived"]:
            archived[goal["id"]] = int(goal["updatedAt"])
            continue
        shared.append(dict(goal))
        book = books.get(goal["id"]) or {}
        entries = {
            day: [
                *(entry[name] for name in FROZEN),
                entry["frozenAt"],
                int(bool(entry.get("celebrated"))),
                entry.get("config", ""),
            ]
            for day, entry in sorted(book.get("days", {}).items())
            if day >= since and "frozenAt" in entry and all(name in entry for name in FROZEN)
        }
        if entries:
            days[goal["id"]] = entries
        if book.get("best"):
            best[goal["id"]] = int(book["best"])
    state: dict[str, Any] = {
        "v": VERSION,
        "device": device,
        "goals": sorted(shared, key=lambda goal: goal["id"]),
        "archived": archived,
        "deleted": {goal: at for goal, at in sorted(deleted.items()) if at >= oldest},
        "days": days,
        "best": best,
    }
    return within_limit(state)


def within_limit(state: dict[str, Any]) -> dict[str, Any]:
    """Drop the oldest shared days first, then the goals changed longest ago, until it fits.

    Dropped goals stay on this computer; the others simply do not hear of them until it fits.
    """
    days: dict[str, dict[str, Any]] = state["days"]
    while size_of(state) > MAX_BYTES and any(days.values()):
        goal, day = min(
            ((goal, min(entries)) for goal, entries in days.items() if entries),
            key=lambda found: found[1],
        )
        del days[goal][day]
        if not days[goal]:
            del days[goal]
    goals: list[dict[str, Any]] = state["goals"]
    while size_of(state) > MAX_BYTES and goals:
        oldest = min(goals, key=lambda goal: goal["updatedAt"])
        goals.remove(oldest)
        state["best"].pop(oldest["id"], None)
        state["partial"] = True
    return state


def _number(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _day(raw: Any) -> dict[str, Any] | None:
    """A shared day's goal, or None if it does not look like one."""
    values = _items(raw)
    if len(values) != len(FROZEN) + 3 or not isinstance(values[-1], str):
        return None
    numbers = [_number(value) for value in values[: len(FROZEN) + 1]]
    checked = [number for number in numbers if number is not None and number >= 0]
    if len(checked) != len(numbers):
        return None
    entry: dict[str, Any] = dict(zip(FROZEN, checked[: len(FROZEN)], strict=True))
    entry["frozenAt"] = checked[-1]
    entry["celebrated"] = bool(values[len(FROZEN) + 1])
    entry["config"] = values[-1][:40]
    return entry


def _mapping(value: Any) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _items(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def merge(
    device: str,
    local_goals: Iterable[Mapping[str, Any]],
    local_deleted: Mapping[str, int],
    states: Iterable[Any],
) -> Merged:
    """What the shares of the other computers mean for this one.

    Shares come from other computers through the collection, so each part is checked for its
    shape here, and goals are checked against the contract again when they are stored.
    """
    merged = Merged(deleted=dict(local_deleted))
    newest: dict[str, dict[str, Any]] = {}
    archived: dict[str, int] = {}
    for raw in states:
        state = _mapping(raw)
        if state.get("v") != VERSION or state.get("off") or state.get("device") == device:
            continue
        for goal_id, value in _mapping(state.get("deleted")).items():
            at = _number(value)
            if at is not None:
                merged.deleted[goal_id] = max(merged.deleted.get(goal_id, 0), at)
        for goal_id, value in _mapping(state.get("archived")).items():
            at = _number(value)
            if at is not None:
                archived[goal_id] = max(archived.get(goal_id, 0), at)
        for item in _items(state.get("goals")):
            goal = _mapping(item)
            changed = _number(goal.get("updatedAt"))
            goal_id = goal.get("id")
            if changed is None or not isinstance(goal_id, str):
                continue
            known = newest.get(goal_id)
            if known is None or changed > int(known["updatedAt"]):
                newest[goal_id] = goal
        for goal_id, entries in _mapping(state.get("days")).items():
            for day, values in _mapping(entries).items():
                entry = _day(values)
                if entry is None:
                    continue
                shared = merged.days.setdefault(goal_id, {})
                known_day = shared.get(day)
                if known_day is None or entry["frozenAt"] < known_day["frozenAt"]:
                    shared[day] = entry
        for goal_id, value in _mapping(state.get("best")).items():
            number = _number(value)
            if number is not None:
                merged.best[goal_id] = max(merged.best.get(goal_id, 0), number)

    local = {goal["id"]: goal for goal in local_goals}
    merged.remove = [goal_id for goal_id in local if goal_id in merged.deleted]
    for goal_id, goal in newest.items():
        if goal_id in merged.deleted:
            continue
        mine = local.get(goal_id)
        if mine is None or goal["updatedAt"] > mine["updatedAt"]:
            merged.put.append(dict(goal))
    taken = {goal["id"] for goal in merged.put}
    for goal_id, at in archived.items():
        mine = local.get(goal_id)
        if mine is None or mine["archived"] or at <= mine["updatedAt"]:
            continue
        if goal_id not in merged.deleted and goal_id not in taken:
            merged.put.append({**mine, "archived": True, "updatedAt": at})
    return merged
