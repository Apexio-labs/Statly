"""Estimates other parts of Statly share: how long studying takes, and later more.

Four steps, each in its own file: ``history.py`` reads Anki's answers (the only SQL),
``sessions.py`` works out what each answer really took, ``censored.py`` fits the times even where
Anki cut them off, and ``study_time.py`` turns that into a forecast with a range. Every estimate
names its model and version, so a better model can replace this one without old numbers changing
their meaning.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ...core.localdb import LocalDatabase, Tables
from ...core.module import Context
from ...core.reader import CollectionReader
from ..timing.attempts import measured_answers
from .history import DAYS, answers
from .sessions import DAY_MS, read_history
from .study_time import MODEL, Estimate, Profile, build

__all__ = ["MODEL", "Estimate", "EstimatesModule", "Profile", "StudyTime"]

Wrap = Callable[
    [str, Callable[[Any, CollectionReader], Any]], Callable[[Any, CollectionReader], Any]
]

_DEFAULT_LIMIT = 60


class StudyTime:
    def __init__(self, wrap: Wrap | None, database: LocalDatabase | None) -> None:
        self._database = database
        build_profile: Callable[[Any, CollectionReader], Any] = lambda _params, reader: (  # noqa: E731
            self._build(reader)
        )
        self._profile = wrap("estimates.profile", build_profile) if wrap else build_profile

    def profile(self, reader: CollectionReader) -> Profile:
        """The person's pace. Cached until a new answer, a sync or the next day."""
        return self._profile({}, reader)

    def _build(self, reader: CollectionReader) -> Profile:
        today_start = (reader.day_cutoff * 1000) - DAY_MS
        presets = reader.deck_presets()

        def limit_of(deck: int | None) -> float:
            found = presets.get(deck) if deck is not None else None
            return float(found[1]) if found else float(_DEFAULT_LIMIT)

        history = read_history(
            answers(reader, today_start), limit_of, today_start, self._measured(today_start)
        )
        return build(history, presets, today_start)

    def _measured(self, today_start_ms: int) -> dict[tuple[int, int], float]:
        if self._database is None:
            return {}
        since = today_start_ms - DAYS * DAY_MS

        def read(tables: Tables) -> Any:
            return tables.rows(
                """SELECT card_id, shown_at, duration_ms, inactive_ms, undone FROM attempts
                WHERE shown_at >= ? ORDER BY shown_at""",
                (since,),
            )

        rows = self._database.read(read)
        return measured_answers(rows) if rows else {}


class EstimatesModule:
    def register(self, context: Context) -> None:
        cache: Any = context.services.get("cache")
        context.services["estimates"] = StudyTime(
            cache.wrap if cache is not None else None, context.services.get("localdb")
        )
