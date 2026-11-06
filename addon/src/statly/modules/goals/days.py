"""Which days count for studying. Pure: dates go in, dates come out."""

from __future__ import annotations

from collections.abc import Collection, Iterator
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class StudyCalendar:
    """When someone studies: weekdays with 0 for Monday, minus single days off."""

    weekdays: frozenset[int]
    free: frozenset[date]

    @classmethod
    def of(cls, weekdays: Collection[int], free: Collection[str]) -> StudyCalendar:
        return cls(frozenset(weekdays), frozenset(date.fromisoformat(day) for day in free))

    def studies_on(self, day: date) -> bool:
        return day.weekday() in self.weekdays and day not in self.free

    def days(self, start: date, end: date) -> Iterator[date]:
        """Study days from ``start`` to ``end``, both included."""
        day = start
        while day <= end:
            if self.studies_on(day):
                yield day
            day += timedelta(days=1)

    def count(self, start: date, end: date) -> int:
        return sum(1 for _ in self.days(start, end))


def deadline(exam: date, buffer_days: int) -> date:
    """The last day for new cards. The buffer before the exam stays free for revision."""
    return exam - timedelta(days=buffer_days + 1)


def every_day(start: date, end: date) -> Iterator[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)
