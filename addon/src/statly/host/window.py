"""The Statly window: a single web view that shows the React app."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import aqt
from aqt.qt import QCloseEvent, QMainWindow, QMessageBox, QUrl
from aqt.utils import restoreGeom, saveGeom
from aqt.webview import AnkiWebView

from ..core.rpc import is_same_page

DIALOG_NAME = "statly"
_GEOMETRY_KEY = "statlyWindow"
_COMMAND_PREFIX = "statly:"


class StatlyWebView(AnkiWebView):
    def onEsc(self) -> None:
        # Anki closes the window on Esc, but Esc belongs to the app's own menus and dialogs.
        pass


class StatlyWindow(QMainWindow):
    def __init__(
        self,
        url: str,
        on_message: Callable[[str], None],
        on_close: Callable[[], None],
        unsaved_message: Callable[[], str | None],
        fullscreen: bool,
    ) -> None:
        super().__init__(None)
        self.setWindowTitle("Statly")
        self.setMinimumSize(480, 420)
        self._home = url
        self._on_message = on_message
        self._on_close = on_close
        self._unsaved_message = unsaved_message
        self._on_closed: Callable[[], None] | None = None

        self.web = StatlyWebView(parent=self, title="statly")
        self.web.requiresCol = False
        self.web.set_open_links_externally(False)
        self.web.set_bridge_command(self._bridge_command, self)
        self.web.load_url(QUrl(url))
        # load_url switches this off, and it must stay on for files dropped onto the page.
        self.web.allow_drops = True
        self.setCentralWidget(self.web)

        self.resize(1280, 820)
        restoreGeom(self, _GEOMETRY_KEY)
        if fullscreen:
            self.showFullScreen()
        else:
            self.show()

    def resolve(self, response: dict[str, Any]) -> None:
        self.web.eval(f"window.__statlyBridge?.resolve({json.dumps(response)})")

    def emit_event(self, name: str, payload: Any) -> None:
        self.web.eval(f"window.__statlyBridge?.emit({json.dumps(name)}, {json.dumps(payload)})")

    def _bridge_command(self, message: str) -> None:
        """Every call is open to the page, so any other page that ends up here gets none."""
        current = self.web.page().url().toString()
        if message.startswith(_COMMAND_PREFIX) and is_same_page(current, self._home):
            self._on_message(message.removeprefix(_COMMAND_PREFIX))

    def closeWithCallback(self, callback: Callable[[], None]) -> None:
        """Called by Anki's dialog manager when the collection closes."""
        self._on_closed = callback
        self.close()

    def _user_wants_to_stay(self) -> bool:
        """Anki closing the collection cannot wait for an answer, so only a person gets asked."""
        message = self._unsaved_message()
        if message is None or self._on_closed is not None:
            return False
        answer = QMessageBox.question(
            self,
            "Statly",
            message,
            QMessageBox.StandardButton.Close | QMessageBox.StandardButton.Cancel,
            QMessageBox.StandardButton.Cancel,
        )
        return answer != QMessageBox.StandardButton.Close

    def closeEvent(self, a0: QCloseEvent | None) -> None:
        if self._user_wants_to_stay():
            if a0 is not None:
                a0.ignore()
            return
        self._on_close()
        saveGeom(self, _GEOMETRY_KEY)
        self.web.cleanup()
        aqt.dialogs.markClosed(DIALOG_NAME)
        if a0 is not None:
            a0.accept()
        if self._on_closed is not None:
            self._on_closed()
