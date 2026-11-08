"""The statistics themselves. Each returns plain data; the web app words and formats it.

Two ways of counting run through this file:

- A **review** is a card moved to a later day: an answer that gave it an interval of at least a
  day (``r.ivl > 0``; steps within the day are negative, previews 0). Each card counts at most once
  a day, however often it came up. A card still in its steps at the end of the day counts on the
  day it finally moves on.
- A **rating** is every press of Again, Hard, Good or Easy, the number Anki calls reviews.

The charts take ``measure`` to choose one. Reviews is the default.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any

from ...contract import types
from ...core.reader import STATLY_DECK_NAME, CollectionReader
from .calendar import DAY_SECONDS, AnkiCalendar
from .scope import (
    ANSWERED,
    Period,
    bucket_of,
    card_filter,
    deck_ids,
    granularity_of,
    make_period,
    period_from_params,
    review_filter,
)

QUEUE_NEW = 0
QUEUE_LEARNING = 1
QUEUE_REVIEW = 2
QUEUE_DAY_LEARNING = 3
QUEUE_PREVIEW = 4
QUEUE_SUSPENDED = -1
QUEUE_BURIED_SIBLING = -2
QUEUE_BURIED_MANUAL = -3

REVIEW_LEARNING = 0
REVIEW_REVIEW = 1
REVIEW_RELEARNING = 2

MEASURES = ("reviews", "ratings")
MOVED_ON = "r.ivl > 0"
"""An answer that moved the card to a later day."""

LONG_INTERVAL_DAYS = 21
FORECAST_DAYS = 7
MATURE_DAYS = 21
BUCKET_MS = 15 * 60 * 1000
"""Rhythm counts use quarter hours, so that half-hour time zones land in the right hour."""


def _calendar(reader: CollectionReader) -> AnkiCalendar:
    return AnkiCalendar(reader.day_cutoff)


def _ratio(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def _measure(params: Any) -> str:
    measure = params.get("measure") or "reviews"
    return measure if measure in MEASURES else "reviews"


def _day_of(start_seconds: int) -> str:
    """The SQL for a review's day within a period, counted from the period's first day."""
    return f"(r.id / 1000 - {int(start_seconds)}) / {DAY_SECONDS}"


def today(_params: Any, reader: CollectionReader) -> types.StatisticsTodayResult:
    calendar = _calendar(reader)
    first_review = reader.scalar(f"SELECT MIN(id) FROM revlog AS r WHERE {ANSWERED}")
    first_day = None if first_review is None else calendar.day_of(first_review // 1000)
    return {
        "date": calendar.today.isoformat(),
        "firstReview": first_day.isoformat() if first_day else None,
    }


def decks(_params: Any, reader: CollectionReader) -> list[types.StatisticsDecksResultItem]:
    return [
        {"id": identifier, "name": name}
        for identifier, name in sorted(reader.deck_names().items(), key=lambda item: item[1])
        if name != STATLY_DECK_NAME
    ]


def summary(params: Any, reader: CollectionReader) -> types.StatisticsSummaryResult:
    calendar = _calendar(reader)
    period = period_from_params(params, calendar)
    conditions, parameters = review_filter(
        period, deck_ids(reader, params["deckId"]), reader.excluded_cards
    )
    rows = reader.rows(
        f"""
        SELECT COUNT(*), COALESCE(SUM(r.time), 0),
               COALESCE(SUM(r.ease > 1), 0),
               COALESCE(SUM(r.type = ? AND r.lastIvl >= 1), 0),
               COALESCE(SUM(r.type = ? AND r.lastIvl >= 1 AND r.ease > 1), 0),
               COUNT(DISTINCT (r.id / 1000 - ?) / ?),
               COALESCE(SUM(r.type = 0 AND r.lastIvl = 0), 0)
        FROM revlog AS r
        WHERE {conditions}
        """,
        REVIEW_REVIEW,
        REVIEW_REVIEW,
        period.start_seconds,
        DAY_SECONDS,
        *parameters,
    )
    ratings, elapsed_ms, successes, mature, mature_successes, active_days, new_cards = rows[0]
    # Summing each day's distinct cards is cheaper than collecting distinct (card, day) pairs.
    reviews = reader.scalar(
        f"""
        SELECT SUM(cards) FROM (SELECT COUNT(DISTINCT r.cid) AS cards FROM revlog AS r
                                WHERE {conditions} AND {MOVED_ON}
                                GROUP BY {_day_of(period.start_seconds)})
        """,
        *parameters,
    )
    return {
        "reviews": int(reviews or 0),
        "ratings": ratings,
        "studyTimeMs": elapsed_ms,
        "successRate": _ratio(successes, ratings),
        "retention": _ratio(mature_successes, mature),
        "activeDays": active_days,
        "newCards": new_cards,
    }


def categories(params: Any, reader: CollectionReader) -> types.StatisticsCategoriesResult:
    period = period_from_params(params, _calendar(reader))
    conditions, parameters = review_filter(
        period, deck_ids(reader, params["deckId"]), reader.excluded_cards
    )
    # One row per card first, then the join: far cheaper than eight distinct counts over every
    # answer joined to its card.
    rows = reader.rows(
        f"""
        SELECT COUNT(*), COALESCE(SUM(per_card.failed), 0), COALESCE(SUM(per_card.new), 0),
               COALESCE(SUM(per_card.reviewed), 0), COALESCE(SUM(per_card.relearned), 0),
               COALESCE(SUM(per_card.long_interval), 0), COALESCE(SUM(c.queue = ?), 0),
               COALESCE(SUM(c.queue IN (?, ?)), 0)
        FROM (SELECT r.cid AS cid, MAX(r.ease = 1) AS failed, MAX(r.type = ?) AS new,
                     MAX(r.type = ?) AS reviewed, MAX(r.type = ?) AS relearned,
                     MAX(r.ivl >= ?) AS long_interval
              FROM revlog AS r WHERE {conditions} GROUP BY r.cid) AS per_card
        LEFT JOIN cards AS c ON c.id = per_card.cid
        """,
        QUEUE_SUSPENDED,
        QUEUE_BURIED_SIBLING,
        QUEUE_BURIED_MANUAL,
        REVIEW_LEARNING,
        REVIEW_REVIEW,
        REVIEW_RELEARNING,
        LONG_INTERVAL_DAYS,
        *parameters,
    )
    total, failed, new, reviewed, relearned, long_interval, suspended, buried = rows[0]
    return {
        "total": total,
        "failed": failed,
        "new": new,
        "reviewed": reviewed,
        "relearned": relearned,
        "longInterval": long_interval,
        "suspended": suspended,
        "buried": buried,
    }


def deck_activity(
    params: Any, reader: CollectionReader
) -> list[types.StatisticsDeckActivityResultItem]:
    period = period_from_params(params, _calendar(reader))
    conditions, parameters = review_filter(
        period, deck_ids(reader, params["deckId"]), reader.excluded_cards
    )
    names = reader.deck_names()
    per_card = (
        f"COUNT(DISTINCT {_day_of(period.start_seconds)})"
        if _measure(params) == "reviews"
        else "COUNT(*)"
    )
    moved_on = f" AND {MOVED_ON}" if _measure(params) == "reviews" else ""
    # Counting per card first and then joining is far cheaper than joining every review.
    rows = reader.rows(
        f"""
        SELECT CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END, SUM(counted.number)
        FROM (SELECT r.cid AS cid, {per_card} AS number FROM revlog AS r
              WHERE {conditions}{moved_on} GROUP BY r.cid) AS counted
        LEFT JOIN cards AS c ON c.id = counted.cid
        GROUP BY 1
        """,
        *parameters,
    )
    totals: Counter[int | None] = Counter()
    for deck_id, number in rows:
        # A review can outlive its card or deck. Such rows are kept under one unknown entry.
        totals[deck_id if deck_id in names else None] += number
    activity: list[types.StatisticsDeckActivityResultItem] = [
        {"deckId": deck_id, "name": names.get(deck_id) if deck_id else None, "count": number}
        for deck_id, number in totals.items()
    ]
    activity.sort(key=lambda item: (-item["count"], item["name"] or ""))
    return activity


def _daily(
    reader: CollectionReader, period: Period, decks: tuple[int, ...] | None, measure: str
) -> dict[date, int]:
    """Reviews or ratings per day. Days without any are left out."""
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    counted = "COUNT(DISTINCT r.cid)" if measure == "reviews" else "COUNT(*)"
    moved_on = f" AND {MOVED_ON}" if measure == "reviews" else ""
    rows = reader.rows(
        f"""
        SELECT {_day_of(period.start_seconds)}, {counted}
        FROM revlog AS r
        WHERE {conditions}{moved_on}
        GROUP BY 1
        """,
        *parameters,
    )
    return {period.first_day + timedelta(days=offset): number for offset, number in rows}


def timeline(params: Any, reader: CollectionReader) -> types.StatisticsTimelineResult:
    period = period_from_params(params, _calendar(reader))
    daily = _daily(reader, period, deck_ids(reader, params["deckId"]), _measure(params))
    granularity = granularity_of(period)

    buckets: dict[date, int] = {}
    for offset in range(period.days):
        day = period.first_day + timedelta(days=offset)
        bucket = bucket_of(day, granularity)
        buckets[bucket] = buckets.get(bucket, 0) + daily.get(day, 0)

    items: list[types.StatisticsTimelineResultItemsItem] = []
    running_total = 0
    for index, (bucket, number) in enumerate(buckets.items(), start=1):
        running_total += number
        items.append(
            {
                "date": bucket.isoformat(),
                "count": number,
                "runningAverage": running_total / index,
            }
        )
    return {"granularity": granularity, "items": items}


def answer_buttons(params: Any, reader: CollectionReader) -> types.StatisticsAnswerButtonsResult:
    period = period_from_params(params, _calendar(reader))
    conditions, parameters = review_filter(
        period, deck_ids(reader, params["deckId"]), reader.excluded_cards
    )
    rows = reader.rows(
        f"SELECT r.ease, COUNT(*) FROM revlog AS r WHERE {conditions} GROUP BY r.ease",
        *parameters,
    )
    counts = {ease: reviews for ease, reviews in rows}
    return {
        "again": counts.get(1, 0),
        "hard": counts.get(2, 0),
        "good": counts.get(3, 0),
        "easy": counts.get(4, 0),
    }


def rhythm(params: Any, reader: CollectionReader) -> types.StatisticsRhythmResult:
    period = period_from_params(params, _calendar(reader))
    conditions, parameters = review_filter(
        period, deck_ids(reader, params["deckId"]), reader.excluded_cards
    )
    # Converting to local time in SQL takes most of this query's time. Doing it once per
    # quarter hour in Python keeps daylight saving correct at a fraction of the cost. A review
    # lands in the quarter hour of the answer that moved the card on.
    if _measure(params) == "reviews":
        counted, conditions = "COUNT(DISTINCT r.cid)", f"{conditions} AND {MOVED_ON}"
    else:
        counted = "COUNT(*)"
    rows = reader.rows(
        f"SELECT r.id / ?, {counted} FROM revlog AS r WHERE {conditions} GROUP BY 1",
        BUCKET_MS,
        *parameters,
    )
    weekdays = [0] * 7
    hours = [0] * 24
    for bucket, reviews in rows:
        moment = datetime.fromtimestamp(bucket * BUCKET_MS / 1000)
        weekdays[moment.weekday()] += reviews
        hours[moment.hour] += reviews
    return {"weekdays": weekdays, "hours": hours}


def _streaks(active_days: Iterable[date], current_day: date) -> tuple[int, int]:
    """Return the longest and current streak of consecutive active days.

    Today not being studied yet does not end a streak: the day is not over.
    """
    days = sorted(set(active_days))
    active = set(days)
    longest = 0
    run = 0
    previous: date | None = None
    for day in days:
        run = run + 1 if previous is not None and (day - previous).days == 1 else 1
        longest = max(longest, run)
        previous = day

    day = current_day if current_day in active else current_day - timedelta(days=1)
    current = 0
    while day in active:
        current += 1
        day -= timedelta(days=1)
    return longest, current


def heatmap(params: Any, reader: CollectionReader) -> types.StatisticsHeatmapResult:
    calendar = _calendar(reader)
    current_day = calendar.today
    decks_in_scope = deck_ids(reader, params["deckId"])
    first_review = reader.scalar(f"SELECT MIN(id) FROM revlog AS r WHERE {ANSWERED}")
    first_day = (
        current_day
        if first_review is None
        else min(current_day, calendar.day_of(first_review // 1000))
    )
    # Any answer makes a study day, so a day spent only on learning steps keeps the streak.
    history = _daily(
        reader, make_period(calendar, first_day, current_day), decks_in_scope, "ratings"
    )
    longest, current = _streaks(history, current_day)

    year = params["year"] or current_day.year
    year_start = date(year, 1, 1)
    period_end = min(date(year, 12, 31), current_day)
    elapsed_days = max((period_end - year_start).days + 1, 0)
    studied = sum(1 for day in history if day.year == year)
    if _measure(params) == "ratings":
        in_year = {day: number for day, number in history.items() if day.year == year}
    elif year_start <= period_end:
        # Reviews only for the year shown: counting cards once a day costs more than ratings.
        span = make_period(calendar, max(year_start, first_day), period_end)
        in_year = _daily(reader, span, decks_in_scope, "reviews")
    else:
        in_year = {}
    days: list[types.StatisticsHeatmapResultDaysItem] = [
        {"date": day.isoformat(), "count": number} for day, number in sorted(in_year.items())
    ]
    total = sum(in_year.values())
    return {
        "year": year,
        "firstYear": first_day.year,
        "lastYear": current_day.year,
        "today": current_day.isoformat(),
        "days": days,
        "total": total,
        "dailyAverage": total / elapsed_days if elapsed_days else 0,
        "daysLearned": studied / elapsed_days if elapsed_days else 0,
        "longestStreak": longest,
        "currentStreak": current,
    }


def due(params: Any, reader: CollectionReader) -> types.StatisticsDueResult:
    conditions, parameters = card_filter(deck_ids(reader, params["deckId"]), reader.excluded_cards)
    cards = reader.scalar(
        f"""
        SELECT COUNT(*) FROM cards
        WHERE {conditions}
          AND ((queue IN (?, ?) AND due <= ?) OR (queue = ? AND due <= ?))
        """,
        *parameters,
        QUEUE_REVIEW,
        QUEUE_DAY_LEARNING,
        reader.today,
        QUEUE_LEARNING,
        reader.day_cutoff,
    )
    return {"cards": cards}


def forecast(params: Any, reader: CollectionReader) -> list[types.StatisticsForecastResultItem]:
    conditions, parameters = card_filter(deck_ids(reader, params["deckId"]), reader.excluded_cards)
    current = reader.today
    days = int(params.get("days") or FORECAST_DAYS)
    rows = reader.rows(
        f"""
        SELECT MAX(due, ?), COUNT(*) FROM cards
        WHERE {conditions} AND queue IN (?, ?) AND due <= ?
        GROUP BY 1
        """,
        current,
        *parameters,
        QUEUE_REVIEW,
        QUEUE_DAY_LEARNING,
        current + days - 1,
    )
    counts = {day - current: cards for day, cards in rows}
    first_day = _calendar(reader).today
    return [
        {"date": (first_day + timedelta(days=offset)).isoformat(), "cards": counts.get(offset, 0)}
        for offset in range(days)
    ]


def card_states(params: Any, reader: CollectionReader) -> types.StatisticsCardStatesResult:
    conditions, parameters = card_filter(deck_ids(reader, params["deckId"]), reader.excluded_cards)
    rows = reader.rows(
        f"SELECT queue, COUNT(*), SUM(type = 2 AND ivl >= ?) FROM cards WHERE {conditions} "
        "GROUP BY queue",
        MATURE_DAYS,
        *parameters,
    )
    counts = {queue: cards for queue, cards, _mature in rows}
    known = {
        QUEUE_NEW,
        QUEUE_LEARNING,
        QUEUE_DAY_LEARNING,
        QUEUE_REVIEW,
        QUEUE_SUSPENDED,
        QUEUE_BURIED_SIBLING,
        QUEUE_BURIED_MANUAL,
    }
    return {
        "new": counts.get(QUEUE_NEW, 0),
        "learning": counts.get(QUEUE_LEARNING, 0) + counts.get(QUEUE_DAY_LEARNING, 0),
        "review": counts.get(QUEUE_REVIEW, 0),
        "suspended": counts.get(QUEUE_SUSPENDED, 0),
        "buried": counts.get(QUEUE_BURIED_SIBLING, 0) + counts.get(QUEUE_BURIED_MANUAL, 0),
        "other": sum(cards for queue, cards in counts.items() if queue not in known),
        "mature": sum(mature or 0 for _queue, _cards, mature in rows),
    }
