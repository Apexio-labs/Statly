"""The note in Anki's reviewer when a day's goal is met. Only English and German so far."""

from __future__ import annotations

_LABELS = {
    "en": {
        "reached": "Statly: day's goal met: {name} 🎉",
        "streak": "🔥 {count} days in a row",
    },
    "de": {
        "reached": "Statly: Tagesziel geschafft: {name} 🎉",
        "streak": "🔥 {count} Tage am Stück",
    },
}


def reached_note(language: str, name: str, streak: int) -> str:
    labels = _LABELS.get(language.split("-")[0].split("_")[0], _LABELS["en"])
    lines = [labels["reached"].format(name=name)]
    # One day is no streak yet, so the line starts at two.
    if streak > 1:
        lines.append(labels["streak"].format(count=streak))
    return "\n".join(lines)
