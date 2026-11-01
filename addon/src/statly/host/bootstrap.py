"""Wires Statly into Anki at startup."""

from __future__ import annotations

import logging
from typing import Any

import aqt
from aqt import gui_hooks
from aqt.main import AnkiQt
from aqt.theme import theme_manager
from aqt.toolbar import Toolbar

from ..core.contract import Contract
from ..core.module import Context
from ..core.rpc import Router
from ..core.settings import SettingsService
from ..core.storage import JsonStore
from ..modules import MODULES
from .brand import animated
from .hooks import guarded
from .menu import StatlyMenu
from .runtime import AnkiRuntime
from .window import DIALOG_NAME, StatlyWindow

logger = logging.getLogger(__name__)

_WEB_EXPORTS = r"(web|user_files/media)/.*"
_PAGES = {"dashboard": "/", "settings": "/settings", "library": "/library"}


def start(main_window: AnkiQt) -> None:
    """Set up Statly. A failure here must never stop Anki from starting."""
    try:
        _start(main_window)
    except Exception:
        logger.exception("Statly could not start")


def _start(main_window: AnkiQt) -> None:
    package = main_window.addonManager.addon_from_module(__name__)
    runtime = AnkiRuntime(main_window, package)
    contract = Contract()
    settings = SettingsService(JsonStore(runtime.data_folder), contract)
    router = Router(contract, runtime)
    context = Context(router=router, host=runtime, contract=contract, settings=settings)
    for module in MODULES:
        module.register(context)
    missing = router.missing_methods()
    if missing:
        logger.warning("Contract methods without a handler: %s", sorted(missing))

    main_window.addonManager.setWebExports(__name__, _WEB_EXPORTS)
    base_url = f"{main_window.serverURL()}_addons/{package}/web/index.html"
    start_path = ["/"]

    def respond(response: dict[str, Any]) -> None:
        window = _open_window()
        if window is not None:
            window.resolve(response)

    def on_message(message: str) -> None:
        router.handle(message, respond)

    aqt.dialogs.register_dialog(
        DIALOG_NAME,
        lambda: StatlyWindow(
            f"{base_url}#{start_path[0]}",
            on_message,
            runtime.end_shortcut_recording,
            lambda: runtime.unsaved_message,
            settings.get()["openFullscreen"],
        ),
    )

    def open_page(path: str) -> None:
        window = _open_window()
        start_path[0] = path
        aqt.dialogs.open(DIALOG_NAME)
        if window is not None:
            window.emit_event("host.navigate", {"path": path})

    menu = StatlyMenu(main_window)
    for name, path in _PAGES.items():
        menu.add(name, runtime.shortcuts.add(name, lambda path=path: open_page(path)))
    menu.add(
        "ankiStatistics", runtime.shortcuts.add("ankiStatistics", runtime.open_anki_statistics)
    )
    menu.add_separator()
    menu.add_item("createWidget", lambda: open_page("/library/widgets/new"))
    menu.add_item("importDashboard", lambda: open_page("/?import=1"))

    def apply_settings() -> None:
        current = settings.get()
        runtime.apply_shortcuts(current["shortcuts"])
        language = current["language"]
        menu.set_language(runtime.info()["language"] if language == "auto" else language)

    def on_settings_changed(changed: set[str]) -> None:
        if "language" in changed:
            apply_settings()

    settings.subscribe(on_settings_changed)

    def replace_statistics_link(links: list[str], toolbar: Toolbar) -> None:
        link = toolbar.create_link("stats", "Statly", lambda: open_page("/"), id="stats")
        if main_window.pm.name and settings.get()["brandAnimation"]:
            link = animated(link, theme_manager.night_mode)
        for index, existing in enumerate(links):
            if 'id="stats"' in existing:
                links[index] = link
                return
        links.append(link)

    gui_hooks.top_toolbar_did_init_links.append(guarded(replace_statistics_link))
    gui_hooks.profile_did_open.append(guarded(apply_settings))
    gui_hooks.theme_did_change.append(guarded(_on_theme_changed))
    gui_hooks.profile_will_close.append(guarded(_close_window))
    gui_hooks.sync_did_finish.append(guarded(_on_statistics_changed))
    gui_hooks.state_did_change.append(guarded(_on_state_changed))


def _open_window() -> StatlyWindow | None:
    dialogs: Any = aqt.dialogs
    return dialogs._dialogs[DIALOG_NAME][1]


def _on_theme_changed() -> None:
    window = _open_window()
    if window is not None:
        window.emit_event("host.themeChanged", {"nightMode": theme_manager.night_mode})


def _on_statistics_changed() -> None:
    window = _open_window()
    if window is not None:
        window.emit_event("statistics.changed", {})


def _on_state_changed(new_state: str, old_state: str) -> None:
    # Refreshing after every answer would slow down reviewing, so wait for the session's end.
    if old_state == "review" and new_state != "review":
        _on_statistics_changed()


def _close_window() -> None:
    window = _open_window()
    if window is not None:
        window.close()
