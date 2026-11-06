"""A goal on the phone card: the day's progress and streak as the desktop saw them last.

The card is written before a sync and read on the phone later, so it is no live count: it says
when it was made ("As of 7:12"). It is built from the card's own elements, a ring or bar and lines
of text, so the phone needs nothing new to show it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# Readable on the card's light and dark backgrounds, in the order of ``TONE_COLORS`` in the app.
_TONES = {"done": "#2f9e5b", "progress": "#c88a00", "behind": "#d64545", "rest": "#8a94a6"}
# Any metric source will do: the card draws the values Statly fills in, not the source.
_SOURCE = {"source": "reviews", "range": "today"}

_LABELS = {
    "en": {
        "left": "{count} to go",
        "done": "Done for today",
        "rest": "Day off",
        "finished": "Every card is learned",
        "over": "The exam is over",
        "noDecks": "The decks are gone",
        "streak_one": "🔥 {count} day in a row",
        "streak_other": "🔥 {count} days in a row",
        "tomorrow": "Tomorrow about {count}",
    },
    "de": {
        "left": "Noch {count}",
        "done": "Für heute geschafft",
        "rest": "Heute frei",
        "finished": "Alle Karten sind gelernt",
        "over": "Die Klausur ist vorbei",
        "noDecks": "Die Decks gibt es nicht mehr",
        "streak_one": "🔥 {count} Tag am Stück",
        "streak_other": "🔥 {count} Tage am Stück",
        "tomorrow": "Morgen etwa {count}",
    },
}


def _labels(language: str) -> dict[str, str]:
    return _LABELS["de" if language.lower().startswith("de") else "en"]


def _text(
    element_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    size: float,
    bold: bool,
    color: str,
    align: str = "left",
) -> dict[str, Any]:
    return {
        "id": element_id,
        "kind": "metric",
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "opacity": 1,
        "size": size,
        "bold": bold,
        "align": align,
        "color": color,
        **_SOURCE,
    }


def _progress(style: str, x: float, y: float, w: float, h: float, color: str) -> dict[str, Any]:
    return {
        "id": "progress",
        "kind": "progress",
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "opacity": 1,
        "style": style,
        "goal": 1,
        "color": color,
        **_SOURCE,
    }


def _elements(view: str, color: str) -> list[dict[str, Any]]:
    if view == "timeline":
        return [
            _text("done", 4, 6, 44, 28, 22, True, "text"),
            _text("line", 50, 10, 46, 20, 11, True, color, "right"),
            _progress("bar", 4, 40, 92, 12, color),
            _text("streak", 4, 60, 46, 16, 9, False, "text"),
            _text("tomorrow", 50, 60, 46, 16, 9, False, "muted", "right"),
            _text("stand", 4, 80, 92, 14, 8, False, "muted"),
        ]
    return [
        _progress("ring", 4, 8, 44, 84, color),
        _text("line", 52, 14, 44, 18, 9, True, color),
        _text("streak", 52, 36, 44, 16, 7.5, False, "text"),
        _text("tomorrow", 52, 56, 44, 14, 7, False, "muted"),
        _text("stand", 52, 74, 44, 12, 6, False, "muted"),
    ]


def phone_block(
    goal: Mapping[str, Any],
    status: Mapping[str, Any],
    view: str,
    size: Mapping[str, int],
    language: str,
    stand: str,
) -> dict[str, Any]:
    """The card's block for one goal. ``stand`` is filled in with the time when the card is
    written, so an unchanged goal leaves the card unchanged and causes no extra sync."""
    text = _labels(language)
    state, tone = status["state"], status["tone"]
    target, done = status["target"], status["done"]
    if state in ("over", "noDecks"):
        line = text[state]
    elif state == "finished" and target == 0:
        line = text["finished"]
    elif tone == "rest":
        line = text["rest"]
    elif done >= target:
        line = text["done"]
    else:
        line = text["left"].format(count=target - done)
    streak = int(status["streak"]["current"])
    color = _TONES.get(tone, _TONES["rest"])
    shown = f"{done} / {target}" if target > 0 else "\u2013"
    values: dict[str, Any] = {
        "progress": {"text": shown, "share": min(1.0, done / target) if target else 0.0},
        "done": {"text": shown},
        "line": {"text": line},
        "streak": {
            "text": text["streak_one" if streak == 1 else "streak_other"].format(count=streak)
            if streak > 0
            else ""
        },
        "tomorrow": {
            "text": text["tomorrow"].format(count=status["tomorrow"]["ifMet"])
            if state in ("active", "buffer")
            else ""
        },
        "stand": {"text": stand},
    }
    elements = _elements(view, color)
    used = {element["id"] for element in elements}
    return {
        "kind": "custom",
        "label": goal["name"],
        "widget": {
            "id": f"goal-{goal['id']}",
            "name": goal["name"][:80] or "Goal",
            "description": "",
            "size": {"w": size["w"], "h": size["h"]},
            "background": {"kind": "card"},
            "elements": elements,
        },
        "values": {key: value for key, value in values.items() if key in used},
        "media": {},
    }
