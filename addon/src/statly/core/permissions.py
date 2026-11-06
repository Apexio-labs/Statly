"""What the person allowed Statly to do, on this computer.

This file only remembers decisions. Asking happens in ``modules/permissions``, in a dialog that
Statly's own Python code opens, so a web page or an assistant can never allow anything by itself.
Code that needs a permission checks it here right before it acts, whatever the caller claims.
A damaged file counts as "nothing allowed", which is the safe side.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from .errors import NotAllowed
from .storage import JsonStore

_FILE = "permissions"
_VERSION = 1

type Listener = Callable[[str, bool], None]


@dataclass(frozen=True)
class Grant:
    granted_at: str
    source: str
    last_used_at: str | None


def _minute(moment: datetime) -> str:
    return moment.isoformat(timespec="minutes")


class Permissions:
    def __init__(
        self, store: JsonStore, known: Iterable[str], now: Callable[[], datetime] = datetime.now
    ) -> None:
        self._store = store
        self._known = frozenset(known)
        self._now = now
        self._listeners: list[Listener] = []

    def _read(self) -> dict[str, Any]:
        stored: Any = self._store.read(_FILE)
        if not isinstance(stored, dict) or stored.get("version") != _VERSION:
            return {"version": _VERSION, "grants": {}, "migrated": []}
        data = cast(dict[str, Any], stored)
        grants = data.get("grants")
        migrated = data.get("migrated")
        return {
            "version": _VERSION,
            "grants": cast(dict[str, Any], grants) if isinstance(grants, dict) else {},
            "migrated": cast(list[str], migrated) if isinstance(migrated, list) else [],
        }

    def _check(self, permission: str) -> None:
        if permission not in self._known:
            raise NotAllowed(f"Unknown permission: {permission}")

    def grants(self) -> dict[str, Grant]:
        found: dict[str, Grant] = {}
        for permission, entry in self._read()["grants"].items():
            if permission in self._known and isinstance(entry, dict):
                grant = cast(dict[str, Any], entry)
                found[permission] = Grant(
                    granted_at=str(grant.get("grantedAt", "")),
                    source="migrated" if grant.get("source") == "migrated" else "dialog",
                    last_used_at=grant.get("lastUsedAt"),
                )
        return found

    def allowed(self, permission: str) -> bool:
        self._check(permission)
        return permission in self.grants()

    def require(self, permission: str) -> None:
        """Raise unless the person allowed this for good. Call it right before acting."""
        if not self.allowed(permission):
            raise NotAllowed(f"{permission} is not allowed.")

    def grant(self, permission: str, source: str = "dialog") -> None:
        """Only the dialog and a one-time migration of older versions may call this."""
        self._check(permission)
        data = self._read()
        data["grants"][permission] = {
            "grantedAt": _minute(self._now()),
            "source": source,
            "lastUsedAt": None,
        }
        self._store.write(_FILE, data)
        self._tell(permission, True)

    def revoke(self, permission: str) -> bool:
        """Taking back is always allowed, because it is the safe direction."""
        self._check(permission)
        data = self._read()
        if data["grants"].pop(permission, None) is None:
            return False
        self._store.write(_FILE, data)
        self._tell(permission, False)
        return True

    def used(self, permission: str) -> None:
        """Remember the last use, to the minute, so the file is not written on every call."""
        data = self._read()
        entry = data["grants"].get(permission)
        if not isinstance(entry, dict):
            return
        moment = _minute(self._now())
        grant = cast(dict[str, Any], entry)
        if grant.get("lastUsedAt") != moment:
            grant["lastUsedAt"] = moment
            self._store.write(_FILE, data)

    def migrate(self, name: str, allowed: Iterable[str]) -> None:
        """Take over what an older version allowed, once per ``name``, without asking again."""
        data = self._read()
        if name in data["migrated"]:
            return
        moment = _minute(self._now())
        taken = [permission for permission in allowed if permission in self._known]
        for permission in taken:
            data["grants"].setdefault(
                permission, {"grantedAt": moment, "source": "migrated", "lastUsedAt": None}
            )
        data["migrated"] = [*data["migrated"], name]
        self._store.write(_FILE, data)
        for permission in taken:
            self._tell(permission, True)

    def subscribe(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def _tell(self, permission: str, granted: bool) -> None:
        for listener in self._listeners:
            listener(permission, granted)
