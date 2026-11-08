"""Turns the parameters of a call into the values the SQL statements need."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from ...core.errors import InvalidParams
from ...core.reader import CollectionReader
from .calendar import AnkiCalendar

MIN_DATE = date(2006, 1, 1)
# Answers have an ease from 1 to 4. Rows with ease 0 are manual changes, not reviews.
ANSWERED = "r.ease > 0"


@dataclass(frozen=True)
class Period:
    first_day: date
    last_day: date
    start_seconds: int
    end_seconds: int

    @property
    def days(self) -> int:
        return (self.last_day - self.first_day).days + 1

    def bounds(self) -> tuple[int, int]:
        return self.start_seconds * 1000, self.end_seconds * 1000


def make_period(calendar: AnkiCalendar, first_day: date, last_day: date) -> Period:
    return Period(
        first_day=first_day,
        last_day=last_day,
        start_seconds=calendar.day_start(first_day),
        end_seconds=calendar.day_start(last_day + timedelta(days=1)),
    )


def period_from_params(params: Any, calendar: AnkiCalendar) -> Period:
    try:
        first_day = date.fromisoformat(params["start"])
        last_day = date.fromisoformat(params["end"])
    except ValueError:
        raise InvalidParams("The range contains an invalid date.") from None
    if first_day < MIN_DATE or first_day > last_day:
        raise InvalidParams("The range is not valid.")
    return make_period(calendar, first_day, min(last_day, calendar.today))


def granularity_of(period: Period) -> str:
    """How a chart over time groups the days of a range: by day, week or month."""
    if period.days <= 31:
        return "day"
    if period.days <= 180:
        return "week"
    return "month"


def bucket_of(day: date, granularity: str) -> date:
    """The first day of the group a day belongs to."""
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    if granularity == "month":
        return day.replace(day=1)
    return day


def deck_ids(reader: CollectionReader, deck_id: int | None) -> tuple[int, ...] | None:
    """Return a deck and its subdecks, or None for the whole collection."""
    if deck_id is None:
        return None
    decks = reader.deck_names()
    name = decks.get(deck_id)
    if name is None:
        raise InvalidParams("This deck no longer exists.")
    prefix = f"{name}::"
    return tuple(
        identifier
        for identifier, candidate in decks.items()
        if identifier == deck_id or candidate.startswith(prefix)
    )


def placeholders(values: tuple[Any, ...]) -> str:
    return ", ".join("?" for _ in values)


def review_filter(
    period: Period,
    decks: tuple[int, ...] | None,
    excluded: tuple[int, ...] = (),
) -> tuple[str, list[Any]]:
    """Conditions for ``revlog AS r``.

    The whole-collection case deliberately has no join: it is much faster and it keeps the
    history of cards the user has since deleted. Cards in filtered decks count for their home
    deck. ``revlog`` does not record the deck, so this uses the card's current deck.
    """
    start_ms, end_ms = period.bounds()
    conditions = f"r.id >= ? AND r.id < ? AND {ANSWERED}"
    parameters: list[Any] = [start_ms, end_ms]
    if decks is not None:
        marks = placeholders(decks)
        conditions += (
            f" AND r.cid IN (SELECT id FROM cards WHERE did IN ({marks}) OR odid IN ({marks}))"
        )
        parameters += [*decks, *decks]
    if excluded:
        conditions += f" AND r.cid NOT IN ({placeholders(excluded)})"
        parameters += excluded
    return conditions, parameters


def card_filter(
    decks: tuple[int, ...] | None,
    excluded: tuple[int, ...] = (),
) -> tuple[str, list[Any]]:
    """Conditions for ``cards``, with the same deck rule as ``review_filter``."""
    conditions = "1 = 1"
    parameters: list[Any] = []
    if decks is not None:
        marks = placeholders(decks)
        conditions = f"(did IN ({marks}) OR odid IN ({marks}))"
        parameters = [*decks, *decks]
    if excluded:
        conditions += f" AND id NOT IN ({placeholders(excluded)})"
        parameters += excluded
    return conditions, parameters
