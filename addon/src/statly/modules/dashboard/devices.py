"""Turns the desktop dashboard into layouts for tablets and phones.

Every device uses the same cell size, so only the number of columns changes. Widgets keep their
reading order and height and take a width that suits the smaller screen.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

_DESKTOP_COLUMNS = 12
_FULL_WIDTH_FROM = {4: 5, 8: 10}
_TILES = {"review-summary", "study-time", "success-rate", "due-cards"}
_CUSTOM_PERIOD = "last7"
DEVICE_MIN_HEIGHT = 3
_TILE_HEIGHT = 3
_CHART_HEIGHT = 6
# What the content needs. Desktop heights would leave large empty cards on a small screen.
_HEIGHTS = {
    "answer-buttons": 4,
    "card-states": 5,
    "review-breakdown": 5,
    "deck-activity": 6,
    "review-heatmap": {4: 3, 8: 5},
    "anki-today": 5,
    "anki-calendar": {4: 3, 8: 5},
    "anki-card-counts": 5,
    "anki-buttons": 4,
    "anki-true-retention": 5,
}

type RulesOf = Callable[[str], dict[str, int] | None]
type Widget = dict[str, Any]


def default_period(kind: str) -> str:
    if kind in _TILES:
        return "today"
    return _CUSTOM_PERIOD if kind.startswith("custom:") else "last30"


def _height_on(widget: Widget, columns: int) -> int:
    kind = widget["type"]
    if kind.startswith("custom:"):
        return widget["h"]
    if kind in _TILES:
        return _TILE_HEIGHT
    height = _HEIGHTS.get(kind, _CHART_HEIGHT)
    return height if isinstance(height, int) else height[columns]


def _bounds(rules: dict[str, int], columns: int) -> tuple[int, int]:
    return min(rules["minW"], columns), min(rules["maxW"], columns)


def _width_on(widget: Widget, rules: dict[str, int], columns: int) -> int:
    smallest, largest = _bounds(rules, columns)
    if widget["w"] >= _FULL_WIDTH_FROM.get(columns, _DESKTOP_COLUMNS):
        wanted = columns
    else:
        # Even widths line up, so two tiles always fill a row together.
        wanted = max(2, round(widget["w"] * columns / _DESKTOP_COLUMNS / 2) * 2)
    return max(smallest, min(largest, wanted))


def _close_shelf(shelf: list[Widget], top: int, columns: int, rules_of: RulesOf) -> int:
    """Widgets in a row share its height and fill it, so no holes stay behind."""
    height = max(widget["h"] for widget in shelf)
    spare = columns - sum(widget["w"] for widget in shelf)
    left = 0
    for widget in shelf:
        rules = rules_of(widget["type"]) or {}
        room = max(0, min(rules.get("maxW", columns), columns) - widget["w"])
        grown = min(spare, room)
        spare -= grown
        widget.update(
            x=left,
            y=top,
            w=widget["w"] + grown,
            h=min(height, max(widget["h"], rules.get("maxH", widget["h"]))),
        )
        left += widget["w"]
    return top + height


def arrange(
    widgets: Sequence[Widget], columns: int, rules_of: RulesOf, top: int = 0
) -> list[Widget]:
    """Lay widgets out row by row in their reading order, starting at row ``top``."""
    arranged: list[Widget] = []
    shelf: list[Widget] = []
    used = 0
    for widget in sorted(widgets, key=lambda item: (item["y"], item["x"])):
        rules = rules_of(widget["type"])
        if rules is None:
            continue
        width = _width_on(widget, rules, columns)
        if used + width > columns:
            top = _close_shelf(shelf, top, columns, rules_of)
            shelf, used = [], 0
        placed = {
            "id": widget["id"],
            "type": widget["type"],
            "x": 0,
            "y": top,
            "w": width,
            "h": _height_on(widget, columns),
            "period": widget.get("period") or default_period(widget["type"]),
        }
        shelf.append(placed)
        arranged.append(placed)
        used += width
    if shelf:
        _close_shelf(shelf, top, columns, rules_of)
    return arranged


def _bottom(widgets: Sequence[Widget]) -> int:
    return max((widget["y"] + widget["h"] for widget in widgets), default=0)


def follow_desktop(
    desktop: Sequence[Widget], stored: dict[str, Any], columns: int, rules_of: RulesOf
) -> list[Widget]:
    """Bring an arranged layout up to date without touching what the user arranged.

    A widget new on the desktop joins at the bottom, and one deleted there leaves. A widget the
    user removed from this device stays away, and one added only here stays.
    """
    current = {widget["id"] for widget in desktop}
    known = set(stored["known"])
    kept = [
        widget
        for widget in stored["widgets"]
        if (widget["id"] in current or widget["id"] not in known)
        and rules_of(widget["type"]) is not None
    ]
    new = [widget for widget in desktop if widget["id"] not in known]
    return kept + arrange(new, columns, rules_of, _bottom(kept))


def resolve(
    desktop: Sequence[Widget],
    stored: dict[str, Any] | None,
    columns: int,
    rules_of: RulesOf,
) -> dict[str, Any]:
    if stored is None:
        return {"widgets": arrange(desktop, columns, rules_of), "automatic": True}
    return {"widgets": follow_desktop(desktop, stored, columns, rules_of), "automatic": False}
