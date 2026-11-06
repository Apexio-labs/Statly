"""The only way Statly reads Anki's database.

Anki treats a statement as a read only when its first word is ``select``. Everything else,
including ``with`` queries and statements behind a comment, clears the user's undo history even
if no row changes, and ``with x as (...) delete ...`` really deletes. The checks here are
therefore deliberately stricter than plain SQL.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast

from anki.collection import SearchNode

from .errors import NotAllowed

STATLY_NOTE_GUID = "statly-dashboard"
STATLY_DECK_NAME = "Statly Dashboard"
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
    def all_names_and_ids(
        self, skip_empty_default: bool = False, include_filtered: bool = True
    ) -> Sequence[DeckEntry]: ...
    def get(self, did: Any, default: bool = True) -> Any: ...
    def config_dict_for_deck_id(self, did: Any) -> Any: ...


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
    def get_config(self, key: str, default: Any | None = None) -> Any: ...
    def all_config(self) -> dict[str, Any]: ...
    @property
    def _backend(self) -> Any: ...


@dataclass(frozen=True)
class DeckOptions:
    """What Anki's deck options say about one deck, as far as Statly needs it.

    The limits are the ones that apply today: a "today only" limit beats one set for this deck,
    which beats the preset. A parent deck's limit can still cap its subdecks."""

    new_per_day: int
    reviews_per_day: int
    max_answer_seconds: int
    learning_steps_minutes: tuple[float, ...]
    graduating_days: int
    easy_days: int
    bury_new_siblings: bool
    desired_retention: float
    fsrs: bool


@dataclass(frozen=True)
class DeckFamilies:
    """Chosen decks with their subdecks, and the chosen decks that no longer exist."""

    members: Mapping[int, tuple[int, ...]]
    missing: tuple[int, ...]


def _limit_today(deck: Mapping[str, Any], name: str, preset: int, today: int) -> int:
    override: Any = deck.get(f"{name}Today")
    if isinstance(override, dict) and override.get("today") == today:
        return int(cast(Any, override)["limit"])
    plain = deck.get(name)
    return preset if plain is None else int(plain)


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

    def filtered_deck_ids(self) -> set[int]:
        """Filtered decks only borrow cards. Each card still belongs to its home deck."""
        decks = self._collection.decks
        normal = {int(deck.id) for deck in decks.all_names_and_ids(include_filtered=False)}
        return {int(deck.id) for deck in decks.all_names_and_ids()} - normal

    def deck_families(self, roots: Sequence[int]) -> DeckFamilies:
        """Each chosen deck with its subdecks, without filtered decks. Unlike `deck_ids` in the
        statistics, a deck that is gone is reported instead of failing, so a goal can go on."""
        names = {
            int(deck.id): deck.name
            for deck in self._collection.decks.all_names_and_ids(include_filtered=False)
        }
        members: dict[int, tuple[int, ...]] = {}
        missing: list[int] = []
        for root in roots:
            name = names.get(root)
            if name is None:
                missing.append(root)
                continue
            prefix = f"{name}::"
            members[root] = (root, *sorted(i for i, n in names.items() if n.startswith(prefix)))
        return DeckFamilies(members, tuple(missing))

    def deck_options(self, deck_id: int) -> DeckOptions | None:
        """The options of a normal deck, or None for a filtered deck or one that is gone."""
        decks = self._collection.decks
        deck = decks.get(deck_id, default=False)
        if deck is None or deck.get("dyn"):
            return None
        preset = decks.config_dict_for_deck_id(deck_id)
        today = self.today
        new, review = preset["new"], preset["rev"]
        intervals = new.get("ints") or [1, 4]
        return DeckOptions(
            new_per_day=_limit_today(deck, "newLimit", int(new["perDay"]), today),
            reviews_per_day=_limit_today(deck, "reviewLimit", int(review["perDay"]), today),
            max_answer_seconds=int(preset.get("maxTaken", 60)),
            learning_steps_minutes=tuple(float(step) for step in new.get("delays", ())),
            graduating_days=int(intervals[0]),
            easy_days=int(intervals[1]) if len(intervals) > 1 else int(intervals[0]),
            bury_new_siblings=bool(new.get("bury", False)),
            desired_retention=float(
                deck.get("desiredRetention") or preset.get("desiredRetention") or 0.9
            ),
            fsrs=bool(self._collection.get_config("fsrs", False)),
        )

    def deck_presets(self) -> dict[int, tuple[int, int]]:
        """Each normal deck's options preset and its answer time limit in seconds."""
        decks = self._collection.decks
        found: dict[int, tuple[int, int]] = {}
        for entry in decks.all_names_and_ids():
            deck = decks.get(entry.id, default=False)
            if deck is None or deck.get("dyn"):
                continue
            preset = decks.config_dict_for_deck_id(entry.id)
            found[int(entry.id)] = (int(preset["id"]), int(preset.get("maxTaken", 60)))
        return found

    def configs(self, prefix: str) -> dict[str, Any]:
        """The collection's settings whose keys start with ``prefix``. Reading changes nothing."""
        return {
            key: value
            for key, value in self._collection.all_config().items()
            if key.startswith(prefix)
        }

    def config(self, key: str) -> Any:
        """A value from the collection's own settings, or None. Reading never changes them."""
        return self._collection.get_config(key, None)

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

    def card_state(self, card_id: int) -> tuple[int, int] | None:
        """One card's type and queue, by its primary key. None if the card is gone."""
        found = self.rows("SELECT type, queue FROM cards WHERE id = ?", card_id)
        return (int(found[0][0]), int(found[0][1])) if found else None

    def rows(self, sql: str, *args: Any) -> list[list[Any]]:
        return self._database.all(checked_sql(sql), *args)

    def scalar(self, sql: str, *args: Any) -> Any:
        return self._database.scalar(checked_sql(sql), *args)

    def column(self, sql: str, *args: Any) -> list[Any]:
        return self._database.list(checked_sql(sql), *args)
