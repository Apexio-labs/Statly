"""Lets decks show more new cards today, and only today.

Anki keeps this as each deck's "today only" limit, so tomorrow the decks follow their options
again. Nothing else changes: no card, note, history or option preset is touched, only the key
``newLimitToday`` of the decks named here, through Anki's own ``update_dict``. All decks of one
change are one step in Anki's undo history, and writing them needs no full sync, as measured on
Anki 25.09.4 and 26.09.3.

Statly only ever raises a limit. If a deck already allows as many cards when the change runs,
it stays as it is, so a limit someone set higher in between is never lowered.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ...core.errors import InvalidParams
from ...core.reader import CollectionReader

PERMISSION = "anki.deckLimits"
KIND = "deckLimit"
MAX_LIMIT = 9999
MAX_DECKS = 50
# Deck paths use the same angle quote as the web app, between the parts of the name.
_PATH_SEPARATOR = " \u203a "

_LABELS = {
    "en": {
        "step": "Statly: new cards today",
        "undo": "Statly: undo new cards today",
        "limit": "{name}: {before} → {after} new cards, today only",
        "notice": "Statly let more new cards in today:",
        "undo_hint": "Undo with Edit → Undo, or in Statly.",
    },
    "de": {
        "step": "Statly: Neue Karten heute",
        "undo": "Statly: Neue Karten heute zurück",
        "limit": "{name}: {before} → {after} neue Karten, nur heute",
        "notice": "Statly hat für heute mehr neue Karten erlaubt:",
        "undo_hint": "Rückgängig mit Bearbeiten → Rückgängig oder in Statly.",
    },
}


def _labels(language: str) -> dict[str, str]:
    return _LABELS["de" if language.lower().startswith("de") else "en"]


def _deck_or_fail(collection: Any, deck_id: int) -> Any:
    deck = collection.decks.get(deck_id, default=False)
    if deck is None or deck.get("dyn"):
        raise InvalidParams("A deck no longer exists or is a filtered deck.")
    return deck


@dataclass(frozen=True)
class Preview:
    """What the person sees before deciding: each deck's name and its limit today."""

    decks: tuple[tuple[int, str, int], ...]


@dataclass(frozen=True)
class DeckLimitChange:
    limits: tuple[tuple[int, int], ...]
    """(deck, new cards allowed today), one entry per deck."""

    permission = PERMISSION
    kind = KIND

    def __post_init__(self) -> None:
        decks = [deck for deck, _limit in self.limits]
        if not decks or len(decks) > MAX_DECKS or len(set(decks)) != len(decks):
            raise InvalidParams(f"A change covers 1 to {MAX_DECKS} different decks.")
        if any(not 0 <= limit <= MAX_LIMIT for _deck, limit in self.limits):
            raise InvalidParams(f"A limit must lie between 0 and {MAX_LIMIT}.")

    @property
    def subject(self) -> str:
        """Changes of the same decks replace each other, so only the newest can be undone."""
        return "decks:" + ",".join(str(deck) for deck in sorted(deck for deck, _ in self.limits))

    def preview(self, reader: CollectionReader) -> Preview:
        names = reader.deck_names()
        found: list[tuple[int, str, int]] = []
        for deck, _limit in self.limits:
            options = reader.deck_options(deck)
            if options is None or deck not in names:
                raise InvalidParams("A deck no longer exists or is a filtered deck.")
            found.append((deck, names[deck], options.new_per_day))
        return Preview(tuple(found))

    def _after(self, deck: int, before: int) -> int:
        return max(before, dict(self.limits)[deck])

    def describe(self, preview: Preview, language: str) -> tuple[str, ...]:
        text = _labels(language)
        return tuple(
            text["limit"].format(
                name=name.replace("::", _PATH_SEPARATOR),
                before=before,
                after=self._after(deck, before),
            )
            for deck, name, before in preview.decks
        )

    def notice(self, preview: Preview, language: str) -> str:
        """A short note for Anki's own window after Statly changed this by itself."""
        text = _labels(language)
        return "\n".join([text["notice"], *self.describe(preview, language), text["undo_hint"]])

    def step_name(self, language: str, undo: bool = False) -> str:
        return _labels(language)["undo" if undo else "step"]

    def details(self, preview: Preview) -> dict[str, Any]:
        return {
            "kind": KIND,
            "decks": [
                {
                    "deckId": deck,
                    "deckName": name,
                    "before": before,
                    "after": self._after(deck, before),
                }
                for deck, name, before in preview.decks
            ],
        }

    def current(self, collection: Any) -> Any:
        """Each deck's stored "today only" limit exactly as Anki keeps it, so undo can put it
        back, also when there was none."""
        return {
            str(deck): _deck_or_fail(collection, deck).get("newLimitToday")
            for deck, _ in self.limits
        }

    def target(self, collection: Any) -> Any:
        reader = CollectionReader(collection)
        today = collection.sched.today
        found: dict[str, Any] = {}
        for deck, limit in self.limits:
            options = reader.deck_options(deck)
            if options is None:
                raise InvalidParams("A deck no longer exists or is a filtered deck.")
            # Never lower what the deck allows today, whoever set it.
            found[str(deck)] = {"limit": max(limit, options.new_per_day), "today": today}
        return found

    def write(self, collection: Any, value: Mapping[str, Any]) -> None:
        for deck_id, _limit in self.limits:
            deck = _deck_or_fail(collection, deck_id)
            stored = value.get(str(deck_id))
            if stored is None:
                deck.pop("newLimitToday", None)
            else:
                deck["newLimitToday"] = stored
            collection.decks.update_dict(deck)
