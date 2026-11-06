"""Goals as files in the profile: one per goal, so a damaged one costs only itself."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from ...core.contract import Contract
from ...core.errors import InvalidParams
from ...core.storage import JsonStore

FOLDER = "goals"
_NAME = re.compile(r"^[a-z]+-[a-f0-9]{8}$")


class GoalStore:
    def __init__(self, data_folder: Callable[[], Path], contract: Contract, limit: int) -> None:
        self._folder = lambda: data_folder() / FOLDER
        self._files = JsonStore(self._folder)
        self._contract = contract
        self._limit = limit

    def list(self) -> list[dict[str, Any]]:
        """Every readable goal, oldest first. Files that do not fit the contract are skipped."""
        folder = self._folder()
        if not folder.is_dir():
            return []
        goals: list[dict[str, Any]] = []
        for path in sorted(folder.glob("*.json")):
            if _NAME.fullmatch(path.stem) is None:
                continue
            stored: Any = self._files.read(path.stem)
            if self._valid(stored) and stored["id"] == path.stem:
                goals.append(cast(dict[str, Any], stored))
        return sorted(goals, key=lambda goal: (goal["createdDay"], goal["id"]))

    def get(self, goal_id: str) -> dict[str, Any] | None:
        if _NAME.fullmatch(goal_id) is None:
            return None
        stored: Any = self._files.read(goal_id)
        return cast(dict[str, Any], stored) if self._valid(stored) else None

    def put(self, goal: dict[str, Any]) -> None:
        if not self._valid(goal):
            raise InvalidParams("This goal does not fit the contract.")
        if self.get(goal["id"]) is None and len(self.list()) >= self._limit:
            raise InvalidParams(f"Statly keeps at most {self._limit} goals.")
        self._files.write(goal["id"], goal)

    def delete(self, goal_id: str) -> None:
        if _NAME.fullmatch(goal_id) is not None:
            self._files.remove(goal_id)

    def _valid(self, stored: Any) -> bool:
        try:
            self._contract.check_result("goals.list", [stored])
        except ValueError:
            return False
        return True


_SYNC_FILE = "goal-sync"
_DEVICE = re.compile(r"^[a-f0-9]{8}$")


class SyncStore:
    """This computer's side of syncing goals: its random name, the goals it deleted, and whether
    it asked about syncing yet. It stays in the profile and never syncs itself."""

    def __init__(self, data_folder: Callable[[], Path], new_name: Callable[[], str]) -> None:
        self._files = JsonStore(data_folder)
        self._new_name = new_name

    def _read(self) -> dict[str, Any]:
        stored: Any = self._files.read(_SYNC_FILE)
        return cast(dict[str, Any], stored) if isinstance(stored, dict) else {}

    def _write(self, data: dict[str, Any]) -> None:
        self._files.write(_SYNC_FILE, data)

    def device(self) -> str:
        """A random name for this computer, made once. It tells nothing about the person."""
        data = self._read()
        name = data.get("device")
        if isinstance(name, str) and _DEVICE.fullmatch(name):
            return name
        data["device"] = self._new_name()
        self._write(data)
        return data["device"]

    def deleted(self) -> dict[str, int]:
        found = self._read().get("deleted")
        if not isinstance(found, dict):
            return {}
        return {
            str(goal): int(at)
            for goal, at in cast(dict[str, Any], found).items()
            if isinstance(at, int) and not isinstance(at, bool)
        }

    def set_deleted(self, deleted: dict[str, int]) -> None:
        data = self._read()
        if data.get("deleted") != deleted:
            data["deleted"] = deleted
            self._write(data)

    def asked(self) -> bool:
        return bool(self._read().get("asked"))

    def mark_asked(self) -> None:
        data = self._read()
        data["asked"] = True
        self._write(data)
