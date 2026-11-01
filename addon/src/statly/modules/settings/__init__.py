"""Calls for reading and changing preferences."""

from __future__ import annotations

from typing import Any, cast

from ...contract.types import (
    SettingsGetResultShortcuts,
    SettingsUpdateParams,
    ShortcutsSetParams,
    ShortcutsSetResult,
)
from ...core.module import Context


class SettingsModule:
    def register(self, context: Context) -> None:
        settings, host = context.settings, context.host

        def set_shortcut(params: ShortcutsSetParams) -> ShortcutsSetResult:
            action, keys = params["action"], params["keys"]
            host.end_shortcut_recording()
            conflict = host.shortcut_conflict(action, keys)
            if conflict is not None:
                return {"conflict": conflict, "settings": settings.get()}
            shortcuts = cast(
                SettingsGetResultShortcuts,
                {**settings.get()["shortcuts"], action: keys},
            )
            patch: SettingsUpdateParams = {"shortcuts": shortcuts}
            updated = settings.update(patch)
            host.apply_shortcuts(updated["shortcuts"])
            return {"conflict": None, "settings": updated}

        context.router.local("settings.get", lambda _params: settings.get())
        context.router.local("settings.update", settings.update)
        context.router.local("shortcuts.set", set_shortcut)

        def begin_recording(_params: Any) -> None:
            host.begin_shortcut_recording()

        def end_recording(_params: Any) -> None:
            host.end_shortcut_recording()

        context.router.local("shortcuts.beginRecording", begin_recording)
        context.router.local("shortcuts.endRecording", end_recording)
