"""The Statly window: a single web view that shows the React app."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import aqt
from aqt.qt import (
    QChildEvent,
    QCloseEvent,
    QDropEvent,
    QEvent,
    QMainWindow,
    QMessageBox,
    QMimeData,
    QObject,
    QUrl,
    QWidget,
)
from aqt.utils import restoreGeom, saveGeom
from aqt.webview import AnkiWebView

from ..core.module import PermissionPrompt
from ..core.rpc import is_same_page
from .labels import host_labels
from .prompt import Appearance, PromptLayer, PromptUnavailable

DIALOG_NAME = "statly"
_GEOMETRY_KEY = "statlyWindow"
_COMMAND_PREFIX = "statly:"


class _DropWatcher(QObject):
    """Notes a dropped file wherever inside the web view it lands. On Windows the drop reaches the
    engine's inner widget and never the view's own ``dropEvent``, so a dropped wallpaper did
    nothing there. The watcher only looks: the page still gets the drop as before."""

    def __init__(self, view: StatlyWebView) -> None:
        super().__init__(view)
        self._view = view

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        if a1 is not None and a1.type() == QEvent.Type.Drop and isinstance(a1, QDropEvent):
            self._view.remember_drop(a1.mimeData())
        return False


_DROP_VALID_SECONDS = 15.0
"""A drop counts only for the page's next question, never for one much later."""


class StatlyWebView(AnkiWebView):
    _dropped_file: Path | None = None
    _dropped_at = 0.0
    _watcher: _DropWatcher | None = None

    def onEsc(self) -> None:
        # Anki closes the window on Esc, but Esc belongs to the app's own menus and dialogs.
        pass

    def remember_drop(self, data: QMimeData | None) -> None:
        # A page sees a dropped file's content but not its path, and a video can be too large to
        # pass through the bridge. So the path waits here until the page asks for it.
        urls = data.urls() if data is not None else []
        local = [url for url in urls if url.isLocalFile()]
        if local:
            self._dropped_file = Path(local[0].toLocalFile())
            self._dropped_at = time.monotonic()

    def watch_drops(self) -> None:
        self._watcher = _DropWatcher(self)
        for child in self.findChildren(QWidget):
            child.installEventFilter(self._watcher)

    def childEvent(self, a0: QChildEvent | None) -> None:
        super().childEvent(a0)
        # The engine adds its inner widget after the page starts loading. When it is added, it is
        # not yet a full widget, so it is watched once it is polished, ready to be shown.
        watched = (QEvent.Type.ChildAdded, QEvent.Type.ChildPolished)
        if self._watcher is not None and a0 is not None and a0.type() in watched:
            child = a0.child()
            if isinstance(child, QWidget):
                child.removeEventFilter(self._watcher)
                child.installEventFilter(self._watcher)

    def dropEvent(self, evt: QDropEvent | None) -> None:
        self.remember_drop(evt.mimeData() if evt is not None else None)
        super().dropEvent(evt)

    def take_dropped_file(self) -> Path | None:
        dropped, self._dropped_file = self._dropped_file, None
        fresh = time.monotonic() - self._dropped_at <= _DROP_VALID_SECONDS
        return dropped if fresh else None


class StatlyWindow(QMainWindow):
    def __init__(
        self,
        url: str,
        on_message: Callable[[str], None],
        on_close: Callable[[], None],
        unsaved_message: Callable[[], str | None],
        fullscreen: bool,
        prompt_url: str,
        appearance: Appearance,
    ) -> None:
        super().__init__(None)
        self.setWindowTitle("Statly")
        self.setMinimumSize(480, 420)
        self._home = url
        self._on_message = on_message
        self._on_close = on_close
        self._unsaved_message = unsaved_message
        self._appearance = appearance
        self._on_closed: Callable[[], None] | None = None
        # Set once the person said Close in Statly's popup, so the next close goes through.
        self._close_confirmed = False

        self.web = StatlyWebView(parent=self, title="statly")
        self.web.requiresCol = False
        self.web.set_open_links_externally(False)
        self.web.set_bridge_command(self._bridge_command, self)
        self.web.load_url(QUrl(url))
        # load_url switches this off, and it must stay on for files dropped onto the page.
        self.web.allow_drops = True
        self.web.watch_drops()
        self.setCentralWidget(self.web)
        self.prompts = PromptLayer(self, self.web, prompt_url, appearance)

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

    def _ask_before_closing(self) -> bool:
        """True while the person still has to answer. Anki closing the collection cannot wait for
        an answer, so only a person gets asked, and only with unsaved work."""
        message = self._unsaved_message()
        if message is None or self._on_closed is not None or self._close_confirmed:
            return False
        text = host_labels(self._appearance().get("language", "en"))
        prompt = PermissionPrompt(
            title=text["closeTitle"],
            body=message,
            details=(),
            choices=(("stay", text["cancel"]), ("close", text["close"])),
            tone="danger",
        )

        def answered(answer: str | None) -> None:
            if answer == "close":
                self._close_confirmed = True
                self.close()

        try:
            self.prompts.ask(prompt, answered)
        except PromptUnavailable:
            choice = QMessageBox.question(
                self,
                "Statly",
                message,
                QMessageBox.StandardButton.Close | QMessageBox.StandardButton.Cancel,
                QMessageBox.StandardButton.Cancel,
            )
            return choice != QMessageBox.StandardButton.Close
        return True

    def closeEvent(self, a0: QCloseEvent | None) -> None:
        if self.prompts.is_open:
            # A question is still open: closing answers it with no, and the window stays for now.
            self.prompts.cancel()
            if a0 is not None:
                a0.ignore()
            return
        if self._ask_before_closing():
            if a0 is not None:
                a0.ignore()
            return
        self._on_close()
        self.prompts.detach()
        saveGeom(self, _GEOMETRY_KEY)
        self.web.cleanup()
        aqt.dialogs.markClosed(DIALOG_NAME)
        if a0 is not None:
            a0.accept()
        if self._on_closed is not None:
            self._on_closed()
