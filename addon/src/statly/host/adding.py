"""Watches Anki's Add window for the creation stopwatch: when it opens, is used and adds a note.

Only what happened and when reaches Statly, never what a note says. Anki's classic Add window
reports each added note and each pause in typing. Its newer, experimental editor reports
neither, so there a note counts once the editor loads the next empty note after it.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable
from typing import Any

from aqt import gui_hooks
from aqt.main import AnkiQt
from aqt.qt import QApplication, QWindow

from ..core.module import AddingEvent
from ..core.reader import CollectionReader
from .hooks import guarded

type Listener = Callable[[AddingEvent], None]


class _FrontWatcher:
    """Tells where the person works while the Add window is open: in it, or in a window it opened
    such as the deck chooser ("focused"), in another program such as a browser ("unfocused"), or in
    another of Anki's windows ("elsewhere")."""

    def __init__(self, window: Any, tell: Callable[[str], None]) -> None:
        self._window = window
        self._tell = tell
        self._app = QApplication.instance()
        self._app.focusWindowChanged.connect(self._changed)  # type: ignore[union-attr]

    def stop(self) -> None:
        with contextlib.suppress(TypeError, RuntimeError):
            self._app.focusWindowChanged.disconnect(self._changed)  # type: ignore[union-attr]

    def place_of(self, focus: QWindow | None) -> str:
        if focus is None:
            return "unfocused"
        own = self._window.windowHandle()
        shown: QWindow | None = focus
        while shown is not None:
            if shown is own:
                return "focused"
            shown = shown.transientParent()
        return "elsewhere"

    def _changed(self, focus: QWindow | None) -> None:
        # Watching must never break Anki's windows.
        with contextlib.suppress(Exception):
            self._tell(self.place_of(focus))


def _is_new_editor(window: Any) -> bool:
    return type(window).__name__ == "NewAddCards"


class AddWindowWatcher:
    def __init__(self, main_window: AnkiQt) -> None:
        self._mw = main_window
        self._listeners: list[Listener] = []
        self._window: Any = None
        self._precise = True
        self._newest_note = 0
        self._front: _FrontWatcher | None = None

    def listen(self, listener: Listener) -> None:
        if not self._listeners:
            gui_hooks.add_cards_did_init.append(guarded(self._opened))
            gui_hooks.add_cards_did_add_note.append(guarded(self._added))
            gui_hooks.editor_did_fire_typing_timer.append(guarded(self._typed))
            gui_hooks.editor_did_focus_field.append(guarded(self._focused_field))
            gui_hooks.editor_did_load_note.append(guarded(self._loaded))
        self._listeners.append(listener)

    def _tell(self, kind: str, note_id: int = 0, deck_id: int = 0, cards: int = 0) -> None:
        event = AddingEvent(kind, note_id, deck_id, cards, self._precise)
        for listener in self._listeners:
            guarded(listener)(event)

    def _reader(self) -> CollectionReader | None:
        collection = self._mw.col
        return CollectionReader(collection) if collection is not None else None

    def _opened(self, window: Any) -> None:
        self._window = window
        self._precise = not _is_new_editor(window)
        if self._front is not None:
            self._front.stop()
        self._front = _FrontWatcher(window, self._tell)
        window.destroyed.connect(guarded(lambda *_args: self._closed(window)))
        if not self._precise:
            reader = self._reader()
            self._newest_note = (
                int(reader.scalar("SELECT MAX(id) FROM notes") or 0) if reader else 0
            )
        self._tell("opened")
        if window.isActiveWindow():
            self._tell("focused")

    def _closed(self, window: Any) -> None:
        if window is self._window:
            self._window = None
            if self._front is not None:
                self._front.stop()
                self._front = None
            self._tell("closed")

    def _belongs_here(self, note: Any) -> bool:
        editor = getattr(self._window, "editor", None)
        return editor is not None and getattr(editor, "note", None) is note

    def _typed(self, note: Any) -> None:
        if self._belongs_here(note):
            self._tell("typed")

    def _focused_field(self, note: Any, _index: int) -> None:
        self._typed(note)

    def _added(self, note: Any) -> None:
        if self._window is not None:
            self._added_id(int(note.id))

    def _added_id(self, note_id: int) -> None:
        reader = self._reader()
        if reader is None:
            return
        # The deck of the note's first card, and how many cards the note made.
        rows = reader.rows(
            "SELECT did, COUNT(*) FROM cards WHERE nid = ? GROUP BY did ORDER BY MIN(ord)",
            note_id,
        )
        if not rows:
            return
        cards = sum(int(row[1]) for row in rows)
        self._tell("added", note_id, int(rows[0][0]), cards)

    def _loaded(self, editor: Any) -> None:
        """The newer editor loads an empty note after each add. Exactly one new note counts."""
        if self._window is None or self._precise:
            return
        if getattr(editor, "parentWindow", None) is not self._window:
            return
        reader = self._reader()
        if reader is None:
            return
        found = reader.rows(
            "SELECT id FROM notes WHERE id > ? ORDER BY id LIMIT 2", self._newest_note
        )
        if found:
            self._newest_note = int(found[-1][0])
            if len(found) > 1:
                # More than one at once came from elsewhere, such as an import. Catch up only.
                self._newest_note = int(reader.scalar("SELECT MAX(id) FROM notes") or 0)
                return
            self._added_id(int(found[0][0]))
