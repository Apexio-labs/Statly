"""Each goal's day book: what the goal of a day was fixed to, and later how the day went.

A day's goal is written when the day is first counted, so it stays the same all day. What was
done is read fresh from Anki's history until the day is settled a week later, because reviews
from a phone only arrive with the next sync. After that the day is kept as it was.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from ...core.storage import JsonStore

FOLDER = "goal-history"
_VERSION = 1
_NAME = re.compile(r"^[a-z]+-[a-f0-9]{8}$")

type Days = dict[str, dict[str, Any]]


class Ledger:
    """Used from Anki's worker and from the main thread, so every change holds a lock."""

    def __init__(self, data_folder: Callable[[], Path]) -> None:
        self._files = JsonStore(lambda: data_folder() / FOLDER)
        self._lock = threading.Lock()

    def book(self, goal_id: str) -> dict[str, Any]:
        """``{"best": int, "days": {iso date: entry}}``. A damaged file starts over."""
        if _NAME.fullmatch(goal_id) is None:
            return {"best": 0, "days": {}}
        stored: Any = self._files.read(goal_id)
        if not isinstance(stored, dict) or stored.get("version") != _VERSION:
            return {"best": 0, "days": {}}
        data = cast(dict[str, Any], stored)
        days = data.get("days")
        best = data.get("best")
        return {
            "best": best if isinstance(best, int) and best >= 0 else 0,
            "days": cast(Days, days) if isinstance(days, dict) else {},
        }

    def change(self, goal_id: str, work: Callable[[dict[str, Any]], bool]) -> None:
        """``work`` changes the book in place and says whether anything changed."""
        if _NAME.fullmatch(goal_id) is None:
            return
        with self._lock:
            book = self.book(goal_id)
            if work(book):
                self._files.write(goal_id, {"version": _VERSION, **book})

    def forget(self, goal_id: str) -> None:
        if _NAME.fullmatch(goal_id) is not None:
            with self._lock:
                self._files.remove(goal_id)
