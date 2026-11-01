"""The only way Statly reads Anki's database.

Anki treats a statement as a read only when its first word is ``select``. Everything else,
including ``with`` queries and statements behind a comment, clears the user's undo history even
if no row changes, and ``with x as (...) delete ...`` really deletes. The checks here are
therefore deliberately stricter than plain SQL.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any, Protocol

from anki.collection import SearchNode

from .errors import NotAllowed

STATLY_NOTE_GUID = "statly-dashboard"
"""The note behind the phone card. It is a tool, not study material, so statistics skip it."""

_SELECT = re.compile(r"select\s", re.IGNORECASE)
_FORBIDDEN = (";", "--", "/*")


class Scheduler(Protocol):
    @property
    def today(self) -> int: ...
    @property
    def day_cutoff(self) -> int: ...


class DeckEntry(Protocol):
    @property
    def id(self) -> int: ...
    @property
    def name(self) -> str: ...


class Decks(Protocol):
    def all_names_and_ids(self) -> Sequence[DeckEntry]: ...


class ReadableCollection(Protocol):
    @property
    def db(self) -> Any: ...
    @property
    def sched(self) -> Scheduler: ...
    @property
    def decks(self) -> Decks: ...
    @property
    def mod(self) -> int: ...
    def find_cards(self, query: str) -> Sequence[int]: ...
    def build_search_string(self, *nodes: Any) -> str: ...
    @property
    def _backend(self) -> Any: ...


def checked_sql(sql: str) -> str:
    """Return ``sql`` if it is a single plain SELECT, otherwise raise ``NotAllowed``."""
    statement = sql.strip()
    if _SELECT.match(statement) is None:
        raise NotAllowed("Only SELECT statements are allowed.")
    if any(token in statement for token in _FORBIDDEN):
        raise NotAllowed("Statements must not contain semicolons or comments.")
    return statement


class CollectionReader:
    """Read-only view of a collection. Pass values as ``?`` parameters, never in the SQL."""

    def __init__(self, collection: ReadableCollection) -> None:
        database = collection.db
        if database is None:
            raise NotAllowed("The collection is closed.")
        self._database = database
        self._collection = collection
        self._excluded_cards: tuple[int, ...] | None = None

    @property
    def today(self) -> int:
        """Anki's number for the current day, as used in the ``due`` column of cards."""
        return self._collection.sched.today

    @property
    def day_cutoff(self) -> int:
        return self._collection.sched.day_cutoff

    @property
    def modified(self) -> int:
        return self._collection.mod

    def deck_names(self) -> dict[int, str]:
        return {int(deck.id): deck.name for deck in self._collection.decks.all_names_and_ids()}

    @property
    def excluded_cards(self) -> tuple[int, ...]:
        """Cards statistics must not count. Empty unless the phone card is switched on."""
        if self._excluded_cards is None:
            self._excluded_cards = tuple(
                self.column(
                    "SELECT id FROM cards WHERE nid IN (SELECT id FROM notes WHERE guid = ?)",
                    STATLY_NOTE_GUID,
                )
            )
        return self._excluded_cards

    def find_cards(self, query: str) -> list[int]:
        """Anki's own search, which only reads. Statly's phone card is no study material."""
        excluded = set(self.excluded_cards)
        return [card for card in self._collection.find_cards(query) if card not in excluded]

    def _statistics_search(self, deck_id: int | None) -> str:
        parts: list[str] = []
        if deck_id is not None:
            name = self.deck_names().get(deck_id)
            parts.append(
                "cid:0"
                if name is None
                else self._collection.build_search_string(SearchNode(deck=name))
            )
        if self.excluded_cards:
            parts.append(f"-cid:{','.join(map(str, self.excluded_cards))}")
        return " ".join(parts)

    def graphs(self, deck_id: int | None) -> Any:
        """Everything on Anki's statistics page. The backend only reads for this.

        Its search fills a temporary table of Anki's own, which touches neither the collection
        nor the undo history, as the session test proves. Zero days mean the whole history.
        """
        return self._collection._backend.graphs(search=self._statistics_search(deck_id), days=0)

    def rows(self, sql: str, *args: Any) -> list[list[Any]]:
        return self._database.all(checked_sql(sql), *args)

    def scalar(self, sql: str, *args: Any) -> Any:
        return self._database.scalar(checked_sql(sql), *args)

    def column(self, sql: str, *args: Any) -> list[Any]:
        return self._database.list(checked_sql(sql), *args)
