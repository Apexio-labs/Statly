"""Anki's own statistics page as data for Statly's widgets.

Anki's backend works out the whole page in one read-only call. Using it keeps every number equal to
what people see in Anki, including FSRS values that no table holds. This module only cuts that data
to a time range, sorts it into bars and adds the summary lines, so desktop and phone show the same.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import date, timedelta
from typing import Any

from ...core.reader import CollectionReader
from .calendar import AnkiCalendar

type Counts = Mapping[int, int]

_MAX_TIME_BARS = 60
_MAX_SPREAD_BARS = 40
_PERCENT_BAR_WIDTH = 5
_RANGE_DAYS = {"month": 30, "threeMonths": 90, "year": 365}
_FUTURE_DAYS = {"month": 31, "threeMonths": 90, "year": 365}
_RANGE_FIELDS = {
    "month": "one_month",
    "threeMonths": "three_months",
    "year": "one_year",
    "all": "all_time",
}
_SPREAD = {"half": 0.5, "most": 0.95}
_MONTH_DAYS = 30
_MS_PER_MINUTE = 60_000
_MS_PER_SECOND = 1000
_REVIEW_SERIES = ("mature", "young", "relearn", "learn", "filtered")
_RETENTION_ROWS = (
    ("today", "today"),
    ("yesterday", "yesterday"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("all", "all_time"),
)


def load(params: Any, reader: CollectionReader) -> Any:
    return reader.graphs(params["deckId"])


def _fact(name: str, value: float, unit: str, of: float | None = None) -> dict[str, Any]:
    fact: dict[str, Any] = {"name": name, "value": value, "unit": unit}
    if of is not None:
        fact["of"] = of
    return fact


def _share(part: float, whole: float) -> float:
    return part / whole if whole else 0.0


def _time_bins(first: int, last: int) -> Iterator[tuple[int, int]]:
    """Bars end at ``last``, so the newest bar always holds a full step."""
    step = max(1, math.ceil((last - first + 1) / _MAX_TIME_BARS))
    ends = range(last, first - 1, -step)
    for end in reversed(ends):
        yield max(first, end - step + 1), end


def _timeline(
    first: int,
    last: int,
    values_of: Callable[[int], Sequence[float]],
    day: date,
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    running = 0.0
    for start, end in _time_bins(first, last):
        columns = zip(*(values_of(offset) for offset in range(start, end + 1)), strict=True)
        values = [sum(column) for column in columns]
        running += sum(values)
        points.append(
            {
                "start": (day + timedelta(days=start)).isoformat(),
                "end": (day + timedelta(days=end)).isoformat(),
                "values": values,
                "running": running,
            }
        )
    return points


def _first_day(chosen: str, days: Sequence[int]) -> int:
    if chosen in _RANGE_DAYS:
        return 1 - _RANGE_DAYS[chosen]
    return min(days, default=0)


def _today(graphs: Any, _params: Any, _day: date) -> dict[str, Any]:
    data = graphs.today
    return {
        "kind": "today",
        "answers": data.answer_count,
        "millis": data.answer_millis,
        "correct": data.correct_count,
        "matureCorrect": data.mature_correct,
        "matureCount": data.mature_count,
        "learn": data.learn_count,
        "review": data.review_count,
        "relearn": data.relearn_count,
        "filtered": data.early_review_count,
    }


def _true_retention(graphs: Any, _params: Any, _day: date) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for name, field in _RETENTION_ROWS:
        row = getattr(graphs.true_retention, field)
        rows.append(
            {
                "name": name,
                "youngPassed": row.young_passed,
                "youngFailed": row.young_failed,
                "maturePassed": row.mature_passed,
                "matureFailed": row.mature_failed,
            }
        )
    return {"kind": "retention", "rows": rows}


def _review_rows(source: Any) -> dict[int, tuple[int, ...]]:
    return {
        offset: tuple(getattr(entry, name) for name in _REVIEW_SERIES)
        for offset, entry in source.items()
    }


def _reviews(graphs: Any, params: Any, day: date) -> dict[str, Any]:
    showing_time = params["option"]
    counts = _review_rows(graphs.reviews.count)
    times = _review_rows(graphs.reviews.time)
    first = _first_day(params["range"], list(counts))
    period = 1 - first
    empty = (0,) * len(_REVIEW_SERIES)

    def in_range(rows: Mapping[int, tuple[int, ...]]) -> int:
        return sum(sum(values) for offset, values in rows.items() if first <= offset <= 0)

    def shown(offset: int) -> Sequence[float]:
        if showing_time:
            return [value / _MS_PER_MINUTE for value in times.get(offset, empty)]
        return counts.get(offset, empty)

    answers, millis = in_range(counts), in_range(times)
    studied = sum(1 for offset in counts if first <= offset <= 0)
    total = millis / _MS_PER_MINUTE if showing_time else answers
    # Anki counts every answer here, which Statly calls ratings.
    unit = "minutes" if showing_time else "ratings"
    seconds_per_answer = _share(millis / _MS_PER_SECOND, answers)
    return {
        "kind": "timeline",
        "series": list(_REVIEW_SERIES),
        "unit": unit,
        "points": _timeline(first, 0, shown, day),
        "facts": [
            _fact("daysStudied", studied, "days", period),
            _fact("total", total, unit),
            _fact("averageStudied", _share(total, studied), unit),
            _fact("averagePeriod", _share(total, period), unit),
            _fact("answerTime", seconds_per_answer, "seconds"),
            _fact("cardsPerMinute", _share(60, seconds_per_answer), "cardsPerMinute"),
        ],
    }


def _added(graphs: Any, params: Any, day: date) -> dict[str, Any]:
    added = dict(graphs.added.added)
    first = _first_day(params["range"], list(added))
    period = 1 - first
    total = sum(cards for offset, cards in added.items() if first <= offset <= 0)
    return {
        "kind": "timeline",
        "series": ["added"],
        "unit": "cards",
        "points": _timeline(first, 0, lambda offset: (added.get(offset, 0),), day),
        "facts": [
            _fact("total", total, "cards"),
            _fact("averagePeriod", _share(total, period), "cards"),
        ],
    }


def _future_due(graphs: Any, params: Any, day: date) -> dict[str, Any]:
    due = dict(graphs.future_due.future_due)
    backlog = graphs.future_due.have_backlog
    first = min(min(due, default=0), 0) if params["option"] and backlog else 0
    last = _FUTURE_DAYS.get(params["range"], max(max(due, default=0), 1))
    period = last - first + 1
    total = sum(cards for offset, cards in due.items() if first <= offset <= last)
    return {
        "kind": "timeline",
        "series": ["due"],
        "unit": "reviews",
        "hasBacklog": backlog,
        "points": _timeline(first, last, lambda offset: (due.get(offset, 0),), day),
        "facts": [
            _fact("total", total, "reviews"),
            _fact("averagePeriod", _share(total, period), "reviews"),
            _fact("dueTomorrow", due.get(1, 0), "reviews"),
            _fact("dailyLoad", graphs.future_due.daily_load, "reviews"),
        ],
    }


def _quantile(counts: Counts, share: float) -> int:
    """Counts stand for many cards, so this walks them instead of unpacking each one."""
    wanted = share * sum(counts.values())
    seen = 0
    for key in sorted(counts):
        seen += counts[key]
        if seen >= wanted:
            return key
    return 0


def _mean(counts: Counts) -> float:
    return _share(sum(key * cards for key, cards in counts.items()), sum(counts.values()))


def _bars(counts: Counts, first: int, last: int, width: int) -> list[dict[str, Any]]:
    total = sum(counts.values())
    earlier = sum(cards for key, cards in counts.items() if key < first)
    points: list[dict[str, Any]] = []
    for start in range(first, last + 1, width):
        end = min(start + width - 1, last)
        value = sum(cards for key, cards in counts.items() if start <= key <= end)
        earlier += value
        points.append(
            {"start": start, "end": end, "value": value, "running": _share(earlier, total)}
        )
    return points


def _day_spread(counts: Counts, chosen: str) -> tuple[int, int]:
    """Days start at zero. A few very long intervals would otherwise squeeze everything left."""
    highest = max(counts, default=0)
    if chosen == "month":
        return 0, min(highest, _MONTH_DAYS)
    return 0, _quantile(counts, _SPREAD[chosen]) if chosen in _SPREAD else highest


def _percent_spread(counts: Counts, chosen: str, lowest: int, highest: int) -> tuple[int, int]:
    """Keeps the middle of the cards, the way Anki's 50 % and 95 % choices do."""
    if chosen in _SPREAD:
        margin = (1 - _SPREAD[chosen]) / 2
        lowest, highest = _quantile(counts, margin), _quantile(counts, 1 - margin)
    return lowest - lowest % _PERCENT_BAR_WIDTH, highest


def _days_view(counts: Counts, chosen: str, facts: Sequence[str]) -> dict[str, Any]:
    first, last = _day_spread(counts, chosen)
    width = max(1, math.ceil((last - first + 1) / _MAX_SPREAD_BARS))
    average, median = facts
    return {
        "kind": "histogram",
        "available": True,
        "mode": "days",
        "points": _bars(counts, first, last, width) if counts else [],
        "facts": [
            _fact(average, _mean(counts), "days"),
            _fact(median, _quantile(counts, 0.5), "days"),
        ],
    }


def _intervals(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    counts = dict(graphs.intervals.intervals)
    return _days_view(counts, params["range"], ("averageInterval", "medianInterval"))


def _unavailable(mode: str) -> dict[str, Any]:
    return {"kind": "histogram", "available": False, "mode": mode, "points": [], "facts": []}


def _stability(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    if not graphs.fsrs:
        return _unavailable("days")
    counts = dict(graphs.stability.intervals)
    return _days_view(counts, params["range"], ("averageStability", "medianStability"))


def _percent_view(
    counts: Counts,
    chosen: str,
    mode: str,
    bounds: tuple[int, int],
    facts: list[dict[str, Any]],
) -> dict[str, Any]:
    first, last = _percent_spread(counts, chosen, *bounds)
    return {
        "kind": "histogram",
        "available": True,
        "mode": mode,
        "points": _bars(counts, first, last, _PERCENT_BAR_WIDTH) if counts else [],
        "facts": facts,
    }


def _difficulty(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    """FSRS replaces ease with difficulty, so one widget shows whichever is in use."""
    if graphs.fsrs:
        counts = dict(graphs.difficulty.eases)
        names = ("averageDifficulty", "medianDifficulty")
    else:
        counts = dict(graphs.eases.eases)
        names = ("averageEase", "medianEase")
    facts = [
        _fact(names[0], _mean(counts), "percent"),
        _fact(names[1], _quantile(counts, 0.5), "percent"),
    ]
    mode = "difficulty" if graphs.fsrs else "ease"
    return _percent_view(
        counts, params["range"], mode, (min(counts, default=0), max(counts, default=0)), facts
    )


def _retrievability(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    if not graphs.fsrs:
        return _unavailable("retrievability")
    data = graphs.retrievability
    facts = [
        _fact("averageRetrievability", data.average, "percent"),
        _fact("knownCards", data.sum_by_card, "cards"),
        _fact("knownNotes", data.sum_by_note, "notes"),
    ]
    return _percent_view(
        dict(data.retrievability), params["range"], "retrievability", (0, 100), facts
    )


def _history_field(chosen: str) -> str:
    return _RANGE_FIELDS.get(chosen, _RANGE_FIELDS["all"])


def _hours(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    rows = getattr(graphs.hours, _history_field(params["range"]))
    points = [
        {"hour": hour, "total": row.total, "correct": row.correct} for hour, row in enumerate(rows)
    ]
    return {"kind": "hours", "points": points}


def _buttons(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    data = getattr(graphs.buttons, _history_field(params["range"]))
    groups: list[dict[str, Any]] = []
    for name in ("learning", "young", "mature"):
        counts = list(getattr(data, name))
        total = sum(counts)
        groups.append(
            {"name": name, "counts": counts, "correct": total - counts[0], "total": total}
        )
    return {"kind": "buttons", "groups": groups}


def _card_counts(graphs: Any, params: Any, _day: date) -> dict[str, Any]:
    source = graphs.card_counts
    data = source.excluding_inactive if params["option"] else source.including_inactive
    items = [
        ("new", data.newCards),
        ("learning", data.learn),
        ("relearning", data.relearn),
        ("young", data.young),
        ("mature", data.mature),
        ("suspended", data.suspended),
        ("buried", data.buried),
    ]
    return {
        "kind": "counts",
        "items": [{"name": name, "value": value} for name, value in items],
        "total": sum(value for _, value in items),
    }


def _calendar(graphs: Any, _params: Any, day: date) -> dict[str, Any]:
    days: list[dict[str, Any]] = [
        {"date": (day + timedelta(days=offset)).isoformat(), "reviews": sum(values)}
        for offset, values in sorted(_review_rows(graphs.reviews.count).items())
    ]
    first = days[0]["date"][:4] if days else str(day.year)
    return {"kind": "calendar", "days": days, "firstYear": int(first), "lastYear": day.year}


_VIEWS: dict[str, Callable[[Any, Any, date], dict[str, Any]]] = {
    "today": _today,
    "future-due": _future_due,
    "calendar": _calendar,
    "reviews": _reviews,
    "card-counts": _card_counts,
    "intervals": _intervals,
    "stability": _stability,
    "difficulty": _difficulty,
    "retrievability": _retrievability,
    "hours": _hours,
    "buttons": _buttons,
    "added": _added,
    "true-retention": _true_retention,
}


def view(params: Any, graphs: Any, reader: CollectionReader) -> dict[str, Any]:
    return _VIEWS[params["view"]](graphs, params, AnkiCalendar(reader.day_cutoff).today)
