"""Words for the few questions ``host/`` asks itself. Everything else gets its text from modules."""

from __future__ import annotations

_TEXT = {
    "en": {
        "cancel": "Cancel",
        "close": "Close",
        "closeTitle": "Close Statly?",
        "uninstallTitle": "Uninstall Statly?",
        "uninstallBody": (
            "Anki moves Statly's files to the trash. Your collection is not changed. "
            "Please restart Anki afterwards."
        ),
        "uninstall": "Uninstall",
        "removed": "Statly was removed. Please restart Anki.",
    },
    "de": {
        "cancel": "Abbrechen",
        "close": "Schließen",
        "closeTitle": "Statly schließen?",
        "uninstallTitle": "Statly deinstallieren?",
        "uninstallBody": (
            "Anki legt Statlys Dateien in den Papierkorb. Deine Sammlung bleibt, wie sie ist. "
            "Starte Anki danach bitte neu."
        ),
        "uninstall": "Deinstallieren",
        "removed": "Statly wurde entfernt. Starte Anki bitte neu.",
    },
}


def host_labels(language: str) -> dict[str, str]:
    return _TEXT["de" if language.lower().startswith("de") else "en"]
