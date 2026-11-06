"""The stopwatch: how long each look at a card took, undo included.

Anki stores the time from question to answer, capped at the deck's limit, and forgets a look that
was undone. The stopwatch keeps every look, in Statly's own database on this computer, so the
study time model can learn from what really happened. It always runs, as the owner decided: it
only measures, never changes Anki, never sends anything and never stores what a card says.

While the person studies, attempts wait in memory; a background thread writes them every few
seconds and when the session ends.
"""

from __future__ import annotations

from collections.abc import Callable

from ...core.localdb import LocalDatabase
from ...core.module import Context
from ..review import ANSWERED, FINISHED, UNDONE, Attempt
from . import store

# A crash loses at most this much. Writing is cheap, but not worth doing on every answer.
_WRITE_EVERY_SECONDS = 5.0


class Stopwatch:
    def __init__(self, database: LocalDatabase, monotonic: Callable[[], float]) -> None:
        self._database = database
        self._monotonic = monotonic
        self._rows: list[tuple[int, ...]] = []
        self._written = monotonic()

    def answered(self, attempt: Attempt) -> None:
        self._rows.append(store.row_of(attempt))
        if self._monotonic() - self._written >= _WRITE_EVERY_SECONDS:
            self.write()

    def undone(self, attempt: Attempt) -> None:
        shown = round(attempt.shown_at * 1000)
        for index, row in enumerate(self._rows):
            if row[0] == attempt.card_id and row[4] == shown:
                self._rows[index] = (*row[:8], 1)
                return
        self._database.submit(lambda tables: store.mark_undone(tables, attempt.card_id, shown))

    def write(self) -> None:
        rows, self._rows = self._rows, []
        self._written = self._monotonic()
        if rows:
            self._database.submit(lambda tables: store.add(tables, rows))


class TimingModule:
    def register(self, context: Context) -> None:
        host, events = context.host, context.events
        database = LocalDatabase(host.data_folder)
        database.schema("timing", store.SCHEMA)
        context.services["localdb"] = database
        stopwatch = Stopwatch(database, host.monotonic)
        context.services["stopwatch"] = stopwatch
        events.subscribe(ANSWERED, stopwatch.answered)
        events.subscribe(UNDONE, stopwatch.undone)
        events.subscribe(FINISHED, lambda _value: stopwatch.write())

        def closing() -> None:
            stopwatch.write()
            database.close()

        host.on_profile_closing(closing)
