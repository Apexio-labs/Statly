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
        "editDashboard": "Edit Dashboard",
        "assistant": "Open Assistant",
        "appearance": "Appearance",
        "wallpaper": "Wallpaper",
        "nextTheme": "Next Theme",
        "fullscreen": "Toggle Full Screen",
        "versions": "Versions and Updates",
        "autoUpdate": "Automatic Updates",
    },
    "de": {
        "dashboard": "Dashboard öffnen",
        "library": "Widget Library",
        "ankiStatistics": "Anki-Statistiken",
        "createWidget": "Widget erstellen",
        "importDashboard": "Dashboard importieren",
        "settings": "Statly-Einstellungen",
        "editDashboard": "Dashboard bearbeiten",
        "assistant": "Assistent öffnen",
        "appearance": "Erscheinungsbild",
        "wallpaper": "Wallpaper",
        "nextTheme": "Nächstes Theme",
        "fullscreen": "Vollbild umschalten",
        "versions": "Versionen und Updates",
        "autoUpdate": "Automatische Updates",
    },
}


class StatlyMenu:
    def __init__(self, main_window: AnkiQt) -> None:
        self._main_window = main_window
        self._menu = QMenu("Statly", main_window)
        main_window.form.menubar.addMenu(self._menu)
        self._actions: dict[str, QAction] = {}
        self._menus: dict[str, QMenu] = {}

    def add(self, name: str, action: QAction) -> None:
        # On a Mac, Qt would otherwise move anything named "Settings" into Anki's app menu.
        action.setMenuRole(QAction.MenuRole.NoRole)
        self._menu.addAction(action)
        self.name(name, action)

    def name(self, name: str, action: QAction) -> None:
        """A shortcut outside the menu still needs a word for it, should another one clash."""
        self._actions[name] = action
        action.setText(_LABELS["en"][name])

    def add_separator(self) -> None:
        self._menu.addSeparator()

    def add_versions(
        self,
        version: Callable[[], str],
        auto_update: Callable[[], bool],
        set_auto_update: Callable[[bool], None],
    ) -> Callable[[], None]:
        """The installed version and Anki's update switch for Statly, the same one as in Settings.

        Both are read whenever Statly's menu or this submenu opens. macOS does not always announce
        a submenu, so the caller also runs the returned function after every change of the switch.
        """
        self._menu.addSeparator()
        versions = QMenu(_LABELS["en"]["versions"], self._menu)
        self._menu.addMenu(versions)
        entry = versions.menuAction()
        if entry is not None:
            entry.setMenuRole(QAction.MenuRole.NoRole)
        self._menus["versions"] = versions

        updates = QAction(versions)
        updates.setCheckable(True)
        updates.setMenuRole(QAction.MenuRole.NoRole)
        updates.triggered.connect(set_auto_update)
        versions.addAction(updates)
        self.name("autoUpdate", updates)
        versions.addSeparator()
        number = QAction(versions)
        number.setEnabled(False)
        number.setMenuRole(QAction.MenuRole.NoRole)
        versions.addAction(number)

        def refresh() -> None:
            updates.setChecked(auto_update())
            number.setText(f"Statly {version()}")

        versions.aboutToShow.connect(refresh)
        self._menu.aboutToShow.connect(refresh)
        return refresh

    def set_language(self, language: str) -> None:
        labels = _LABELS["de" if language.lower().startswith("de") else "en"]
        for name, action in self._actions.items():
            action.setText(labels[name])
        for name, menu in self._menus.items():
            menu.setTitle(labels[name])
