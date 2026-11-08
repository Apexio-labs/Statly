"""Statly's own popups: a separate web view laid over the app, inside the same window.

It looks like the app, because it uses the app's styles and shows a dimmed picture of the app
behind it. But it is a page of its own, which only Python fills and only Python reads. The app's
page, a bug in it or an answer from a model cannot press its buttons, which is what makes it safe
to ask for permissions here. See docs/adr/0003-permissions-and-changes.md.
"""

from __future__ import annotations

import base64
import json
import secrets
from collections.abc import Callable
from typing import Any

from aqt.qt import (
    QBuffer,
    QByteArray,
    QEvent,
    QImageWriter,
    QIODevice,
    QObject,
    QTimer,
    QUrl,
    QWidget,
)
from aqt.webview import AnkiWebView

from ..core.module import PermissionPrompt
from ..core.rpc import is_same_page

_PREFIX = "statlyPrompt:"
_BACKDROP_QUALITY = 80

type Appearance = Callable[[], dict[str, Any]]


class PromptUnavailable(Exception):
    """The popup page could not load, so the caller falls back to Anki's own dialog."""


class _PromptView(AnkiWebView):
    on_escape: Callable[[], None] | None = None

    def onEsc(self) -> None:
        # Anki closes the window on Esc. Here it means the safe answer.
        if self.on_escape is not None:
            self.on_escape()


def choice_tones(prompt: PermissionPrompt) -> list[str]:
    """The first answer is the safe one, the last one stands out, the ones between stay plain."""
    last = len(prompt.choices) - 1
    tones: list[str] = []
    for index in range(len(prompt.choices)):
        if index == 0:
            tones.append("safe")
        elif index == last:
            tones.append("danger" if prompt.tone == "danger" else "primary")
        else:
            tones.append("plain")
    return tones


class PromptLayer(QObject):
    def __init__(self, window: QWidget, below: QWidget, url: str, appearance: Appearance) -> None:
        super().__init__(window)
        self._window = window
        self._below = below
        self._url = url
        self._appearance = appearance
        self._ready = False
        self._token: str | None = None
        self._answers: tuple[str, ...] = ()
        self._answered: Callable[[str | None], None] | None = None

        self.view = _PromptView(parent=window, title="statly-prompt")
        self.view.requiresCol = False
        self.view.set_open_links_externally(False)
        self.view.set_bridge_command(self._message, window)
        self.view.on_escape = self._escape
        self.view.loadFinished.connect(self._loaded)
        self.view.hide()
        self.view.load_url(QUrl(url))
        window.installEventFilter(self)

    @property
    def is_open(self) -> bool:
        return self._answered is not None

    def ask(self, prompt: PermissionPrompt, answered: Callable[[str | None], None]) -> None:
        """Show the popup and return at once. ``answered`` gets the answer, or None if closed.

        Nothing waits here on purpose: questions come from calls of the app's page, and while such
        a call is being handled, no page can run its scripts, this popup's page included.
        """
        if self._answered is not None:
            answered(None)
            return
        if not self._ready:
            raise PromptUnavailable
        self._token = secrets.token_urlsafe(16)
        self._answers = tuple(answer for answer, _label in prompt.choices)
        self._answered = answered
        appearance = self._appearance()
        data = {
            "token": self._token,
            "title": prompt.title,
            "paragraphs": [part for part in prompt.body.split("\n\n") if part],
            "details": list(prompt.details),
            "choices": [
                {"answer": answer, "label": label, "tone": tone}
                for (answer, label), tone in zip(prompt.choices, choice_tones(prompt), strict=True)
            ],
            "theme": appearance.get("theme", "light"),
            "accent": appearance.get("accent"),
            "backdrop": self._backdrop(),
        }
        self.view.evalWithCallback(f"window.__statlyPrompt?.show({json.dumps(data)})", self._reveal)

    def cancel(self) -> None:
        """The window closes, so the question counts as not answered."""
        self._finish(None)

    def _loaded(self, ok: bool) -> None:
        self._ready = ok and is_same_page(self.view.page().url().toString(), self._url)

    def _reveal(self, _shown: object = None) -> None:
        if self._answered is None:
            return
        self.view.setGeometry(self._below.geometry())
        self.view.show()
        self.view.raise_()
        self.view.setFocus()

    def _backdrop(self) -> str | None:
        """A still picture of the app behind the popup, so it reads as part of the same window."""
        picture = self._below.grab().toImage()
        buffer = QBuffer()
        buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        writer = QImageWriter(buffer, QByteArray(b"jpeg"))
        writer.setQuality(_BACKDROP_QUALITY)
        if not writer.write(picture):
            return None
        return "data:image/jpeg;base64," + base64.b64encode(bytes(buffer.data().data())).decode()

    def _message(self, message: str) -> None:
        """Answers count only from this popup's own page, with this question's token."""
        if not message.startswith(_PREFIX) or self._answered is None:
            return
        if not is_same_page(self.view.page().url().toString(), self._url):
            return
        token, _separator, answer = message.removeprefix(_PREFIX).partition(":")
        if token == self._token and answer in self._answers:
            self._finish(answer)

    def _escape(self) -> None:
        if self._answered is not None and self._answers:
            self._finish(self._answers[0])

    def _finish(self, answer: str | None) -> None:
        answered, self._answered = self._answered, None
        if answered is None:
            return
        self._token = None
        self.view.hide()
        self.view.eval("window.__statlyPrompt?.clear()")
        self._below.setFocus()
        # The answer arrives inside a call from the popup's page, so the work it starts waits for
        # that call to end.
        QTimer.singleShot(0, lambda: answered(answer))

    def detach(self) -> None:
        """The window closes for good: stop watching it, so nothing calls in here afterwards."""
        window = getattr(self, "_window", None)
        try:
            if window is not None:
                window.removeEventFilter(self)
            self.view.on_escape = None
        except (AttributeError, RuntimeError):
            pass

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        # Anki tidies Python's memory now and then. A closed window and this layer hold on to each
        # other, so the tidying can empty this object first and tear the window down after, which
        # still sends the window events. Then the attributes are gone, so nothing here may assume
        # them, and an error in a filter would reach the person as Anki's error dialog.
        window = getattr(self, "_window", None)
        if window is None or a0 is not window or a1 is None:
            return False
        try:
            if a1.type() == QEvent.Type.Resize and self.view.isVisible():
                self.view.setGeometry(self._below.geometry())
        except (AttributeError, RuntimeError):
            pass
        return False
