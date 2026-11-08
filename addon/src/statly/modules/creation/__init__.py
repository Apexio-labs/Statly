"""Time spent making new cards, measured in Anki's Add window.

Anki keeps no record of how long writing a note took, so Statly measures it itself: see
``clock.py`` for what counts. Like the review stopwatch it always runs, only measures, never
changes Anki, never sends anything and never stores what a note says. Each added note is one row
in Statly's own database on this computer.
"""

from __future__ import annotations

from typing import Any

from ...core.localdb import LocalDatabase
from ...core.module import AddingEvent, Context
from ...core.reader import CollectionReader
from . import stats, store
from .clock import NOTE_LIMIT, PAUSE_LIMIT, Created, CreationClock

__all__ = [
    "NOTE_LIMIT",
    "PAUSE_LIMIT",
    "Created",
    "CreationClock",
    "CreationModule",
    "CreationTime",
]


class CreationTime:
    """The statistic over what was measured. Runs on Anki's background worker."""

    def __init__(self, database: LocalDatabase) -> None:
        self._database = database

    def statistics(self, params: Any, reader: CollectionReader) -> dict[str, Any]:
        measured: list[tuple[Any, ...]] = self._database.read(store.everything) or []
        return stats.summarize(params, reader, measured)


class CreationModule:
    def register(self, context: Context) -> None:
        host = context.host
        database: LocalDatabase = context.services["localdb"]
        database.schema("creation", store.SCHEMA)
        clock = CreationClock(host.monotonic, host.wall_clock)
        service = CreationTime(database)
        context.services["creation"] = service

        def changed(_result: Any) -> None:
            # The database thread wrote it. The window hears of it on the main thread.
            host.run_on_main(lambda: host.emit("statistics.changed", {}))

        def on_adding(event: AddingEvent) -> None:
            created = clock.handle(event)
            if created is not None:
                database.submit(lambda tables: store.add(tables, created), changed)

        host.on_adding(on_adding)
        context.router.query("statistics.creation", service.statistics)
