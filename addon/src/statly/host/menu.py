"""The Statly menu in Anki's menu bar."""

from __future__ import annotations

from collections.abc import Callable

from aqt.main import AnkiQt
from aqt.qt import QAction, QMenu

_LABELS = {
    "en": {
        "dashboard": "Open Dashboard",
        "library": "Widget Library",
        "ankiStatistics": "Anki Statistics",
        "createWidget": "Create Widget",
        "importDashboard": "Import Dashboard",
        "settings": "Statly Settings",
    },
    "de": {
        "dashboard": "Dashboard öffnen",
        "library": "Widget Library",
        "ankiStatistics": "Anki-Statistiken",
        "createWidget": "Widget erstellen",
        "importDashboard": "Dashboard importieren",
        "settings": "Statly-Einstellungen",
    },
}


class StatlyMenu:
    def __init__(self, main_window: AnkiQt) -> None:
        self._main_window = main_window
        self._menu = QMenu("Statly", main_window)
        main_window.form.menubar.addMenu(self._menu)
        self._actions: dict[str, QAction] = {}

    def add(self, name: str, action: QAction) -> None:
        # On a Mac, Qt would otherwise move anything named "Settings" into Anki's app menu.
        action.setMenuRole(QAction.MenuRole.NoRole)
        self._menu.addAction(action)
        self._actions[name] = action
        action.setText(_LABELS["en"][name])

    def add_item(self, name: str, trigger: Callable[[], None]) -> None:
        action = QAction(self._main_window)
        action.triggered.connect(lambda: trigger())
        self.add(name, action)

    def add_separator(self) -> None:
        self._menu.addSeparator()

    def set_language(self, language: str) -> None:
        labels = _LABELS["de" if language.lower().startswith("de") else "en"]
        for name, action in self._actions.items():
            action.setText(labels[name])
