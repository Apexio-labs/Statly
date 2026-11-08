"""Notes a person writes about their study days.

They stay in Statly's own folder on this computer: they never touch the collection and do not
sync. One file holds every note, keyed by its Anki day.
"""

from __future__ import annotations

from datetime import date
from typing import Any, cast

from ...core.errors import InvalidParams
from ...core.module import Context
from ...core.storage import JsonStore

FILE = "day_notes"
MAX_NOTES = 5000


class NoteStore:
    def __init__(self, store: JsonStore) -> None:
        self._store = store

    def _all(self) -> dict[str, str]:
        stored = self._store.read(FILE)
        if not isinstance(stored, dict):
            return {}
        entries: dict[Any, Any] = cast(dict[Any, Any], stored)
        return {str(day): text for day, text in entries.items() if isinstance(text, str) and text}

    def between(self, start: str, end: str) -> list[dict[str, str]]:
        return [
            {"date": day, "text": text}
            for day, text in sorted(self._all().items())
            if start <= day <= end
        ]

    def put(self, day: str, text: str) -> None:
        try:
            date.fromisoformat(day)
        except ValueError:
            raise InvalidParams("The date is not valid.") from None
        notes = self._all()
        cleaned = text.strip()
        if cleaned:
            notes[day] = cleaned
        else:
            notes.pop(day, None)
        if len(notes) > MAX_NOTES:
            raise InvalidParams("There are too many notes.")
        self._store.write(FILE, notes)


class NotesModule:
    def register(self, context: Context) -> None:
        notes = NoteStore(JsonStore(context.host.data_folder))

        def list_notes(params: Any) -> list[dict[str, str]]:
            return notes.between(params["start"], params["end"])

        def put(params: Any) -> None:
            notes.put(params["date"], params["text"])

        context.router.local("notes.list", list_notes)
        context.router.local("notes.save", put)
