"""Anki's statistics on the card, from the same data as the desktop widgets."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any

from ...core.reader import CollectionReader
from ..statistics import anki_stats
from .formats import duration, heat_levels, number, percent

PREFIX = "anki-"
_RANGES = {"intervals": "most", "stability": "most", "difficulty": "all", "retrievability": "all"}
_SEPARATE_INACTIVE = {"card-counts"}
_MS_PER_MINUTE = 60_000
_BUTTONS = ("again", "hard", "good", "easy")

type Block = dict[str, Any]


class AnkiBlocks:
    """Anki works out its whole page in one go, so all blocks of a card share one call."""

    def __init__(
        self, reader: CollectionReader, language: str, text: dict[str, str], today: date
    ) -> None:
        self._reader = reader
        self._language = language
        self._text = text
        self._today = today
        self._graphs: Any = None

    def _view(self, name: str) -> Any:
        if self._graphs is None:
            self._graphs = anki_stats.load({"deckId": None}, self._reader)
        params = {
            "view": name,
            "deckId": None,
            "range": _RANGES.get(name, "month"),
            "option": name in _SEPARATE_INACTIVE,
        }
        return anki_stats.view(params, self._graphs, self._reader)

    def _number(self, value: float) -> str:
        return number(value, self._language)

    def _fact(self, fact: Any) -> dict[str, str]:
        unit, value = fact["unit"], fact["value"]
        if unit == "minutes":
            shown = duration(round(value * _MS_PER_MINUTE))
        elif unit == "percent":
            shown = percent(value / 100)
        elif "of" in fact:
            shown = f"{self._number(value)} / {self._number(fact['of'])}"
        elif unit == "seconds":
            shown = f"{value:.1f} s"
        elif unit == "cardsPerMinute":
            shown = f"{value:.1f}"
        else:
            shown = self._number(value)
        return {"label": self._text[f"anki.{fact['name']}"], "value": shown}

    def _bars(
        self, label: str, bars: list[Block], facts: list[dict[str, str]], wide: bool = False
    ) -> Block:
        return {
            "kind": "bars",
            "label": label,
            "note": "",
            "horizontal": wide,
            "bars": bars,
            "facts": facts,
        }

    def _timeline(self, label: str, data: Any) -> Block:
        bars = [
            {"label": point["start"][5:], "value": round(sum(point["values"]))}
            for point in data["points"]
        ]
        return self._bars(label, bars, [self._fact(fact) for fact in data["facts"]])

    def _histogram(self, label: str, data: Any) -> Block:
        if not data["available"]:
            return self._tile(label, "-", self._text["anki.needsFsrs"], [])
        bars = [{"label": str(point["start"]), "value": point["value"]} for point in data["points"]]
        return self._bars(label, bars, [self._fact(fact) for fact in data["facts"]])

    def _tile(self, label: str, value: str, note: str, facts: list[dict[str, str]]) -> Block:
        return {"kind": "tile", "label": label, "value": value, "note": note, "facts": facts}

    def _today_block(self, label: str, data: Any) -> Block:
        text = self._text
        answers, correct = data["answers"], data["correct"]
        rows = (
            ("time", duration(data["millis"])),
            ("again", self._number(answers - correct)),
            ("success", percent(correct / answers if answers else None)),
            ("anki.learn", self._number(data["learn"])),
            ("review", self._number(data["review"])),
            ("anki.relearn", self._number(data["relearn"])),
            ("anki.filtered", self._number(data["filtered"])),
        )
        facts = [{"label": text[key], "value": value} for key, value in rows]
        return self._tile(label, self._number(answers), text["reviews"], facts)

    def _retention(self, label: str, data: Any) -> Block:
        text = self._text

        def rate(row: Any) -> str:
            passed = row["youngPassed"] + row["maturePassed"]
            failed = row["youngFailed"] + row["matureFailed"]
            return percent(passed / (passed + failed) if passed + failed else None)

        rows = {row["name"]: row for row in data["rows"]}
        facts = [{"label": text[f"anki.{key}"], "value": rate(row)} for key, row in rows.items()]
        return self._tile(label, rate(rows["month"]), text["anki.month"], facts)

    def _hours(self, label: str, data: Any) -> Block:
        bars = [{"label": str(point["hour"]), "value": point["total"]} for point in data["points"]]
        return self._bars(label, bars, [])

    def _buttons(self, label: str, data: Any) -> Block:
        text = self._text
        bars = [
            {
                "label": text[name],
                "value": sum(group["counts"][index] for group in data["groups"]),
            }
            for index, name in enumerate(_BUTTONS)
        ]
        facts = [
            {
                "label": text[f"anki.{group['name']}"],
                "value": percent(group["correct"] / group["total"] if group["total"] else None),
            }
            for group in data["groups"]
        ]
        return self._bars(label, bars, facts, True)

    def _counts(self, label: str, data: Any) -> Block:
        bars = [
            {"label": self._text[f"anki.{item['name']}"], "value": item["value"]}
            for item in data["items"]
            if item["value"]
        ]
        return self._bars(label, bars, [], True)

    def _calendar(self, label: str, data: Any) -> Block:
        text = self._text
        days = data["days"]
        facts = [
            {"label": text["reviews"], "value": self._number(sum(d["reviews"] for d in days))},
            {"label": text["anki.daysStudied"], "value": self._number(len(days))},
        ]
        levels = heat_levels(self._today.isoformat(), days)
        return {"kind": "heatmap", "label": label, "note": "", "levels": levels, "facts": facts}

    def block(self, kind: str) -> Block:
        name = kind.removeprefix(PREFIX)
        data = self._view(name)
        label = self._text[f"anki.title.{name}"]
        draw: dict[str, Callable[[str, Any], Block]] = {
            "today": self._today_block,
            "timeline": self._timeline,
            "histogram": self._histogram,
            "hours": self._hours,
            "buttons": self._buttons,
            "counts": self._counts,
            "calendar": self._calendar,
            "retention": self._retention,
        }
        return draw[data["kind"]](label, data)
