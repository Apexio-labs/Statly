"""Statly's own SQLite file in ``statly_data``. Never Anki's collection.

Anki's collection is read through ``CollectionReader`` and changed only through ``modules/changes``.
This file belongs to Statly alone: the stopwatch writes here, and models that learn from it read
here later. Python's own ``sqlite3`` does the work on a thread of its own, one job after the other,
so neither the reviewer nor the window ever waits for the disk.

Each part of Statly keeps its tables under a name with numbered steps (``schema``). A step runs
once, in its own transaction, the first time the file opens after it was added.
"""

from __future__ import annotations

import logging
import queue
import sqlite3
import threading
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from .errors import NotAllowed

logger = logging.getLogger(__name__)

FILE_NAME = "statly.db"


class Tables:
    """What a job may do with Statly's file. Only this module talks to ``sqlite3`` itself."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def run(self, sql: str, args: Sequence[Any] = ()) -> None:
        self._connection.execute(sql, tuple(args))

    def run_many(self, sql: str, rows: Iterable[Sequence[Any]]) -> None:
        self._connection.executemany(sql, [tuple(row) for row in rows])

    def rows(self, sql: str, args: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        return list(self._connection.execute(sql, tuple(args)).fetchall())

    def one(self, sql: str, args: Sequence[Any] = ()) -> tuple[Any, ...] | None:
        found = self._connection.execute(sql, tuple(args)).fetchone()
        return tuple(found) if found is not None else None

    def compact(self) -> None:
        """Give freed space back to the disk, so removed rows are gone from the file too."""
        self._connection.commit()
        self._connection.execute("VACUUM")


Step = Callable[[Tables], None]
Work = Callable[[Tables], Any]

_CLOSE = object()


class LocalDatabase:
    def __init__(self, folder: Callable[[], Path]) -> None:
        self._folder = folder
        self._schemas: dict[str, tuple[Step, ...]] = {}
        self._jobs: queue.Queue[Any] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        # Only the worker thread touches these.
        self._connection: sqlite3.Connection | None = None
        self._path: Path | None = None
        self._ready: dict[str, int] = {}

    def schema(self, name: str, steps: Sequence[Step]) -> None:
        """Declare a part's tables. Add new steps at the end, never change old ones."""
        self._schemas[name] = tuple(steps)

    def path(self) -> Path:
        return self._folder() / FILE_NAME

    def submit(
        self,
        work: Work,
        done: Callable[[Any], None] | None = None,
        failed: Callable[[Exception], None] | None = None,
    ) -> None:
        """Run ``work`` in one transaction on the database thread. ``done`` runs there too."""
        # The folder is looked up now, so work for one profile never lands in the next one's file.
        self._jobs.put((self.path(), work, done, failed))
        self._start()

    def read(self, work: Work, timeout: float = 2.0) -> Any | None:
        """Run ``work`` and wait for its result. Never on the main thread: it would freeze Anki.

        None when the file does not exist yet, the work failed or took too long.
        """
        if not self.path().exists():
            return None
        finished = threading.Event()
        found: list[Any] = []

        def keep(result: Any) -> None:
            found.append(result)
            finished.set()

        self.submit(work, keep, lambda _error: finished.set())
        finished.wait(timeout)
        return found[0] if found else None

    def close(self, timeout: float = 3.0) -> None:
        """Finish what is waiting, then let go of the file, as when the profile closes."""
        if self._thread is None:
            return
        finished = threading.Event()
        self._jobs.put((_CLOSE, finished))
        finished.wait(timeout)

    def wait(self, timeout: float = 5.0) -> None:
        """Wait until every job so far is done. For tests and for closing."""
        if self._thread is None:
            return
        finished = threading.Event()
        self.submit(lambda _connection: None, lambda _result: finished.set())
        finished.wait(timeout)

    def _start(self) -> None:
        with self._lock:
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._run, name="statly-localdb", daemon=True
                )
                self._thread.start()

    def _run(self) -> None:
        while True:
            job = self._jobs.get()
            if job[0] is _CLOSE:
                self._disconnect()
                job[1].set()
                continue
            path, work, done, failed = job
            try:
                connection = self._connect(path)
                with connection:
                    result = work(Tables(connection))
            except Exception as error:
                logger.exception("Statly's database job failed")
                if failed is not None:
                    _quietly(failed, error)
                continue
            if done is not None:
                _quietly(done, result)

    def _connect(self, path: Path) -> sqlite3.Connection:
        if self._connection is not None and self._path == path:
            self._upgrade(self._connection)
            return self._connection
        self._disconnect()
        if path.name != FILE_NAME or path.suffix != ".db":
            raise NotAllowed("Statly only opens its own database file.")
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, check_same_thread=True)
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_versions (name TEXT PRIMARY KEY, version INTEGER)"
        )
        connection.commit()
        self._connection, self._path, self._ready = connection, path, {}
        self._upgrade(connection)
        return connection

    def _upgrade(self, connection: sqlite3.Connection) -> None:
        for name, steps in list(self._schemas.items()):
            if self._ready.get(name) == len(steps):
                continue
            found = connection.execute(
                "SELECT version FROM schema_versions WHERE name = ?", (name,)
            ).fetchone()
            version = int(found[0]) if found else 0
            for number, step in enumerate(steps[version:], start=version + 1):
                with connection:
                    step(Tables(connection))
                    connection.execute(
                        "INSERT OR REPLACE INTO schema_versions (name, version) VALUES (?, ?)",
                        (name, number),
                    )
            self._ready[name] = len(steps)

    def _disconnect(self) -> None:
        if self._connection is not None:
            self._connection.close()
        self._connection, self._path, self._ready = None, None, {}


def _quietly(callback: Callable[[Any], None], value: Any) -> None:
    try:
        callback(value)
    except Exception:
        logger.exception("Statly's database callback failed")
