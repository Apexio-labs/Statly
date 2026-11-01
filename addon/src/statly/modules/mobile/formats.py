"""How numbers read on the card, which cannot use the web app's formatting."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

_LEVELS = 4


def number(value: float, language: str) -> str:
    text = f"{round(value):,}"
    return text.replace(",", ".") if language.startswith("de") else text


def duration(milliseconds: int) -> str:
    minutes = round(milliseconds / 60_000)
    hours, rest = divmod(minutes, 60)
    return f"{hours} h {rest} min" if hours else f"{minutes} min"


def percent(share: float | None) -> str:
    return "-" if share is None else f"{round(share * 100)} %"


def heat_levels(today_text: str, days: list[Any]) -> list[int]:
    """One level per day of the last 53 weeks, ending with the current week."""
    today = date.fromisoformat(today_text)
    start = today - timedelta(days=today.weekday() + 52 * 7)
    reviews = {day["date"]: day["reviews"] for day in days}
    highest = max(reviews.values(), default=0)
    levels: list[int] = []
    for offset in range((today - start).days + 1):
        value = reviews.get((start + timedelta(days=offset)).isoformat(), 0)
        levels.append(0 if value == 0 else min(_LEVELS, (value * _LEVELS + highest - 1) // highest))
    return levels
