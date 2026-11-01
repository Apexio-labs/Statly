"""Moves data from Statly's first version into the current format, once."""

from __future__ import annotations

from typing import Any, cast

from .contract import Contract
from .storage import JsonStore

_THEMES = {"frutiger_aero": "frutiger-aero"}
_SHORTCUTS = {
    "dashboard": "dashboard",
    "settings": "settings",
    "library": "library",
    "anki_statistics": "ankiStatistics",
}


def is_prototype_settings(stored: Any) -> bool:
    return isinstance(stored, dict) and "schema_version" in stored


def convert_settings(old: dict[str, Any]) -> dict[str, Any]:
    """Map what is recognized and leave everything else to the defaults."""
    theme = old.get("theme", "system")
    source = "aero" if old.get("wallpaper_preset") == "aero" else None
    if source is None:
        source = "image" if old.get("wallpaper_file") else "none"
    shortcuts = old.get("shortcuts")
    converted: dict[str, Any] = {
        "theme": _THEMES.get(theme, theme),
        "language": old.get("language", "auto"),
        "counterColorsEnabled": old.get("counter_colors_enabled", False),
        "wallpaper": {
            "enabled": old.get("wallpaper_enabled", False),
            "source": source,
            "blur": old.get("wallpaper_blur", 0),
            "overlay": old.get("wallpaper_overlay", 0),
            "position": old.get("wallpaper_position", "center"),
            "textColor": old.get("wallpaper_text_color", "dark"),
        },
        "deckHeatmap": old.get("show_heatmap_on_deck_overview", False),
        "brandAnimation": old.get("animate_brand_on_deck_overview", True),
        "onboardingDone": old.get("onboarding_completed", False),
    }
    answers = old.get("onboarding_answers")
    if isinstance(answers, dict):
        converted["onboardingAnswers"] = {
            "role": answers.get("user_category"),
            "discovery": answers.get("discovery_source"),
        }
    if "counter_colors" in old:
        converted["counterColors"] = old["counter_colors"]
    if isinstance(shortcuts, dict):
        converted["shortcuts"] = {
            new: shortcuts.get(previous, "") for previous, new in _SHORTCUTS.items()
        }
    return converted


def convert_layout(old: dict[str, Any], grid: dict[str, Any]) -> dict[str, Any] | None:
    """Keep built-in widgets, fitted to today's size rules.

    Custom widgets are skipped here. Their definitions stay untouched in the ``widgets`` folder.
    """
    layout: Any = old.get("dashboard_layout")
    entries = cast(Any, layout.get("widgets") if isinstance(layout, dict) else None)
    if not isinstance(entries, list):
        return None
    entries = cast(list[dict[str, Any]], entries)
    converted: list[dict[str, Any]] = []
    for widget in entries:
        rules = grid["widgets"].get(widget.get("type"))
        if rules is None:
            continue
        w = max(rules["minW"], min(rules["maxW"], widget["w"]))
        h = max(rules["minH"], min(rules["maxH"], widget["h"]))
        x = max(0, min(grid["columns"] - w, widget["x"]))
        converted.append({**widget, "x": x, "w": w, "h": h})
    return {"widgets": converted}


def migrate(old: dict[str, Any], store: JsonStore, contract: Contract) -> dict[str, Any]:
    """Write the new files. The original stays next to them as a backup."""
    store.write("settings.prototype", old)
    layout = convert_layout(old, contract.grid)
    if layout is not None:
        store.write("dashboard", layout)
    settings = convert_settings(old)
    store.write("settings", settings)
    return settings
