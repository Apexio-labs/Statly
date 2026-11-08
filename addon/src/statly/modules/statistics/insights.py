"""Statistics that look closer at a range: which cards were forgotten, how each deck stands, how
the days went, how fast answers came and where the study time went.

Words used throughout:

- **First sight**: the very first answer to a new card (``type = 0`` and ``lastIvl = 0``). Not
  knowing a card one has never seen is no forgetting, so it never counts as forgotten.
- **Checked**: an answer to a card in review with an interval of at least a day. Its share of
  Hard or better is the retention, as in ``metrics.summary``.
- **Usual pace**: how long each kind of answer normally takes, fitted on the 90 days up to the
  end of the range. An answer slower than usual by more than one spread is "slow"; the share of
  answers that are not slow is the focus.
"""

from __future__ import annotations

import bisect
import html
import math
import re
import statistics
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from ...core.reader import STATLY_DECK_NAME, CollectionReader
from .calendar import DAY_SECONDS, AnkiCalendar
from .scope import Period, card_filter, deck_ids, make_period, period_from_params, review_filter

FIRST_SIGHT = "(r.type = 0 AND r.lastIvl = 0)"
CHECKED = "(r.type = 1 AND r.lastIvl >= 1)"
MATURE_DAYS = 21
CARD_TYPE_REVIEW = 2
CARD_TYPE_RELEARNING = 3

MAX_FORGOTTEN = 50
TEXT_CHARS = 160
MAX_DECK_ROWS = 400
MAX_BUCKETS = 12
TOPICS_SHOWN = 8
TOPIC_SOLID = 10
TOPIC_SOME = 3

# Stability against cards first studied around the same time, by days since that first answer.
AGE_BANDS = (14, 30, 60, 120, 240, 480)
STABILITY_MIN_CARDS = 20
STABILITY_CLIP = 1.6
"""A card counts at most e^1.6, about five times, above or below its cohort."""
STABILITY_SELF_SHARE = 0.6
"""Beyond this, a deck would mostly be compared with itself, which says nothing."""

PACE_DAYS = 90
BIN_MS = 250
SPREAD_MIN = 0.15
PACE_MIN_ANSWERS = 20
SLOW_AT = 1.0
"""Answers slower than usual by more than this many spreads are slow."""
Z_LOW, Z_HIGH, Z_STEP = -3.0, 5.0, 0.25
SESSION_GAP_MS = 5 * 60 * 1000
SESSION_DAYS = 14
FOCUS_MIN_ANSWERS = 5

KIND_NEW, KIND_REVIEW, KIND_RELEARNING, KIND_LEARNING = 0, 1, 2, 3
KIND_SQL = (
    f"CASE WHEN {FIRST_SIGHT} THEN {KIND_NEW} WHEN r.type IN (1, 3) THEN {KIND_REVIEW} "
    f"WHEN r.type = 2 THEN {KIND_RELEARNING} ELSE {KIND_LEARNING} END"
)

_FIELD_SEPARATOR = "\x1f"
_TAG = re.compile(r"<[^>]+>")
_MEDIA = re.compile(r"\[(?:sound|anki):[^\]]*\]")
_CLOZE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}", re.S)
_STABILITY = re.compile(r'"s"\s*:\s*([0-9.eE+-]+)')


def _calendar(reader: CollectionReader) -> AnkiCalendar:
    return AnkiCalendar(reader.day_cutoff)


def _scope(params: Any, reader: CollectionReader) -> tuple[Period, tuple[int, ...] | None]:
    return period_from_params(params, _calendar(reader)), deck_ids(reader, params["deckId"])


def _ratio(part: float, whole: float) -> float | None:
    return part / whole if whole else None


def _home_deck() -> str:
    """Cards in a filtered deck count for the deck they came from."""
    return "CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END"


def card_text(sort_field: str, fields: str) -> str:
    """A card's words without markup, cloze gaps filled in, short enough for one line."""

    def plain(value: str) -> str:
        text = _CLOZE.sub(r"\1", value)
        text = _MEDIA.sub("", _TAG.sub(" ", text))
        return " ".join(html.unescape(text).split())

    text = plain(sort_field)
    if not text:
        text = next(
            (found for part in fields.split(_FIELD_SEPARATOR) if (found := plain(part))), ""
        )
    return text[:TEXT_CHARS]


def _split(name: str) -> tuple[str, str]:
    """The last part of a deck's name and the path above it."""
    parts = name.split("::")
    return parts[-1], "::".join(parts[:-1])


# ── Forgotten cards ──────────────────────────────────────────────────────────────────────────


def forgotten(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """Cards answered Again most often in the range, never counting a first sight."""
    period, decks = _scope(params, reader)
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    limit = min(int(params.get("limit") or 20), MAX_FORGOTTEN)
    rows = reader.rows(
        f"""
        SELECT r.cid, SUM(r.ease = 1 AND NOT {FIRST_SIGHT}) AS forgot, SUM(NOT {FIRST_SIGHT})
        FROM revlog AS r WHERE {conditions}
        GROUP BY r.cid HAVING forgot > 0
        ORDER BY 2 DESC, 3 DESC, r.cid
        """,
        *parameters,
    )
    names = reader.deck_names()
    cards: list[dict[str, Any]] = []
    # Deleted cards stay in the history but cannot be shown, so a few more are read than needed.
    for start in range(0, len(rows), limit * 2):
        chunk = rows[start : start + limit * 2]
        ids = [card_id for card_id, _forgot, _seen in chunk]
        marks = ", ".join("?" for _ in ids)
        found = {
            row[0]: row
            for row in reader.rows(
                f"""
                SELECT c.id, {_home_deck()}, c.ivl, c.type, n.sfld, n.flds
                FROM cards AS c JOIN notes AS n ON n.id = c.nid WHERE c.id IN ({marks})
                """,
                *ids,
            )
        }
        for card_id, forgot, seen in chunk:
            card = found.get(card_id)
            if card is None:
                continue
            _id, deck, interval, kind, sort_field, fields = card
            reviewed = kind in (CARD_TYPE_REVIEW, CARD_TYPE_RELEARNING) and interval > 0
            cards.append(
                {
                    "cardId": card_id,
                    "text": card_text(str(sort_field), str(fields)),
                    "deck": names.get(deck, ""),
                    "forgot": int(forgot),
                    "seen": int(seen),
                    "intervalDays": int(interval) if reviewed else None,
                }
            )
            if len(cards) >= limit:
                break
        if len(cards) >= limit:
            break
    return {"cards": cards, "total": len(rows)}


# ── Decks ────────────────────────────────────────────────────────────────────────────────────


def _bucket_starts(period: Period, count: int) -> list[date]:
    return [
        period.first_day + timedelta(days=-(-index * period.days // count))
        for index in range(count)
    ]


@dataclass
class _DeckStats:
    count: int = 0
    time_ms: int = 0
    checked: int = 0
    passed: int = 0
    cards: int = 0
    mature: int = 0
    series: list[int] = field(default_factory=list[int])
    scores: list[tuple[float, float, int]] = field(default_factory=list[tuple[float, float, int]])
    """Each review card as its score against its cohort, its stability and its cohort."""

    def add(self, other: _DeckStats) -> None:
        self.count += other.count
        self.time_ms += other.time_ms
        self.checked += other.checked
        self.passed += other.passed
        self.cards += other.cards
        self.mature += other.mature
        for index, value in enumerate(other.series):
            self.series[index] += value
        self.scores.extend(other.scores)


def _stability_scores(
    reader: CollectionReader, decks: tuple[int, ...] | None, today: date, calendar: AnkiCalendar
) -> tuple[dict[int, list[tuple[float, float, int]]], dict[int, int], bool]:
    """Each review card's stability, or its interval without FSRS, against the cards first
    studied around the same time. A newer deck would otherwise look weak just for being new."""
    conditions, parameters = card_filter(decks, reader.excluded_cards)
    cards = reader.rows(
        f"""
        SELECT c.id, {_home_deck()}, c.ivl, c.data,
               (SELECT MIN(r.id) FROM revlog AS r WHERE r.cid = c.id AND r.ease > 0)
        FROM (SELECT id FROM cards WHERE {conditions} AND type = ? AND queue >= 0 AND ivl > 0)
             AS chosen
        JOIN cards AS c ON c.id = chosen.id
        """,
        *parameters,
        CARD_TYPE_REVIEW,
    )
    with_stability = 0
    pool: list[tuple[int, float, float, int]] = []
    for _card_id, deck, interval, data, first in cards:
        found = _STABILITY.search(data or "")
        value = float(found.group(1)) if found else 0.0
        with_stability += value > 0
        if first is not None:
            pool.append((deck, value, float(interval), int(first)))
    use_fsrs = bool(cards) and 2 * with_stability >= len(cards)
    by_band: dict[int, list[float]] = defaultdict(list)
    entries: list[tuple[int, float, int]] = []
    for deck, value, interval, first in pool:
        chosen = value if use_fsrs else interval
        if chosen <= 0:
            continue
        age = (today - calendar.day_of(first // 1000)).days
        band = bisect.bisect_left(AGE_BANDS, age)
        by_band[band].append(chosen)
        entries.append((deck, chosen, band))
    medians = {band: statistics.median(values) for band, values in by_band.items()}

    def clip(value: float) -> float:
        return max(-STABILITY_CLIP, min(STABILITY_CLIP, value))

    centers = {
        band: statistics.fmean(clip(math.log(value / medians[band])) for value in values)
        for band, values in by_band.items()
    }
    scores: dict[int, list[tuple[float, float, int]]] = defaultdict(list)
    for deck, chosen, band in entries:
        score = clip(math.log(chosen / medians[band])) - centers[band]
        scores[deck].append((score, chosen, band))
    return scores, {band: len(values) for band, values in by_band.items()}, use_fsrs


def _stability_of(
    scores: Sequence[tuple[float, float, int]], band_sizes: Mapping[int, int]
) -> tuple[float | None, float | None]:
    """How a deck's cards stand against their cohorts, as a factor, and their median."""
    if len(scores) < STABILITY_MIN_CARDS:
        return None, None
    median = statistics.median(value for _score, value, _band in scores)
    mine: dict[int, int] = defaultdict(int)
    for _score, _value, band in scores:
        mine[band] += 1
    self_share = sum(n * n / band_sizes[band] for band, n in mine.items()) / len(scores)
    if self_share > STABILITY_SELF_SHARE:
        return None, median
    return math.exp(statistics.fmean(score for score, _value, _band in scores)), median


def deck_table(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """Every deck in the scope with its activity, time, retention, stability and mature share.

    Rows come as a flat list with each row's parent, so a deck tree of any depth fits the
    contract. Decks that only hold other decks open by themselves at the top.
    """
    calendar = _calendar(reader)
    period, decks = _scope(params, reader)
    reviews = (params.get("measure") or "reviews") == "reviews"
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    buckets = max(1, min(MAX_BUCKETS, period.days))
    day = f"((r.id / 1000 - {int(period.start_seconds)}) / {DAY_SECONDS})"
    counted = f"COUNT(DISTINCT CASE WHEN r.ivl > 0 THEN {day} END)" if reviews else "COUNT(*)"
    own: dict[int, _DeckStats] = defaultdict(lambda: _DeckStats(series=[0] * buckets))
    rows = reader.rows(
        f"""
        SELECT {_home_deck()}, per.bucket, SUM(per.number), SUM(per.ms), SUM(per.checked),
               SUM(per.passed)
        FROM (SELECT r.cid AS cid, {day} * ? / ? AS bucket, {counted} AS number,
                     SUM(r.time) AS ms, SUM({CHECKED}) AS checked,
                     SUM({CHECKED} AND r.ease > 1) AS passed
              FROM revlog AS r WHERE {conditions} GROUP BY r.cid, bucket) AS per
        JOIN cards AS c ON c.id = per.cid
        GROUP BY 1, 2
        """,
        buckets,
        period.days,
        *parameters,
    )
    for deck, bucket, number, time_ms, checked, passed in rows:
        stats = own[deck]
        stats.count += number
        stats.series[min(int(bucket), buckets - 1)] += number
        stats.time_ms += time_ms or 0
        stats.checked += checked or 0
        stats.passed += passed or 0
    card_conditions, card_parameters = card_filter(decks, reader.excluded_cards)
    for deck, cards, mature in reader.rows(
        f"""
        SELECT CASE WHEN odid != 0 THEN odid ELSE did END, COUNT(*),
               SUM(type = ? AND ivl >= ?)
        FROM cards WHERE {card_conditions} GROUP BY 1
        """,
        CARD_TYPE_REVIEW,
        MATURE_DAYS,
        *card_parameters,
    ):
        own[deck].cards += cards
        own[deck].mature += mature or 0
    scores, band_sizes, use_fsrs = _stability_scores(reader, decks, calendar.today, calendar)
    for deck, found in scores.items():
        own[deck].scores.extend(found)

    names = {deck: name for deck, name in reader.deck_names().items() if name != STATLY_DECK_NAME}
    ids = {name: deck for deck, name in names.items()}
    children: dict[int | None, list[int]] = defaultdict(list)
    for deck, name in names.items():
        parent = name.rsplit("::", 1)[0] if "::" in name else None
        children[ids.get(parent) if parent else None].append(deck)
    total: dict[int, _DeckStats] = {}

    def gather(deck: int) -> _DeckStats:
        stats = _DeckStats(series=[0] * buckets)
        if deck in own:
            stats.add(own[deck])
        for child in children.get(deck, []):
            stats.add(gather(child))
        total[deck] = stats
        return stats

    for root in children[None]:
        gather(root)

    def visible(deck: int) -> bool:
        stats = total.get(deck)
        return stats is not None and (stats.cards > 0 or stats.count > 0)

    def holds_cards(deck: int) -> bool:
        return deck in own and own[deck].cards > 0

    scope_root = params["deckId"]
    starts = [scope_root] if scope_root is not None and scope_root in names else children[None]
    top: list[tuple[int, str]] = []

    def open_folders(deck: int, path: str) -> None:
        kids = [child for child in children.get(deck, []) if visible(child)]
        if not holds_cards(deck) and kids:
            for child in kids:
                open_folders(child, _join(path, _split(names[deck])[0]))
        elif visible(deck):
            top.append((deck, path))

    def _join(path: str, part: str) -> str:
        return f"{path}::{part}" if path else part

    for start in starts:
        open_folders(start, "")

    result: list[dict[str, Any]] = []

    def row(deck: int, parent: int | None, depth: int, path: str) -> None:
        if len(result) >= MAX_DECK_ROWS:
            return
        stats = total[deck]
        stability, stability_days = _stability_of(stats.scores, band_sizes)
        kids = sorted(
            (child for child in children.get(deck, []) if visible(child)),
            key=lambda child: (-total[child].count, names[child]),
        )
        result.append(
            {
                "deckId": deck,
                "parentId": parent,
                "depth": depth,
                "name": _split(names[deck])[0],
                "path": path,
                "count": stats.count,
                "series": stats.series,
                "timeMs": stats.time_ms,
                "retention": _ratio(stats.passed, stats.checked),
                "cards": stats.cards,
                "matureShare": _ratio(stats.mature, stats.cards),
                "stability": stability,
                "stabilityDays": stability_days,
                "children": len(kids),
            }
        )
        for child in kids:
            row(child, deck, depth + 1, "")

    for deck, path in sorted(top, key=lambda item: (-total[item[0]].count, names[item[0]])):
        row(deck, None, 0, path)
    return {
        "buckets": [day.isoformat() for day in _bucket_starts(period, buckets)],
        "stabilityKind": "stability" if use_fsrs else "interval",
        "rows": result,
    }


# ── Days ─────────────────────────────────────────────────────────────────────────────────────


def daily(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """Every day of the range, also the ones without answers."""
    period, decks = _scope(params, reader)
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    rows = reader.rows(
        f"""
        SELECT (r.id / 1000 - ?) / ?, COUNT(*), COUNT(DISTINCT CASE WHEN r.ivl > 0 THEN r.cid END),
               SUM(r.time), SUM({FIRST_SIGHT}), SUM({CHECKED}), SUM({CHECKED} AND r.ease > 1)
        FROM revlog AS r WHERE {conditions} GROUP BY 1
        """,
        period.start_seconds,
        DAY_SECONDS,
        *parameters,
    )
    found = {int(offset): row for offset, *row in rows}
    days: list[dict[str, Any]] = []
    for offset in range(period.days):
        ratings, reviews, time_ms, new, checked, passed = found.get(offset, (0, 0, 0, 0, 0, 0))
        days.append(
            {
                "date": (period.first_day + timedelta(days=offset)).isoformat(),
                "reviews": reviews,
                "ratings": ratings,
                "timeMs": time_ms or 0,
                "newCards": new or 0,
                "checked": checked or 0,
                "passed": passed or 0,
            }
        )
    return {"days": days}


def answer_mix(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """Which buttons were pressed, and on which kind of card."""
    period, decks = _scope(params, reader)
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    row = reader.rows(
        f"""
        SELECT COALESCE(SUM(r.ease = 1), 0), COALESCE(SUM(r.ease = 2), 0),
               COALESCE(SUM(r.ease = 3), 0), COALESCE(SUM(r.ease = 4), 0),
               COALESCE(SUM({FIRST_SIGHT}), 0),
               COALESCE(SUM(r.type = 0 AND NOT {FIRST_SIGHT}), 0),
               COALESCE(SUM(r.type IN (1, 3)), 0), COALESCE(SUM(r.type = 2), 0)
        FROM revlog AS r WHERE {conditions}
        """,
        *parameters,
    )[0]
    keys = ("again", "hard", "good", "easy", "new", "learning", "review", "relearning")
    return dict(zip(keys, (int(value) for value in row), strict=True))


def topics(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """The decks with the lowest retention, and where new cards came from."""
    period, decks = _scope(params, reader)
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    rows = reader.rows(
        f"""
        SELECT {_home_deck()}, SUM(per.checked), SUM(per.passed), SUM(per.new)
        FROM (SELECT r.cid AS cid, SUM({CHECKED}) AS checked,
                     SUM({CHECKED} AND r.ease > 1) AS passed, SUM({FIRST_SIGHT}) AS new
              FROM revlog AS r WHERE {conditions} GROUP BY r.cid) AS per
        JOIN cards AS c ON c.id = per.cid
        GROUP BY 1
        """,
        *parameters,
    )
    names = reader.deck_names()
    entries = [
        (deck, int(checked or 0), int(passed or 0), int(new or 0))
        for deck, checked, passed, new in rows
        if deck in names
    ]

    def tier(checked: int) -> int:
        return 0 if checked >= TOPIC_SOLID else 1 if checked >= TOPIC_SOME else 2

    def named(deck: int) -> dict[str, Any]:
        name, path = _split(names[deck])
        return {"deckId": deck, "name": name, "path": path}

    weakest = sorted(
        (entry for entry in entries if entry[1] > 0),
        key=lambda entry: (tier(entry[1]), entry[2] / entry[1], -entry[1], names[entry[0]]),
    )[:TOPICS_SHOWN]
    new_from = sorted(
        (entry for entry in entries if entry[3] > 0),
        key=lambda entry: (-entry[3], names[entry[0]]),
    )[:TOPICS_SHOWN]
    checked = sum(entry[1] for entry in entries)
    return {
        "retention": _ratio(sum(entry[2] for entry in entries), checked),
        "weakest": [{**named(deck), "checked": c, "passed": p} for deck, c, p, _new in weakest],
        "newFrom": [{**named(deck), "cards": new} for deck, _c, _p, new in new_from],
        "newCards": sum(entry[3] for entry in entries),
    }


# ── Pace and focus ───────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Pace:
    """The usual time of one kind of answer, as the middle and spread of its logarithm."""

    middle: float
    spread: float

    def z(self, millis: float) -> float:
        return (math.log(max(millis, 1.0)) - self.middle) / self.spread

    @property
    def slow_from_ms(self) -> int:
        return int(math.exp(self.middle + SLOW_AT * self.spread))


type Bins = dict[int, dict[int, int]]
"""Answers by kind and by their time in steps of ``BIN_MS``."""


def _bins(reader: CollectionReader, period: Period, decks: tuple[int, ...] | None) -> Bins:
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    found: Bins = defaultdict(dict)
    for kind, step, answers in reader.rows(
        f"""
        SELECT {KIND_SQL}, r.time / ?, COUNT(*) FROM revlog AS r
        WHERE {conditions} AND r.time > 0 GROUP BY 1, 2
        """,
        BIN_MS,
        *parameters,
    ):
        found[int(kind)][int(step)] = answers
    return found


def _millis(step: int) -> float:
    return (step + 0.5) * BIN_MS


def _weighted_quantile(pairs: Sequence[tuple[float, int]], share: float) -> float:
    """``pairs`` must be sorted by value."""
    total = sum(weight for _value, weight in pairs)
    goal, running = share * total, 0
    for value, weight in pairs:
        running += weight
        if running >= goal:
            return value
    return pairs[-1][0]


def _fit(counts: Mapping[int, int]) -> Pace | None:
    pairs = sorted((math.log(_millis(step)), answers) for step, answers in counts.items())
    if sum(answers for _value, answers in pairs) < PACE_MIN_ANSWERS:
        return None
    middle = _weighted_quantile(pairs, 0.5)
    spread = (_weighted_quantile(pairs, 0.75) - _weighted_quantile(pairs, 0.25)) / 1.349
    return Pace(middle, max(spread, SPREAD_MIN))


def usual_pace(
    reader: CollectionReader, last_day: date, decks: tuple[int, ...] | None
) -> dict[int, Pace]:
    """Each kind of answer's usual time over the 90 days up to ``last_day``."""
    calendar = _calendar(reader)
    span = make_period(calendar, last_day - timedelta(days=PACE_DAYS - 1), last_day)
    bins = _bins(reader, span, decks)
    pooled: dict[int, int] = defaultdict(int)
    for counts in bins.values():
        for step, answers in counts.items():
            pooled[step] += answers
    fallback = _fit(pooled) or Pace(math.log(8000.0), 0.6)
    return {kind: _fit(bins.get(kind, {})) or fallback for kind in range(4)}


def _distribution(bins: Bins, pace: Mapping[int, Pace]) -> dict[str, Any]:
    scored = sorted(
        (pace[kind].z(_millis(step)), answers, _millis(step))
        for kind, counts in bins.items()
        for step, answers in counts.items()
    )
    answers = sum(weight for _z, weight, _ms in scored)
    width = round((Z_HIGH - Z_LOW) / Z_STEP)
    histogram = [0] * width
    for z, weight, _ms in scored:
        histogram[max(0, min(width - 1, int((z - Z_LOW) / Z_STEP)))] += weight
    if not answers:
        return {
            "answers": 0,
            "focus": None,
            "medianMs": None,
            "quantiles": None,
            "histogram": histogram,
        }
    pairs = [(z, weight) for z, weight, _ms in scored]
    times = sorted((ms, weight) for _z, weight, ms in scored)
    return {
        "answers": answers,
        "focus": sum(weight for z, weight in pairs if z <= SLOW_AT) / answers,
        "medianMs": round(_weighted_quantile(times, 0.5)),
        "quantiles": [_weighted_quantile(pairs, share) for share in (0.05, 0.25, 0.5, 0.75, 0.95)],
        "histogram": histogram,
    }


def _previous(period: Period, calendar: AnkiCalendar) -> Period | None:
    last = period.first_day - timedelta(days=1)
    first = last - timedelta(days=period.days - 1)
    return make_period(calendar, first, last) if first.year >= 2006 else None


def speed(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """How fast answers came compared with the usual pace, for the range and the one before."""
    calendar = _calendar(reader)
    period, decks = _scope(params, reader)
    pace = usual_pace(reader, period.last_day, decks)
    before = _previous(period, calendar)
    return {
        "zLow": Z_LOW,
        "zStep": Z_STEP,
        "slowAt": SLOW_AT,
        "usualMs": {
            name: round(math.exp(pace[kind].middle))
            for name, kind in (("new", KIND_NEW), ("review", KIND_REVIEW))
        },
        "current": _distribution(_bins(reader, period, decks), pace),
        "previous": _distribution(_bins(reader, before, decks), pace) if before else None,
    }


def _slow_case(pace: Mapping[int, Pace]) -> tuple[str, list[int]]:
    """SQL that is 1 for an answer that was not slow, with its limits as parameters."""
    return (
        f"(r.time <= CASE {KIND_SQL} WHEN 0 THEN ? WHEN 1 THEN ? WHEN 2 THEN ? ELSE ? END)",
        [pace[kind].slow_from_ms for kind in range(4)],
    )


def sessions(params: Any, reader: CollectionReader) -> dict[str, Any]:
    """When studying happened: sessions of the last days of the range, and every hour of the day
    over the whole range, each with its focus."""
    calendar = _calendar(reader)
    period, decks = _scope(params, reader)
    pace = usual_pace(reader, period.last_day, decks)
    fast, limits = _slow_case(pace)
    conditions, parameters = review_filter(period, decks, reader.excluded_cards)
    hours = [[0, 0] for _ in range(24)]
    quarter = 15 * 60 * 1000
    for bucket, answers, focused in reader.rows(
        f"SELECT r.id / ?, COUNT(*), SUM({fast}) FROM revlog AS r WHERE {conditions} GROUP BY 1",
        quarter,
        *limits,
        *parameters,
    ):
        hour = datetime.fromtimestamp(bucket * quarter / 1000).hour
        hours[hour][0] += answers
        hours[hour][1] += focused or 0

    first_shown = max(period.first_day, period.last_day - timedelta(days=SESSION_DAYS - 1))
    recent = make_period(calendar, first_shown, period.last_day)
    recent_conditions, recent_parameters = review_filter(recent, decks, reader.excluded_cards)
    answers = reader.rows(
        f"""
        SELECT r.id, r.time, {fast}, {CHECKED}, r.ease > 1
        FROM revlog AS r WHERE {recent_conditions} ORDER BY r.id
        """,
        *limits,
        *recent_parameters,
    )
    days: dict[date, list[dict[str, Any]]] = {}
    current: list[tuple[int, int, int, int, int]] = []

    def close() -> None:
        if not current:
            return
        begin = current[0][0] - current[0][1]
        end = current[-1][0]
        day = calendar.day_of(begin // 1000)
        start_of_day = calendar.day_start(day)
        checked = sum(item[3] for item in current)
        days.setdefault(day, []).append(
            {
                "start": max(0, begin // 1000 - start_of_day),
                "end": min(
                    DAY_SECONDS, max(end // 1000 - start_of_day, begin // 1000 - start_of_day + 1)
                ),
                "ratings": len(current),
                "timeMs": sum(item[1] for item in current),
                "focus": (
                    sum(item[2] for item in current) / len(current)
                    if len(current) >= FOCUS_MIN_ANSWERS
                    else None
                ),
                "retention": _ratio(sum(item[4] for item in current if item[3]), checked),
            }
        )
        current.clear()

    for moment, taken, focused, checked, passed in answers:
        if current and moment - taken - current[-1][0] > SESSION_GAP_MS:
            close()
        current.append((moment, taken, int(focused), int(checked), int(passed)))
    close()
    shown = [first_shown + timedelta(days=offset) for offset in range(recent.days)]
    return {
        "dayStartHour": datetime.fromtimestamp(calendar.today_start).hour,
        "days": [{"date": day.isoformat(), "sessions": days.get(day, [])} for day in shown],
        "hours": [
            {
                "ratings": total,
                "focus": _ratio(focused, total) if total >= FOCUS_MIN_ANSWERS else None,
            }
            for total, focused in hours
        ],
    }
