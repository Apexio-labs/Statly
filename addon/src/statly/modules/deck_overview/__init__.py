"""What Statly adds to Anki's deck overview. All of it is optional."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from ...core.module import Context, Host
from ...core.reader import CollectionReader
from ...core.settings import SettingsService
from ..statistics import metrics
from ..statistics.calendar import AnkiCalendar
from ..wallpaper import image_data_url
from .heatmap_html import render_heatmap_markup
from .styles import counter_styles, wallpaper_styles

_HEATMAP_ELEMENT = "statly-deck-heatmap"
_RELEVANT_SETTINGS = {
    "counterColors",
    "counterColorsEnabled",
    "deckHeatmap",
    "language",
    "wallpaper",
}
_GERMAN = "de"


def heatmap_grid(year: int, days: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Every day of the year's weeks, Monday first, including days without reviews."""
    reviews = {day["date"]: day["reviews"] for day in days}
    first = date(year, 1, 1)
    last = date(year, 12, 31)
    current = first - timedelta(days=first.weekday())
    end = last + timedelta(days=6 - last.weekday())
    grid: list[dict[str, Any]] = []
    while current <= end:
        iso = current.isoformat()
        grid.append({"date": iso, "value": reviews.get(iso, 0)})
        current += timedelta(days=1)
    return grid


def heatmap_payload(reader: CollectionReader) -> dict[str, Any]:
    today = AnkiCalendar(reader.day_cutoff).today.isoformat()
    heatmap = metrics.heatmap({"year": None, "deckId": None}, reader)
    today_summary = metrics.summary({"start": today, "end": today, "deckId": None}, reader)
    return {
        "year": heatmap["year"],
        "days": heatmap_grid(heatmap["year"], heatmap["days"]),
        "totalReviews": heatmap["totalReviews"],
        "dailyAverage": heatmap["dailyAverage"],
        "daysLearned": round(heatmap["daysLearned"] * 100),
        "longestStreak": heatmap["longestStreak"],
        "currentStreak": heatmap["currentStreak"],
        "todayReviews": today_summary["reviews"],
        "todayTimeMs": today_summary["studyTimeMs"],
    }


class DeckOverview:
    def __init__(self, context: Context) -> None:
        self._host: Host = context.host
        self._settings: SettingsService = context.settings
        self._router = context.router
        self._heatmap_css = (Path(__file__).parent / "heatmap.css").read_text(encoding="utf-8")
        self._heatmap_html = ""

    def html(self) -> str:
        """Called on every render of the deck overview, so it must never query the collection.

        It shows the last known heatmap at once and replaces it when the fresh one is ready.
        """
        settings = self._settings.get()
        image = None
        wallpaper = settings["wallpaper"]
        if wallpaper["enabled"] and wallpaper["source"] == "image":
            image = image_data_url(self._host)
        styles = counter_styles(settings) + wallpaper_styles(settings, image)
        parts = [f"<style>{styles}</style>"] if styles else []
        if settings["deckHeatmap"]:
            parts.append(f"<style>{self._heatmap_css}</style>")
            parts.append(f'<div id="{_HEATMAP_ELEMENT}">{self._heatmap_html}</div>')
            self._refresh_heatmap()
        return "".join(parts)

    def _language(self) -> str:
        chosen = self._settings.get()["language"]
        language = self._host.info()["language"] if chosen == "auto" else chosen
        return _GERMAN if language.lower().startswith(_GERMAN) else "en"

    def _refresh_heatmap(self) -> None:
        def finished(payload: dict[str, Any]) -> None:
            markup = render_heatmap_markup(payload, self._language())
            if markup != self._heatmap_html:
                self._heatmap_html = markup
                self._host.update_deck_browser_element(_HEATMAP_ELEMENT, markup)

        self._router.run_background(heatmap_payload, finished)

    def settings_changed(self, changed: set[str]) -> None:
        if changed & _RELEVANT_SETTINGS:
            self._host.refresh_deck_browser()


class DeckOverviewModule:
    def register(self, context: Context) -> None:
        overview = DeckOverview(context)
        context.host.add_deck_browser_html(overview.html)
        context.settings.subscribe(overview.settings_changed)
