"""Where the person works while Anki's Add window is open, with real Qt and no screen."""

from __future__ import annotations

import os
import sys

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
qt = pytest.importorskip("aqt.qt")


def test_the_watcher_tells_the_add_window_its_dialogs_and_other_windows_apart() -> None:
    from statly.host.adding import _FrontWatcher

    app = qt.QApplication.instance() or qt.QApplication(sys.argv[:1])
    add_window = qt.QMainWindow()
    add_window.show()
    # Such as the deck chooser, which the Add window opens itself.
    chooser = qt.QDialog(add_window)
    chooser.show()
    main_window = qt.QMainWindow()
    main_window.show()
    app.processEvents()
    told: list[str] = []
    watcher = _FrontWatcher(add_window, told.append)
    try:
        assert watcher.place_of(add_window.windowHandle()) == "focused"
        assert watcher.place_of(chooser.windowHandle()) == "focused"
        assert watcher.place_of(main_window.windowHandle()) == "elsewhere"
        assert watcher.place_of(None) == "unfocused"
    finally:
        watcher.stop()
        for window in (chooser, main_window, add_window):
            window.close()
