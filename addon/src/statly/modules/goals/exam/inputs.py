"""Counts what an exam goal needs from Anki. The only place of the goal with SQL.

Every statement is a plain SELECT through ``CollectionReader``. Cards count for their home deck,
also while they sit in a filtered deck, and Statly's phone card never counts.

"Learned" means a card went through its learning steps once: its first answer with an interval of
at least a day. Anki's history is read only from ``origin`` on, the first day that is not settled
yet, so the cost stays the same however long the history is.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import Any

from ....core.reader import CollectionReader
from ...statistics.calendar import AnkiCalendar
from ...statistics.scope import placeholders
from ..days import deadline
from .plan import DayCounts, DeckCounts, ExamInputs

DAY_MS = 86_400_000
_HOME = "(CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END)"
_GRADUATED = "r.ease > 0 AND r.ivl > 0 AND r.type IN (0, 1, 2)"


def _members(
    reader: CollectionReader, roots: Sequence[int]
) -> tuple[dict[int, int | None], tuple[int, ...]]:
    """Every deck of the goal with its parent inside the goal, and the chosen decks that are gone.

    A chosen deck that later moved below another chosen deck simply becomes its child."""
    families = reader.deck_families(roots)
    names = reader.deck_names()
    members = sorted({deck for family in families.members.values() for deck in family})
    by_name = {names[deck]: deck for deck in members}
    parents: dict[int, int | None] = {}
    for deck in members:
        parts = names[deck].split("::")
        parent = None
        for length in range(len(parts) - 1, 0, -1):
            parent = by_name.get("::".join(parts[:length]))
            if parent is not None:
                break
        parents[deck] = parent
    return parents, families.missing


def collect(reader: CollectionReader, config: Mapping[str, Any], origin: date) -> ExamInputs:
    calendar = AnkiCalendar(reader.day_cutoff)
    today = calendar.today
    origin = min(origin, today)
    roots = [int(deck["id"]) for deck in config["decks"]]
    parents, missing_ids = _members(reader, roots)
    known = {int(deck["id"]): deck["name"] for deck in config["decks"]}
    missing = tuple(known[deck] for deck in missing_ids if deck in known)
    if not parents:
        return ExamInputs(today, (), {today: {}}, missing, reader.day_cutoff)

    names = reader.deck_names()
    decks = tuple(parents)
    marks = placeholders(decks)
    excluded = reader.excluded_cards
    skip = f" AND c.id NOT IN ({placeholders(excluded)})" if excluded else ""
    scope = f"{_HOME} IN ({marks}){skip}"
    scope_args: list[Any] = [*decks, *excluded]
    origin_ms = calendar.day_start(origin) * 1000
    days = (today - origin).days + 1

    cards = {
        int(row[0]): row[1:]
        for row in reader.rows(
            f"""SELECT {_HOME},
                SUM(c.queue != -1),
                SUM(c.queue = -1),
                SUM(c.type IN (2, 3) AND c.queue != -1),
                SUM(c.type = 1 AND c.queue != -1),
                SUM(c.type IN (2, 3) AND ((c.queue IN (2, 3)
                    AND (CASE WHEN c.odid != 0 THEN c.odue ELSE c.due END) <= ?) OR c.queue = 1))
            FROM cards AS c WHERE {scope} GROUP BY 1""",
            reader.today,
            *scope_args,
        )
    }

    # Cards still to learn, by the day they were added: before ``origin`` counts as day -1. A day
    # counts every card that existed on it. The day's goal is fixed at the first count, so cards
    # that arrive after that wait for the next day, see ``plan``.
    unlearned: dict[int, dict[int, int]] = defaultdict(dict)
    for home, bucket, number in reader.rows(
        f"""SELECT {_HOME}, CASE WHEN c.id < ? THEN -1 ELSE (c.id - ?) / {DAY_MS} END, COUNT(*)
        FROM cards AS c WHERE {scope} AND c.type IN (0, 1) AND c.queue != -1 GROUP BY 1, 2""",
        origin_ms,
        origin_ms,
        *scope_args,
    ):
        unlearned[int(home)][int(bucket)] = int(number)

    # Cards learned for the first time since ``origin``: home deck, when added, when learned.
    learned: list[tuple[int, int, int, int]] = [
        (int(home), int(card), _bucket(int(added), origin_ms), _bucket(int(first), origin_ms))
        for home, card, added, first in reader.rows(
            f"""SELECT {_HOME}, c.id, c.id, MIN(r.id)
            FROM revlog AS r JOIN cards AS c ON c.id = r.cid
            WHERE r.id >= ? AND {_GRADUATED} AND c.type IN (2, 3) AND c.queue != -1 AND {scope}
            AND NOT EXISTS (SELECT 1 FROM revlog AS p WHERE p.cid = r.cid AND p.id < ?
                AND p.ease > 0 AND p.ivl > 0 AND p.type IN (0, 1, 2))
            GROUP BY r.cid""",
            origin_ms,
            *scope_args,
            origin_ms,
        )
    ]

    # Learned cards reviewed: answered again and moved to a later day, once per card and day. A
    # card that lapsed and is still relearning at the end of the day is not done yet.
    reviewed: dict[int, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    for home, card, bucket in reader.rows(
        f"""SELECT {_HOME}, r.cid, (r.id - ?) / {DAY_MS}
        FROM revlog AS r JOIN cards AS c ON c.id = r.cid
        WHERE r.id >= ? AND r.ease > 0 AND r.type IN (1, 2) AND r.ivl > 0 AND {scope}
        GROUP BY r.cid, 3""",
        origin_ms,
        origin_ms,
        *scope_args,
    ):
        reviewed[int(bucket)][int(home)].add(int(card))

    learned_on: dict[int, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    for home, card, _added, first in learned:
        learned_on[first][home].add(card)

    per_day: dict[date, dict[int, DayCounts]] = {}
    for index in range(days):
        counts: dict[int, DayCounts] = {}
        for deck in decks:
            still_open = sum(n for bucket, n in unlearned[deck].items() if bucket <= index)
            learned_later = sum(
                1
                for home, _card, added, first in learned
                if home == deck and added <= index and first >= index
            )
            done = learned_on[index][deck]
            counts[deck] = DayCounts(
                open_at_start=still_open + learned_later,
                learned=len(done),
                reviewed=len(reviewed[index][deck] - done),
            )
        per_day[origin + timedelta(days=index)] = counts

    # Today's open cards that were added today, so cards added after the day's goal was fixed can
    # wait for tomorrow.
    today_ms = calendar.day_start(today) * 1000
    today_index = days - 1
    added_today = [
        int(card)
        for card in reader.column(
            f"""SELECT c.id FROM cards AS c
            WHERE {scope} AND c.id >= ? AND c.type IN (0, 1) AND c.queue != -1""",
            *scope_args,
            today_ms,
        )
    ] + [
        card for _home, card, _added, first in learned if first == today_index and card >= today_ms
    ]

    seen_again = (
        _seen_again(reader, config, scope, scope_args, today)
        if config["mode"] == "reviewed"
        else {}
    )
    deck_counts = tuple(
        _deck(reader, deck, parents[deck], names[deck], cards.get(deck), seen_again.get(deck))
        for deck in decks
    )
    due_by_day: dict[int, int] = defaultdict(int)
    for day, number in reader.rows(
        f"""SELECT MAX((CASE WHEN c.odid != 0 THEN c.odue ELSE c.due END) - ?, 0), COUNT(*)
        FROM cards AS c WHERE {scope} AND c.type IN (2, 3) AND c.queue IN (2, 3) GROUP BY 1""",
        reader.today,
        *scope_args,
    ):
        due_by_day[int(day)] += int(number)
    return ExamInputs(
        today,
        deck_counts,
        per_day,
        missing,
        reader.day_cutoff,
        tuple(sorted(added_today)),
        int(reader.scalar("SELECT COALESCE(MAX(id), 0) FROM cards")),
        dict(due_by_day),
    )


def _bucket(moment_ms: int, origin_ms: int) -> int:
    return -1 if moment_ms < origin_ms else (moment_ms - origin_ms) // DAY_MS


def _seen_again(
    reader: CollectionReader,
    config: Mapping[str, Any],
    scope: str,
    scope_args: Sequence[Any],
    today: date,
) -> dict[int, tuple[int, int]]:
    """For "reviewed" goals, by deck: learned cards seen again, and learned cards not seen again
    that Anki would show only after the deadline.

    A card counts as seen again with any review or relearning answer: that only happens after it
    was learned, on a later day. This reads each learned card's history once, so it is the goal's
    most expensive query; the benchmark keeps it within its budget.
    """
    last = deadline(date.fromisoformat(config["examDate"]), config["bufferDays"])
    last_day = reader.today + (last - today).days
    return {
        int(home): (int(finished or 0), int(late or 0))
        for home, finished, late in reader.rows(
            f"""SELECT home, SUM(seen), SUM(NOT seen AND due > ?)
            FROM (SELECT {_HOME} AS home,
                    EXISTS (SELECT 1 FROM revlog AS r WHERE r.cid = c.id AND r.type IN (1, 2)
                        AND r.ease > 0) AS seen,
                    (CASE WHEN c.odid != 0 THEN c.odue ELSE c.due END) AS due
                FROM cards AS c WHERE {scope} AND c.type IN (2, 3) AND c.queue != -1)
            GROUP BY home""",
            last_day,
            *scope_args,
        )
    }


def _deck(
    reader: CollectionReader,
    deck: int,
    parent: int | None,
    name: str,
    row: Any,
    seen_again: tuple[int, int] | None = None,
) -> DeckCounts:
    values = [int(value or 0) for value in row] if row else [0] * 5
    options = reader.deck_options(deck) if parent is None else None
    return DeckCounts(
        deck_id=deck,
        parent_id=parent,
        name=name,
        cards=values[0],
        suspended=values[1],
        learned=values[2],
        in_progress=values[3],
        due_reviews=values[4],
        new_limit=options.new_per_day if options else None,
        finished=seen_again[0] if seen_again else 0,
        late=seen_again[1] if seen_again else 0,
    )
