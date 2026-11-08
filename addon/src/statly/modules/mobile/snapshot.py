"""Turns the dashboard into the data the card draws."""

from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta
from typing import Any

from ...core.reader import CollectionReader
from ..statistics import insights, metrics
from ..statistics.calendar import AnkiCalendar
from .anki_blocks import PREFIX as ANKI_PREFIX
from .anki_blocks import AnkiBlocks
from .formats import duration, heat_levels, number, percent
from .labels import labels_for, month_name

_MAX_DECK_ROWS = 8
_PERIOD_DAYS = {"today": 1, "last7": 7, "last30": 30, "lastYear": 365}
_CUSTOM_PREFIX = "custom:"
_MAX_MEDIA_CHARS = 300_000

type Thumbnail = Callable[[dict[str, str]], str | None]
type Creation = Callable[[dict[str, Any]], dict[str, Any]]
_CREATION_METRICS = ("creationTime", "cardsCreated", "secondsPerCreatedCard")

_WORDS = ("back", "average", "best", "share", "comparedTo", "videoHere")
_TILE_PERIODS = ("today", "last7", "last30")
# Custom widget sources that count ratings instead of reviews.
_RATING_SERIES = {"ratingTimeline": "timeline"}
_DAILY_SERIES = ("retentionTimeline", "speedTimeline", "timeTimeline", "newTimeline")
_MAX_TABLE_ROWS = 8
_LABEL_CHARS = 60
# Notes promise to stay on this computer, so they never go onto the synced card.
_DESKTOP_ONLY = {"day-notes"}


def _daily_value(source: str, day: Any) -> int:
    """Retention in percent, pace in seconds, time in minutes, as on the desktop."""
    if source == "retentionTimeline":
        return round(day["passed"] / day["checked"] * 100) if day["checked"] else 0
    if source == "speedTimeline":
        return round(day["timeMs"] / day["ratings"] / 1000) if day["ratings"] else 0
    if source == "timeTimeline":
        return round(day["timeMs"] / 60_000)
    return int(day["newCards"])


def _short(text: str) -> str:
    return text if len(text) <= _LABEL_CHARS else f"{text[: _LABEL_CHARS - 1]}…"


def _path(name: str) -> str:
    return name.replace("::", " \u203a ")


class _Builder:
    def __init__(
        self,
        reader: CollectionReader,
        language: str,
        thumbnail: Thumbnail,
        creation: Creation | None = None,
    ) -> None:
        self.reader = reader
        self.creation = creation
        self.language = language
        self.thumbnail = thumbnail
        self.text = labels_for(language)
        self.today = AnkiCalendar(reader.day_cutoff).today
        self.media_chars = 0
        self.anki = AnkiBlocks(reader, language, self.text, self.today)

    def range_of(self, period: str) -> dict[str, Any]:
        return {
            "start": (self.today - timedelta(days=_PERIOD_DAYS[period] - 1)).isoformat(),
            "end": self.today.isoformat(),
            "deckId": None,
        }

    def tile(
        self, label: str, value: str, note: str, facts: list[dict[str, str]] | None = None
    ) -> dict[str, Any]:
        return {"kind": "tile", "label": label, "value": value, "note": note, "facts": facts or []}

    def over_periods(self, read: Callable[[dict[str, Any]], str]) -> list[dict[str, str]]:
        """The same number for other time ranges, for when someone wants to look closer."""
        return [
            {"label": self.text[name], "value": read(self.range_of(name))} for name in _TILE_PERIODS
        ]

    def bars(
        self, label: str, bars: list[dict[str, Any]], note: str, horizontal: bool = False
    ) -> dict[str, Any]:
        return {
            "kind": "bars",
            "label": label,
            "note": note,
            "horizontal": horizontal,
            "bars": bars,
            "facts": [],
        }

    def created(self, span: dict[str, Any]) -> dict[str, Any]:
        """Time spent making cards, from Statly's own measurements. Empty when there are none."""
        if self.creation is not None:
            return self.creation(span)
        return {"items": [], "total": {"seconds": 0.0, "cards": 0, "notes": 0}}

    def counted(self, data: Any, keys: Sequence[str]) -> list[dict[str, Any]]:
        return [{"label": self.text[key], "value": data[key]} for key in keys]

    def series(
        self, source: str, span: dict[str, Any], measure: str = "reviews"
    ) -> list[dict[str, Any]]:
        """The bars of a chart, for built-in statistics and custom widgets alike."""
        text, reader = self.text, self.reader
        if source in _RATING_SERIES:
            source, measure = _RATING_SERIES[source], "ratings"
        span = {**span, "measure": measure}
        if source == "timeline":
            items = metrics.timeline(span, reader)["items"]
            return [{"label": item["date"][5:], "value": item["count"]} for item in items]
        if source == "answerButtons":
            keys = ("again", "hard", "good", "easy")
            return self.counted(metrics.answer_buttons(span, reader), keys)
        if source == "forecast":
            days = metrics.forecast({"deckId": None}, reader)
            return [{"label": day["date"][5:], "value": day["cards"]} for day in days]
        if source == "cardStates":
            keys = ("new", "learning", "review", "suspended", "buried")
            return self.counted(metrics.card_states({"deckId": None}, reader), keys)
        if source == "deckActivity":
            rows = metrics.deck_activity(span, reader)[:_MAX_DECK_ROWS]
            return [
                {
                    "label": (row["name"] or text["deleted"]).split("::")[-1],
                    "value": row["count"],
                }
                for row in rows
            ]
        if source in _DAILY_SERIES:
            days = insights.daily(span, reader)["days"]
            return [{"label": day["date"][5:], "value": _daily_value(source, day)} for day in days]
        if source == "forgottenCards":
            cards = insights.forgotten({**span, "limit": _MAX_DECK_ROWS}, reader)["cards"]
            return [{"label": _short(card["text"]), "value": card["forgot"]} for card in cards]
        if source in ("weakestDecks", "newCardsFrom"):
            topics = insights.topics(span, reader)
            if source == "weakestDecks":
                return [
                    {"label": deck["name"], "value": round(deck["passed"] / deck["checked"] * 100)}
                    for deck in topics["weakest"]
                ]
            return [{"label": deck["name"], "value": deck["cards"]} for deck in topics["newFrom"]]
        if source == "deckStability":
            rows = insights.deck_table(span, reader)["rows"]
            return [
                {"label": row["name"], "value": round(row["stabilityDays"])}
                for row in rows
                if row["parentId"] is None and row["stabilityDays"] is not None
            ][:_MAX_DECK_ROWS]
        if source == "creationTimeline":
            # Minutes, as on the desktop.
            return [
                {"label": item["date"][5:], "value": round(item["seconds"] / 60)}
                for item in self.created(span)["items"]
            ]
        if source == "sessionHours":
            hours = insights.sessions(span, reader)["hours"]
            return [
                {"label": f"{hour}", "value": entry["ratings"]} for hour, entry in enumerate(hours)
            ]
        if source == "focusHours":
            # Percent, as on the desktop. An hour without answers shows no focus.
            hours = insights.sessions(span, reader)["hours"]
            return [
                {"label": f"{hour}", "value": round((entry["focus"] or 0) * 100)}
                for hour, entry in enumerate(hours)
            ]
        rhythm = metrics.rhythm(span, reader)
        if source == "weekdays":
            names = text["weekdayNames"].split(",")
            return [
                {"label": names[index], "value": value}
                for index, value in enumerate(rhythm["weekdays"])
            ]
        return [{"label": f"{hour}", "value": value} for hour, value in enumerate(rhythm["hours"])]

    def statistic(self, kind: str, period: str) -> dict[str, Any] | None:
        if kind.startswith(ANKI_PREFIX):
            return self.anki.block(kind)
        text, reader = self.text, self.reader
        span, named = self.range_of(period), text[period]
        if kind == "review-summary":

            def reviews(chosen: dict[str, Any]) -> str:
                return number(metrics.summary(chosen, reader)["reviews"], self.language)

            return self.tile(text["reviews"], reviews(span), named, self.over_periods(reviews))
        if kind == "rating-summary":

            def ratings(chosen: dict[str, Any]) -> str:
                return number(metrics.summary(chosen, reader)["ratings"], self.language)

            return self.tile(text["ratings"], ratings(span), named, self.over_periods(ratings))
        if kind == "learned-cards":

            def learned(chosen: dict[str, Any]) -> str:
                return number(metrics.categories(chosen, reader)["total"], self.language)

            return self.tile(text["learned"], learned(span), named, self.over_periods(learned))
        if kind == "study-time":

            def time(chosen: dict[str, Any]) -> str:
                return duration(metrics.summary(chosen, reader)["studyTimeMs"])

            return self.tile(text["time"], time(span), named, self.over_periods(time))
        if kind == "success-rate":

            def rate(chosen: dict[str, Any]) -> str:
                return percent(metrics.summary(chosen, reader)["successRate"])

            return self.tile(text["success"], rate(span), named, self.over_periods(rate))
        if kind == "due-cards":
            cards = metrics.due({"deckId": None}, reader)["cards"]
            return self.tile(text["due"], number(cards, self.language), text["now"])
        if kind == "review-timeline":
            return self.bars(text["timeline"], self.series("timeline", span), named)
        if kind == "rating-timeline":
            rated = self.series("timeline", span, "ratings")
            return self.bars(text["ratingTimeline"], rated, named)
        if kind == "answer-buttons":
            return self.bars(text["buttons"], self.series("answerButtons", span), named, True)
        if kind == "due-forecast":
            return self.bars(text["forecast"], self.series("forecast", span), "")
        if kind == "card-states":
            return self.bars(text["states"], self.series("cardStates", span), "", True)
        if kind == "deck-activity":
            return self.bars(text["decks"], self.series("deckActivity", span), named, True)
        if kind == "deck-ratings":
            rated = self.series("deckActivity", span, "ratings")
            return self.bars(text["deckRatings"], rated, named, True)
        if kind == "review-breakdown":
            data = metrics.categories(span, reader)
            keys = ("total", "failed", "new", "reviewed", "relearned", "longInterval")
            return self.bars(text["breakdown"], self.counted(data, keys), named, True)
        if kind == "study-rhythm":
            return self.bars(text["weekdays"], self.series("hours", span), named)
        if kind == "rating-rhythm":
            return self.bars(text["ratingHours"], self.series("hours", span, "ratings"), named)
        if kind == "creation-time":
            return self.bars(text["creation"], self.series("creationTimeline", span), named)
        if kind in _INSIGHT_BLOCKS:
            return _INSIGHT_BLOCKS[kind](self, span, named)
        if kind == "review-heatmap":
            return {"kind": "heatmap", "label": text["heatmap"], **self.heatmap()}
        if kind == "rating-heatmap":
            return {"kind": "heatmap", "label": text["ratingHeatmap"], **self.heatmap("ratings")}
        return None

    def heatmap(self, measure: str = "reviews") -> dict[str, Any]:
        data = metrics.heatmap({"year": None, "deckId": None, "measure": measure}, self.reader)
        text = self.text
        note = text["streak"].format(current=data["currentStreak"], longest=data["longestStreak"])
        facts = [
            {
                "label": text["currentStreak"],
                "value": number(data["currentStreak"], self.language),
            },
            {
                "label": text["longestStreak"],
                "value": number(data["longestStreak"], self.language),
            },
            {"label": text["daysLearned"], "value": percent(data["daysLearned"])},
            {"label": text["dailyAverage"], "value": number(data["dailyAverage"], self.language)},
        ]
        return {"note": note, "levels": heat_levels(data["today"], data["days"]), "facts": facts}

    def heat_levels(self, mode: str) -> list[int]:
        """The calendar of the last 53 weeks in one of the overview's views."""
        if mode in ("reviews", "ratings"):
            return self.heatmap(mode)["levels"]
        days = insights.daily(self.range_of("lastYear"), self.reader)["days"]
        values: list[dict[str, Any]] = []
        for day in days:
            if mode == "retention":
                value = round(day["passed"] / day["checked"] * 100) if day["checked"] else 0
            elif mode == "speed":
                # Faster is better, so a quick day must look strong.
                value = (
                    max(0, 30 - round(day["timeMs"] / day["ratings"] / 1000))
                    if day["ratings"]
                    else 0
                )
            elif mode == "time":
                value = round(day["timeMs"] / 60_000)
            else:
                value = day["newCards"]
            values.append({"date": day["date"], "count": value})
        return heat_levels(self.today.isoformat(), values)

    def table(
        self,
        label: str,
        note: str,
        columns: list[str],
        rows: list[dict[str, Any]],
        facts: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        return {
            "kind": "table",
            "label": label,
            "note": note,
            "columns": columns,
            "rows": rows[:_MAX_TABLE_ROWS],
            "facts": facts or [],
        }

    def metric(self, source: str, span: dict[str, Any]) -> tuple[float, str]:
        """A value and how it reads, the same way the desktop writes it."""
        reader = self.reader
        if source == "dueCards":
            cards = metrics.due({"deckId": None}, reader)["cards"]
            return cards, number(cards, self.language)
        if source in ("currentStreak", "longestStreak", "dailyAverage"):
            data: Any = metrics.heatmap({"year": None, "deckId": None}, reader)
            streak: float = data[source]
            return streak, number(streak, self.language)
        if source == "focus":
            focus = insights.speed(span, reader)["current"]["focus"]
            return focus or 0, percent(focus)
        if source == "matureShare":
            states: Any = metrics.card_states({"deckId": None}, reader)
            cards = sum(value for key, value in states.items() if key != "mature")
            share = states["mature"] / cards if cards else None
            return share or 0, percent(share)
        if source == "forgottenCards":
            total = insights.forgotten({**span, "limit": 1}, reader)["total"]
            return total, number(total, self.language)
        if source in _CREATION_METRICS:
            made = self.created(span)["total"]
            if source == "cardsCreated":
                return made["cards"], number(made["cards"], self.language)
            if source == "creationTime":
                return made["seconds"] * 1000, duration(made["seconds"] * 1000)
            each = made["seconds"] / made["cards"] if made["cards"] else 0
            return each, f"{each:.1f} s".replace(
                ".", "," if self.language.startswith("de") else "."
            )
        summary: Any = metrics.summary(span, reader)
        if source == "secondsPerRating":
            seconds = (
                summary["studyTimeMs"] / summary["ratings"] / 1000 if summary["ratings"] else 0
            )
            return seconds, f"{seconds:.1f} s".replace(
                ".", "," if self.language.startswith("de") else "."
            )
        if source == "studyTime":
            return summary["studyTimeMs"], duration(summary["studyTimeMs"])
        if source in ("successRate", "retention"):
            share = summary[source]
            return share or 0, percent(share)
        value = summary[source]
        return value, number(value, self.language)

    def element_value(self, element: Any, period: str) -> dict[str, Any] | None:
        kind = element["kind"]
        if kind == "heatmap":
            return {"levels": self.heat_levels(element.get("mode") or "reviews")}
        if kind not in ("metric", "chart", "progress"):
            return None
        chosen = element["range"]
        span = self.range_of(period if chosen == "dashboard" else chosen)
        if kind == "chart":
            if element["chart"] == "combined" and element.get("layers"):
                # The card leaves out layers along another axis, as the desktop does.
                return {
                    "layers": [
                        self.series(layer["source"], span) for layer in element["layers"][:6]
                    ]
                }
            return {"bars": self.series(element["source"], span)}
        value, shown = self.metric(element["source"], span)
        if kind == "metric":
            return {"text": shown}
        return {"text": shown, "share": max(0.0, min(1.0, value / element["goal"]))}

    def media_of(self, widget: Any) -> dict[str, str]:
        """Pictures shrink to fit a card, and only as many as a sync can carry along."""
        assets = [item["asset"] for item in widget["elements"] if item["kind"] == "media"]
        background = widget["background"]
        if background["kind"] == "media":
            assets.append(background["asset"])
        found: dict[str, str] = {}
        for asset in assets:
            if asset["type"].startswith("image/") and asset["id"] not in found:
                picture = self.thumbnail(asset)
                if picture and self.media_chars + len(picture) <= _MAX_MEDIA_CHARS:
                    self.media_chars += len(picture)
                    found[asset["id"]] = picture
        return found

    def custom(self, widget: Any, period: str) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for element in widget["elements"]:
            value = self.element_value(element, period)
            if value is not None:
                values[element["id"]] = value
        return {
            "kind": "custom",
            "label": widget["name"],
            "widget": widget,
            "values": values,
            "media": self.media_of(widget),
        }


# Stands in a block's text for the moment the card is written, see ``filled``.
STAND = "{stand}"
_GOAL_PREFIX = "goal:"


def build_snapshot(
    reader: CollectionReader,
    devices: Mapping[str, Sequence[Any]],
    language: str,
    custom_widgets: Mapping[str, Any],
    thumbnail: Thumbnail = lambda _asset: None,
    backgrounds: Mapping[str, str | None] | None = None,
    goal_block: Callable[[str], dict[str, Any] | None] | None = None,
    creation: Creation | None = None,
) -> dict[str, Any]:
    """Each block is worked out once, however many devices show it.

    ``goal_block`` turns a ``goal:<id>:<view>`` widget into a block, from the goals module.
    """
    builder = _Builder(reader, language, thumbnail, creation)
    blocks: dict[str, Any] = {}
    placed: dict[str, list[dict[str, Any]]] = {}
    for device, widgets in devices.items():
        placed[device] = []
        for item in widgets:
            kind, period = item["type"], item["period"]
            key = f"{kind}|{period}"
            if key not in blocks:
                block = (
                    (goal_block(kind) if goal_block else None)
                    if kind.startswith(_GOAL_PREFIX)
                    else _block(builder, kind, period, custom_widgets)
                )
                if block is None:
                    continue
                blocks[key] = block
            position = {name: item[name] for name in ("x", "y", "w", "h")}
            placed[device].append({"block": key, **position})
    return {
        "title": builder.text["title"],
        "updated": "",
        "hint": builder.text["hint"],
        "blocks": blocks,
        **placed,
        "backgrounds": {name: (backgrounds or {}).get(name) for name in ("tablet", "phone")},
        "words": {name: builder.text[name] for name in _WORDS} | {"total": builder.text["sum"]},
    }


def _block(
    builder: _Builder, kind: str, period: str, custom_widgets: Mapping[str, Any]
) -> dict[str, Any] | None:
    if kind in _DESKTOP_ONLY:
        return None
    if kind.startswith(_CUSTOM_PREFIX):
        widget = custom_widgets.get(kind.removeprefix(_CUSTOM_PREFIX))
        return None if widget is None else builder.custom(widget, period)
    return builder.statistic(kind, period)


def content_hash(snapshot: dict[str, Any]) -> str:
    """The timestamp is left out: an unchanged dashboard should cause no write and no sync."""
    content = {**snapshot, "updated": ""}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def filled(snapshot: dict[str, Any], now: datetime, language: str) -> dict[str, Any]:
    labels = labels_for(language)
    when = (
        now.strftime("%d.%m.%Y %H:%M")
        if language.startswith("de")
        else now.strftime("%Y-%m-%d %H:%M")
    )
    stand = labels["stand"].format(
        day=now.day, month=month_name(language, now.month), time=f"{now.hour}:{now.minute:02d}"
    )
    blocks = {
        key: _with_stand(block, stand) if block["kind"] == "custom" else block
        for key, block in snapshot["blocks"].items()
    }
    return {**snapshot, "blocks": blocks, "updated": labels["updated"].format(when=when)}


def _with_stand(block: dict[str, Any], stand: str) -> dict[str, Any]:
    values = {
        key: {**value, "text": stand} if value.get("text") == STAND else value
        for key, value in block["values"].items()
    }
    return {**block, "values": values}


def encode_snapshot(snapshot: dict[str, Any], now: datetime, language: str) -> str:
    """Base64, because Anki would rewrite parts of plain text in a field."""
    complete = filled(snapshot, now, language)
    return base64.b64encode(json.dumps(complete, ensure_ascii=False).encode()).decode("ascii")


# ── The closer looks on the card ─────────────────────────────────────────────────────────────

type Span = dict[str, Any]


def _seconds(builder: _Builder, milliseconds: float) -> str:
    text = f"{milliseconds / 1000:.1f}"
    return text.replace(".", ",") if builder.language.startswith("de") else text


def _overview(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, reader, language = builder.text, builder.reader, builder.language
    days = insights.daily(span, reader)["days"]
    reviews = sum(day["reviews"] for day in days)
    ratings = sum(day["ratings"] for day in days)
    time_ms = sum(day["timeMs"] for day in days)
    checked = sum(day["checked"] for day in days)
    passed = sum(day["passed"] for day in days)
    heat = builder.heatmap()
    facts = [
        {
            "label": text["due"],
            "value": number(metrics.due({"deckId": None}, reader)["cards"], language),
        },
        {"label": f"{text['reviews']} · {named}", "value": number(reviews, language)},
        {
            "label": text["pace"],
            "value": text["secondsPerCard"].format(seconds=_seconds(builder, time_ms / ratings))
            if ratings
            else "-",
        },
        {"label": text["time"], "value": duration(time_ms)},
        {"label": text["retention"], "value": percent(passed / checked if checked else None)},
        *heat["facts"],
    ]
    return {
        "kind": "heatmap",
        "label": text["overview"],
        "note": heat["note"],
        "levels": heat["levels"],
        "facts": facts,
    }


def _previous(span: Span) -> Span:
    start, end = date.fromisoformat(span["start"]), date.fromisoformat(span["end"])
    length = (end - start).days + 1
    return {
        **span,
        "start": (start - timedelta(days=length)).isoformat(),
        "end": (start - timedelta(days=1)).isoformat(),
    }


def _period_summary(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, reader, language = builder.text, builder.reader, builder.language
    now: Any = metrics.summary(span, reader)
    before: Any = metrics.summary(_previous(span), reader)
    focus = insights.speed(span, reader)["current"]["focus"]
    facts = [
        {"label": text["time"], "value": duration(now["studyTimeMs"])},
        {"label": text["retention"], "value": percent(now["retention"])},
        {"label": text["focus"], "value": percent(focus)},
        {"label": text["newCards"], "value": number(now["newCards"], language)},
        {
            "label": f"{text['before']}: {text['reviews']}",
            "value": number(before["reviews"], language),
        },
    ]
    return builder.tile(text["periodSummary"], number(now["reviews"], language), named, facts)


def _answer_mix(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, language = builder.text, builder.language
    mix = insights.answer_mix(span, builder.reader)
    block = builder.bars(
        text["answerMix"], builder.counted(mix, ("again", "hard", "good", "easy")), named, True
    )
    block["facts"] = [
        {"label": text[label], "value": number(mix[key], language)}
        for key, label in (
            ("review", "dueKind"),
            ("learning", "steps"),
            ("new", "new"),
            ("relearning", "relearning"),
        )
    ]
    return block


def _answer_speed(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, language = builder.text, builder.language
    speed = insights.speed(span, builder.reader)
    current = speed["current"]
    median = current["medianMs"]
    focus = current["focus"]
    facts = [
        {"label": text["focus"], "value": percent(focus)},
        {"label": text["slower"], "value": percent(None if focus is None else 1 - focus)},
        {"label": text["answers"], "value": number(current["answers"], language)},
    ]
    value = "-" if median is None else f"{_seconds(builder, median)} s"
    return builder.tile(text["answerSpeed"], value, named, facts)


def _sessions(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    return builder.bars(builder.text["sessions"], builder.series("sessionHours", span), named)


def _deck_table(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, language = builder.text, builder.language
    table = insights.deck_table(span, builder.reader)
    rows: list[dict[str, Any]] = []
    for row in table["rows"]:
        if row["parentId"] is not None:
            continue
        stability = row["stability"]
        change = None if stability is None else round((stability - 1) * 100)
        rows.append(
            {
                "label": row["name"],
                "sub": _path(row["path"]),
                "cells": [
                    "-" if change is None else f"{change:+d} %",
                    number(row["count"], language),
                    duration(row["timeMs"]),
                    percent(row["matureShare"]),
                ],
                "tone": None
                if change is None or abs(change) < 15
                else ("good" if change > 0 else "bad"),
            }
        )
    columns = [text["stability"], text["count"], text["time"], text["mature"]]
    return builder.table(text["deckTable"], named, columns, rows)


def _forgotten(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text = builder.text
    result = insights.forgotten({**span, "limit": _MAX_TABLE_ROWS}, builder.reader)
    rows = [
        {
            "label": _short(card["text"]),
            "sub": _path(card["deck"]),
            "cells": [
                text["ofSeen"].format(forgot=card["forgot"], seen=card["seen"]),
                "-"
                if card["intervalDays"] is None
                else text["days"].format(count=card["intervalDays"]),
            ],
            "tone": "bad",
        }
        for card in result["cards"]
    ]
    return builder.table(text["forgotten"], named, [text["forgot"], text["interval"]], rows)


def _weakest(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    text, language = builder.text, builder.language
    topics = insights.topics(span, builder.reader)
    overall = topics["retention"]
    rows = [
        {
            "label": deck["name"],
            "sub": " · ".join(
                part
                for part in (
                    _path(deck["path"]),
                    text["reviewAnswers"].format(count=number(deck["checked"], language)),
                )
                if part
            ),
            "cells": [percent(deck["passed"] / deck["checked"])],
            "tone": "bad"
            if overall is not None and deck["passed"] / deck["checked"] < overall
            else None,
        }
        for deck in topics["weakest"]
    ]
    note = text["overall"].format(share=percent(overall)) if overall is not None else named
    return builder.table(text["weakest"], note, [text["retention"]], rows)


def _new_from(builder: _Builder, span: Span, named: str) -> dict[str, Any]:
    return builder.bars(builder.text["newFrom"], builder.series("newCardsFrom", span), named, True)


_INSIGHT_BLOCKS: dict[str, Callable[[_Builder, Span, str], dict[str, Any]]] = {
    "study-overview": _overview,
    "period-summary": _period_summary,
    "answer-mix": _answer_mix,
    "answer-speed": _answer_speed,
    "study-sessions": _sessions,
    "deck-table": _deck_table,
    "forgotten-cards": _forgotten,
    "weakest-decks": _weakest,
    "new-cards-from": _new_from,
}
