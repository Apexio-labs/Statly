"""Anki days, which start at the user's rollover hour instead of midnight."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

DAY_SECONDS = 86_400
# A safe point inside any Anki day, even around daylight saving changes.
_INSIDE_DAY_SECONDS = 2 * 3600


@dataclass(frozen=True)
class AnkiCalendar:
    day_cutoff: int
    """Unix time at which the current Anki day ends."""

    @property
    def today_start(self) -> int:
        return self.day_cutoff - DAY_SECONDS

    @property
    def today(self) -> date:
        return date.fromtimestamp(self.today_start + _INSIDE_DAY_SECONDS)

    def day_of(self, seconds: int) -> date:
        """Return the Anki day that contains a Unix time."""
        return self.today + timedelta(days=(seconds - self.today_start) // DAY_SECONDS)

    def day_start(self, day: date) -> int:
        """Unix time at which an Anki day starts, computed the way Anki's own graphs do."""
        return self.today_start + (day - self.today).days * DAY_SECONDS
