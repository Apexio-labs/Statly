"""The words of Statly's permission dialogs. Python writes them, so no page can change them."""

from __future__ import annotations

from typing import Any

_REVOKE = {
    "en": "You can take this back at any time under Settings → Privacy & Security.",
    "de": "Du kannst das jederzeit unter Einstellungen → Datenschutz & Sicherheit widerrufen.",
}

_TEXT: dict[str, dict[str, Any]] = {
    "en": {
        "deny": "Don't Allow",
        "once": "Only This Time",
        "always": "Always Allow",
        "allow": "Allow",
        "permissions": {
            "ai.decks": (
                "Allow the assistant to read your deck names?",
                "The assistant then sees the names of your decks, for example to ask about one. "
                "It cannot change them.",
            ),
            "ai.cards": (
                "Allow the assistant to read your cards?",
                "The assistant then sees the text, tags and history of the cards it looks for. "
                "Card text can contain instructions, so nothing is applied on its own after "
                "that. The assistant can never change cards.",
            ),
            "ai.external": (
                "Allow external AI apps the same access?",
                "Apps you connected through Statly's local access may then read deck names and "
                "cards too, as far as you allowed the assistant.",
            ),
            "mobile.card": (
                "Allow Statly to write the phone card into your collection?",
                "Statly creates a deck of its own with one card and keeps it up to date. A backup "
                "is made first. Statly only ever changes this card, its deck and its note type.",
            ),
            "goals.sync": (
                "Allow your goals to sync through AnkiWeb?",
                "Statly keeps your goals as a small entry in your collection's settings, and the "
                "normal sync brings them to your other computers. Your cards stay untouched.",
            ),
            "anki.deckLimits": (
                "Allow Statly to change the limit for new cards?",
                "Statly only raises the limit for today. You can undo it in Statly or with "
                "Anki's Edit → Undo. With Always Allow, Statly shows each change with an undo "
                "button.",
            ),
        },
    },
    "de": {
        "deny": "Nicht erlauben",
        "once": "Nur dieses Mal",
        "always": "Immer erlauben",
        "allow": "Erlauben",
        "permissions": {
            "ai.decks": (
                "Darf die KI deine Decknamen lesen?",
                "Die KI sieht dann die Namen deiner Decks, etwa um nach einem Deck zu fragen. "
                "Ändern kann sie sie nicht.",
            ),
            "ai.cards": (
                "Darf die KI deine Karten lesen?",
                "Die KI sieht dann Text, Tags und Verlauf der Karten, nach denen sie sucht. "
                "Kartentext kann Anweisungen enthalten, deshalb setzt Statly danach nichts mehr "
                "von allein um. Karten ändern kann die KI nie.",
            ),
            "ai.external": (
                "Dürfen externe KI-Apps dieselben Rechte nutzen?",
                "Apps, die du über Statlys lokalen Zugang verbunden hast, dürfen dann ebenfalls "
                "Decknamen und Karten lesen, soweit du das der KI erlaubt hast.",
            ),
            "mobile.card": (
                "Darf Statly die Handy-Karte in deine Sammlung schreiben?",
                "Statly legt ein eigenes Deck mit einer Karte an und hält sie aktuell. Vorher wird "
                "eine Sicherung angelegt. Statly ändert nur diese Karte, ihr Deck und ihren "
                "Notiztyp.",
            ),
            "goals.sync": (
                "Dürfen deine Lernziele über AnkiWeb abgeglichen werden?",
                "Statly legt deine Ziele als kleinen Eintrag in den Einstellungen deiner Sammlung "
                "ab, und der normale Sync bringt sie auf deine anderen Computer. Deine Karten "
                "bleiben unberührt.",
            ),
            "anki.deckLimits": (
                "Darf Statly das Limit für neue Karten ändern?",
                "Statly hebt nur das Limit für heute an. Du kannst das in Statly oder über Ankis "
                "Bearbeiten → Rückgängig zurücknehmen. Bei „Immer erlauben“ zeigt Statly jede "
                "Änderung mit einem Rückgängig-Knopf an.",
            ),
        },
    },
}


def language_of(language: str) -> str:
    return "de" if language.lower().startswith("de") else "en"


def labels_for(language: str) -> dict[str, Any]:
    return _TEXT[language_of(language)]


def revoke_note(language: str) -> str:
    return _REVOKE[language_of(language)]
