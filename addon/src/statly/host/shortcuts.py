"""Keyboard shortcuts for opening Statly's pages."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from aqt import sip
from aqt.main import AnkiQt
from aqt.qt import QAction, QApplication, QEvent, QKeySequence, QObject, QShortcut, Qt, QTimer

_DATA_PREFIX = "statly."
_RECORDING_LIMIT_MS = 60_000


def _all_actions() -> list[QAction]:
    app = QApplication.instance()
    if app is None:
        return []
    actions: dict[int, QAction] = {}
    for widget in QApplication.allWidgets():
        for action in widget.actions():
            actions[id(action)] = action
        for action in widget.findChildren(QAction):
            actions[id(action)] = action
    return list(actions.values())


def _all_shortcuts() -> list[QShortcut]:
    shortcuts: list[QShortcut] = []
    for widget in QApplication.topLevelWidgets():
        shortcuts.extend(widget.findChildren(QShortcut))
    return shortcuts


def conflict_with(keys: str, action_name: str) -> str | None:
    """Return the name of whatever already uses ``keys``, apart from this action itself."""
    sequence = QKeySequence(keys)
    if sequence.isEmpty():
        return None
    for action in _all_actions():
        if action.data() == f"{_DATA_PREFIX}{action_name}" or action.shortcut().isEmpty():
            continue
        if sequence.matches(action.shortcut()) != QKeySequence.SequenceMatch.NoMatch:
            return action.text().replace("&", "") or "Anki"
    for shortcut in _all_shortcuts():
        if sequence.matches(shortcut.key()) != QKeySequence.SequenceMatch.NoMatch:
            return "Anki"
    return None


class _QuitGuard(QObject):
    """On a Mac, Cmd+Q ends the app before any shortcut or page sees it. This stops that."""

    def __init__(self, on_quit: Callable[[], None]) -> None:
        super().__init__()
        self._on_quit = on_quit

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        if a1 is not None and a1.type() == QEvent.Type.Quit:
            a1.ignore()
            self._on_quit()
            return True
        return False


class Shortcuts:
    def __init__(self, main_window: AnkiQt, on_quit_pressed: Callable[[], None]) -> None:
        self._main_window = main_window
        self._quit_guard = _QuitGuard(on_quit_pressed)
        self._actions: dict[str, QAction] = {}
        self._silenced_actions: list[tuple[QAction, QKeySequence]] = []
        self._silenced_shortcuts: list[QShortcut] = []
        self._limit = QTimer(main_window)
        self._limit.setSingleShot(True)
        self._limit.timeout.connect(self.end_recording)

    def add(self, name: str, trigger: Callable[[], None]) -> QAction:
        action = QAction(name, self._main_window)
        action.setData(f"{_DATA_PREFIX}{name}")
        action.setShortcutContext(Qt.ShortcutContext.ApplicationShortcut)
        action.triggered.connect(lambda: trigger())
        self._main_window.addAction(action)
        self._actions[name] = action
        return action

    def apply(self, shortcuts: Mapping[str, object]) -> None:
        for name, action in self._actions.items():
            action.setShortcut(QKeySequence(str(shortcuts.get(name, ""))))

    def begin_recording(self) -> None:
        """Silence every shortcut, so the pressed keys reach the page instead of firing them.

        Whatever happens on the page, they all come back: after a new shortcut is saved, when
        the field loses focus, when the window closes, and at the latest after a minute.
        """
        self.end_recording()
        app = QApplication.instance()
        if app is not None:
            app.installEventFilter(self._quit_guard)
        for action in _all_actions():
            if not action.shortcut().isEmpty():
                self._silenced_actions.append((action, action.shortcut()))
                action.setShortcut(QKeySequence())
        for shortcut in _all_shortcuts():
            if shortcut.isEnabled():
                self._silenced_shortcuts.append(shortcut)
                shortcut.setEnabled(False)
        self._limit.start(_RECORDING_LIMIT_MS)

    def end_recording(self) -> None:
        self._limit.stop()
        app = QApplication.instance()
        if app is not None:
            app.removeEventFilter(self._quit_guard)
        for action, sequence in self._silenced_actions:
            if not sip.isdeleted(action):
                action.setShortcut(sequence)
        for shortcut in self._silenced_shortcuts:
            if not sip.isdeleted(shortcut):
                shortcut.setEnabled(True)
        self._silenced_actions = []
        self._silenced_shortcuts = []
