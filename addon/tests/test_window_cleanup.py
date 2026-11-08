"""A closed Statly window must not raise errors while Python tidies its memory.

A Windows user saw Anki's error dialog now and then while studying: Anki's regular memory tidying
emptied the popup layer before the window was torn down, and the window's last event reached the
emptied layer. This runs real Qt without a screen.
"""

from __future__ import annotations

import gc
import os
import sys
from types import TracebackType

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
qt = pytest.importorskip("aqt.qt")


@pytest.fixture
def app() -> object:
    return qt.QApplication.instance() or qt.QApplication(sys.argv[:1])


def _errors_while(action: object) -> list[BaseException]:
    errors: list[BaseException] = []
    previous = sys.excepthook

    def catch(_kind: type[BaseException], error: BaseException, _tb: TracebackType | None) -> None:
        errors.append(error)

    sys.excepthook = catch
    try:
        action()  # type: ignore[operator]
    finally:
        sys.excepthook = previous
    return errors


def _closed_window_is_collected(app: object) -> list[BaseException]:
    from statly.host.prompt import PromptLayer

    class Window(qt.QMainWindow):
        def __init__(self) -> None:
            super().__init__(None)
            self.web = qt.QWidget(self)
            self.setCentralWidget(self.web)
            self.prompts = PromptLayer(self, self.web, "about:blank", lambda: {})

    def run() -> None:
        was_enabled = gc.isenabled()
        gc.disable()  # Anki switches automatic collection off and collects on a timer.
        try:
            window = Window()
            window.show()
            app.processEvents()  # type: ignore[attr-defined]
            # Without detach(), as if the window closed some other way than its closeEvent.
            window.close()
            app.processEvents()  # type: ignore[attr-defined]
            del window
            gc.collect()
            app.processEvents()  # type: ignore[attr-defined]
        finally:
            if was_enabled:
                gc.enable()

    return _errors_while(run)


def test_an_emptied_popup_layer_ignores_the_windows_last_events(app: object) -> None:
    # Anki's web views share one engine profile, so this runs once per test session.
    assert _closed_window_is_collected(app) == []
