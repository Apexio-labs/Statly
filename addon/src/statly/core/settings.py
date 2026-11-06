"""The user's preferences."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, cast

from ..contract.types import SettingsGetResult, SettingsUpdateParams
from .contract import Contract
from .prototype import is_prototype_settings, migrate
from .storage import JsonStore

logger = logging.getLogger(__name__)

_FILE = "settings"

type Listener = Callable[[set[str]], None]


class SettingsService:
    def __init__(self, store: JsonStore, contract: Contract) -> None:
        self._store = store
        self._contract = contract
        self._listeners: list[Listener] = []

    @property
    def defaults(self) -> SettingsGetResult:
        return cast(SettingsGetResult, dict(self._contract.default_settings))

    def subscribe(self, listener: Listener) -> None:
        """Call ``listener`` with the names of changed settings after each update."""
        self._listeners.append(listener)

    def get(self) -> SettingsGetResult:
        """Return usable settings, whatever state the stored file is in."""
        stored: Any = self._store.read(_FILE)
        if is_prototype_settings(stored):
            try:
                stored = migrate(stored, self._store, self._contract)
            except (OSError, KeyError, TypeError, AttributeError, ValueError):
                logger.exception("Statly could not take over earlier settings")
                stored = None
        merged = cast(SettingsGetResult, self._with_defaults(stored or {}))
        return merged if self._fits(merged) else self._salvaged(stored)

    def _with_defaults(self, stored: dict[str, Any]) -> dict[str, Any]:
        """Fills in what an older file lacks, also inside a group like the shortcuts."""
        merged: dict[str, Any] = {**self.defaults, **stored}
        for key, default in self.defaults.items():
            value = merged[key]
            if isinstance(default, dict) and isinstance(value, dict):
                merged[key] = {**default, **value}
        return merged

    def _fits(self, settings: Any) -> bool:
        try:
            self._contract.check_result("settings.get", settings)
        except ValueError:
            return False
        return True

    def _salvaged(self, stored: Any) -> SettingsGetResult:
        """Keeps what still fits. Saving defaults would wipe a person's choices over one key."""
        kept: dict[str, Any] = dict(self.defaults)
        entries = cast(dict[str, Any], stored) if isinstance(stored, dict) else {}
        for key, value in entries.items():
            if key in kept and self._fits({**kept, key: value}):
                kept[key] = value
        return cast(SettingsGetResult, kept)

    def update(self, patch: SettingsUpdateParams) -> SettingsGetResult:
        current = self.get()
        updated = cast(SettingsGetResult, {**current, **patch})
        self._store.write(_FILE, updated)
        changed = {key for key, value in patch.items() if current.get(key) != value}
        if changed:
            for listener in self._listeners:
                listener(changed)
        return updated
