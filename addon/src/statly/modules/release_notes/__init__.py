"""Says once what a big update brought, the first time Statly opens after it.

A big update changes the first or second number of the version: 2.1 to 2.2, or 2.x to 3.0. A
small one, 2.1.1 to 2.1.2, shows nothing. The texts live in ``packages/i18n/locales`` under
``whatsNew.releases``, and ``tests/test_release_notes.py`` fails while the manifest names a big
version without them, so a release cannot forget them. Nothing here goes online.

Only the version whose notes were last shown is stored, in Statly's folder of the profile.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, cast

from ...contract.types import ReleaseNotesPendingResult
from ...core.module import Context
from ...core.storage import JsonStore

FILE = "versions"
NOTES_BEGAN = "2.1.1"
"""The last version without these notes. Someone who used it gets the notes of the next big one."""

_BIG = re.compile(r"^(\d+)\.(\d+)")


def big_version(version: str) -> tuple[int, int] | None:
    """The first two numbers, which change with a big update."""
    match = _BIG.match(version)
    return (int(match.group(1)), int(match.group(2))) if match else None


class ReleaseNotes:
    def __init__(
        self, store: JsonStore, current: Callable[[], str], onboarded: Callable[[], bool]
    ) -> None:
        self._store = store
        self._current = current
        self._onboarded = onboarded

    def _seen(self) -> str | None:
        stored: Any = self._store.read(FILE)
        seen: Any = cast(dict[str, Any], stored).get("seen") if isinstance(stored, dict) else None
        return seen if isinstance(seen, str) and big_version(seen) else None

    def _remember(self, version: str) -> None:
        self._store.write(FILE, {"seen": version})

    def pending(self) -> ReleaseNotesPendingResult:
        current = self._current()
        seen = self._seen()
        if seen is None:
            # Statly remembers nothing yet: either it is new here, and the welcome explains it, or
            # it came from a version before these notes existed.
            seen = NOTES_BEGAN if self._onboarded() else current
            self._remember(seen)
        now, before = big_version(current), big_version(seen)
        small = now is None or before is None or before >= now
        if small and seen != current:
            # A small update, or a step back to an older version: nothing new to tell.
            seen = current
            self._remember(seen)
        return {"since": seen, "current": current}

    def mark_seen(self) -> None:
        self._remember(self._current())


class ReleaseNotesModule:
    def register(self, context: Context) -> None:
        # Nothing may touch the profile here: Anki loads add-ons before it opens one.
        notes = ReleaseNotes(
            JsonStore(context.host.data_folder),
            lambda: context.host.info()["statlyVersion"],
            lambda: bool(context.settings.get()["onboardingDone"]),
        )
        context.router.local("releaseNotes.pending", lambda _params: notes.pending())
        context.router.local("releaseNotes.seen", lambda _params: notes.mark_seen())
