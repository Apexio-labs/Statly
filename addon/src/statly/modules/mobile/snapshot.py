"""Turns the dashboard into the data the card draws."""

from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any

from ...core.reader import CollectionReader
from ..statistics import metrics
from ..statistics.calendar import AnkiCalendar
from .anki_blocks import PREFIX as ANKI_PREFIX
from .anki_blocks import AnkiBlocks
from .formats import duration, heat_levels, number, percent
from .labels import labels_for

_MAX_DECK_ROWS = 8
_PERIOD_DAYS = {"today": 1, "last7": 7, "last30": 30, "lastYear": 365}
_CUSTOM_PREFIX = "custom:"
_MAX_MEDIA_CHARS = 300_000

type Thumbnail = Callable[[dict[str, str]], str | None]

_WORDS = ("back", "average", "best", "share", "comparedTo", "videoHere")
_TILE_PERIODS = ("today", "last7", "last30")


class _Builder:
    def __init__(self, reader: CollectionReader, language: str, thumbnail: Thumbnail) -> None:
        self.reader = reader
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

    def counted(self, data: Any, keys: Sequence[str]) -> list[dict[str, Any]]:
        return [{"label": self.text[key], "value": data[key]} for key in keys]

    def series(self, source: str, span: dict[str, Any]) -> list[dict[str, Any]]:
        """The bars of a chart, for built-in statistics and custom widgets alike."""
        text, reader = self.text, self.reader
        if source == "timeline":
            items = metrics.timeline(span, reader)["items"]
            return [{"label": item["date"][5:], "value": item["reviews"]} for item in items]
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
                    "value": row["reviews"],
                }
                for row in rows
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
        if kind == "answer-buttons":
            return self.bars(text["buttons"], self.series("answerButtons", span), named, True)
        if kind == "due-forecast":
            return self.bars(text["forecast"], self.series("forecast", span), "")
        if kind == "card-states":
            return self.bars(text["states"], self.series("cardStates", span), "", True)
        if kind == "deck-activity":
            return self.bars(text["decks"], self.series("deckActivity", span), named, True)
        if kind == "review-breakdown":
            data = metrics.categories(span, reader)
            keys = ("total", "failed", "new", "reviewed", "relearned", "longInterval")
            return self.bars(text["breakdown"], self.counted(data, keys), named, True)
        if kind == "study-rhythm":
            return self.bars(text["weekdays"], self.series("hours", span), named)
        if kind == "review-heatmap":
            return {
                "kind": "heatmap",
                "label": text["heatmap"],
                **self.heatmap(),
            }
        return None

    def heatmap(self) -> dict[str, Any]:
        data = metrics.heatmap({"year": None, "deckId": None}, self.reader)
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
        summary: Any = metrics.summary(span, reader)
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
            return {"levels": self.heatmap()["levels"]}
        if kind not in ("metric", "chart", "progress"):
            return None
        chosen = element["range"]
        span = self.range_of(period if chosen == "dashboard" else chosen)
        if kind == "chart":
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


def build_snapshot(
    reader: CollectionReader,
    devices: Mapping[str, Sequence[Any]],
    language: str,
    custom_widgets: Mapping[str, Any],
    thumbnail: Thumbnail = lambda _asset: None,
    backgrounds: Mapping[str, str | None] | None = None,
) -> dict[str, Any]:
    """Each block is worked out once, however many devices show it."""
    builder = _Builder(reader, language, thumbnail)
    blocks: dict[str, Any] = {}
    placed: dict[str, list[dict[str, Any]]] = {}
    for device, widgets in devices.items():
        placed[device] = []
        for item in widgets:
            kind, period = item["type"], item["period"]
            key = f"{kind}|{period}"
            if key not in blocks:
                block = _block(builder, kind, period, custom_widgets)
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
    if kind.startswith(_CUSTOM_PREFIX):
        widget = custom_widgets.get(kind.removeprefix(_CUSTOM_PREFIX))
        return None if widget is None else builder.custom(widget, period)
    return builder.statistic(kind, period)


def content_hash(snapshot: dict[str, Any]) -> str:
    """The timestamp is left out: an unchanged dashboard should cause no write and no sync."""
    content = {**snapshot, "updated": ""}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def filled(snapshot: dict[str, Any], now: datetime, language: str) -> dict[str, Any]:
    when = (
        now.strftime("%d.%m.%Y %H:%M")
        if language.startswith("de")
        else now.strftime("%Y-%m-%d %H:%M")
    )
    return {**snapshot, "updated": labels_for(language)["updated"].format(when=when)}


def encode_snapshot(snapshot: dict[str, Any], now: datetime, language: str) -> str:
    """Base64, because Anki would rewrite parts of plain text in a field."""
    complete = filled(snapshot, now, language)
    return base64.b64encode(json.dumps(complete, ensure_ascii=False).encode()).decode("ascii")
