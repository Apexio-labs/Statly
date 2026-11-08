"""The creation stopwatch: how long the person worked on each new note, research included.

Making a card often means looking things up in another program, so time in another program counts
too, while the Add window stays open. Time in another of Anki's windows does not: studying in the
main window is study time, and counting it twice would mislead. Windows the Add window opens itself,
such as the deck chooser, count as the Add window.

Between two signs of work, such as a pause in typing, a move to another field or a return from
another program, at most ``PAUSE_LIMIT`` counts, so a coffee break or a long read does not count in
full. One note never counts more than ``NOTE_LIMIT``. Anki's newer editor tells nothing about
typing, so there, while it is in front, only the note limit applies.

The clock is plain Python without Qt, so every rule here is tested without Anki.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from ...core.module import AddingEvent

PAUSE_LIMIT = 300.0
"""Seconds between two signs of work that count at most, in front or in another program."""
NOTE_LIMIT = 1200.0
"""Seconds one note counts at most, however long it took."""


@dataclass(frozen=True)
class Created:
    note_id: int
    deck_id: int
    cards: int
    added_at: float
    """Seconds since 1970."""
    seconds: float
    capped: bool
    """The note took longer than ``NOTE_LIMIT`` and counts with the limit."""
    precise: bool
    """Measured with typing pauses, in Anki's classic Add window."""


_PLACES = {"focused": "front", "unfocused": "away", "elsewhere": "elsewhere"}
"""Where the person works after each report about the window in front."""


class CreationClock:
    def __init__(self, monotonic: Callable[[], float], wall_clock: Callable[[], float]) -> None:
        self._monotonic = monotonic
        self._wall_clock = wall_clock
        self._open = False
        # "front": the Add window, "away": another program, "elsewhere": another Anki window.
        self._where = "elsewhere"
        self._precise = True
        self._spent = 0.0
        self._mark = 0.0

    def handle(self, event: AddingEvent) -> Created | None:
        """Takes in what the Add window reported. Returns a note once one was added."""
        now = self._monotonic()
        kind = event.kind
        if kind == "opened":
            self._open, self._where, self._precise = True, "elsewhere", event.precise
            self._spent, self._mark = 0.0, now
            return None
        if not self._open:
            return None
        if kind == "closed":
            self._open, self._where, self._spent = False, "elsewhere", 0.0
        elif kind in _PLACES:
            place = _PLACES[kind]
            if place != self._where:
                self._count(now)
                self._where = place
        elif kind == "typed":
            self._count(now)
        elif kind == "added":
            self._count(now)
            spent, self._spent = self._spent, 0.0
            return Created(
                note_id=event.note_id,
                deck_id=event.deck_id,
                cards=event.cards,
                added_at=self._wall_clock(),
                seconds=min(spent, NOTE_LIMIT),
                capped=spent > NOTE_LIMIT,
                precise=self._precise,
            )
        return None

    def _count(self, now: float) -> None:
        if self._where != "elsewhere":
            in_front_unseen = self._where == "front" and not self._precise
            limit = NOTE_LIMIT if in_front_unseen else PAUSE_LIMIT
            self._spent += max(0.0, min(now - self._mark, limit))
        self._mark = now
