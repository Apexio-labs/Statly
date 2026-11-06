"""Puts a goal together: its settings, Anki's counts, the day book and the streak.

Runs on Anki's worker, as a query, never while answering cards. Statly counts whenever Anki runs,
also with its window closed: when the deck list shows, after a sync and when the window asks.
Days on which Anki did not run on this computer are worked out again from Anki's history.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import replace
from datetime import date, timedelta
from typing import Any

from ...core.errors import InvalidParams
from ...core.reader import STATLY_DECK_NAME, CollectionReader
from ..estimates import MODEL, StudyTime
from ..estimates.returns import ECHO_DAYS, echo_with_fallback, first_gap
from ..statistics.calendar import AnkiCalendar
from .days import every_day
from .exam.inputs import collect
from .exam.plan import (
    ALGORITHM,
    ExamInputs,
    ExamPlan,
    FrozenDay,
    day_done,
    day_result,
    plan,
    replay,
    tone,
)
from .ledger import Ledger
from .live import LiveGoal, live_goal
from .phone import phone_block
from .store import GoalStore, SyncStore
from .streaks import DayResult, streak
from .sync import FROZEN, build_state, merge

SETTLE_AFTER_DAYS = 7
MAX_WINDOW_DAYS = 120
MAX_HISTORY_DAYS = 400
PREVIEW_ID = "exam-00000000"

type Cached = Callable[[Any, CollectionReader], Any]


def config_key(config: Mapping[str, Any]) -> str:
    """Tells whether a day's goal was fixed under the settings that apply now."""
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]


class GoalService:
    def __init__(
        self,
        store: GoalStore,
        ledger: Ledger,
        wrap: Callable[[str, Cached], Cached] | None,
        widget_sizes: Mapping[str, Mapping[str, int]],
        estimates: StudyTime | None = None,
        shared: SyncStore | None = None,
    ) -> None:
        self._store = store
        self._shared = shared
        self._estimates = estimates
        self._ledger = ledger
        self._sizes = widget_sizes
        read: Cached = lambda params, reader: collect(  # noqa: E731
            reader, params["config"], date.fromisoformat(params["origin"])
        )
        self._collect = wrap("goals.inputs", read) if wrap is not None else read

    # The dashboard -----------------------------------------------------------------------------

    def widget_rules(self) -> dict[str, dict[str, int]]:
        """Each goal can be on the dashboard as a ring and as a timeline."""
        return {
            f"{goal['id']}:{view}": {key: size[key] for key in ("minW", "maxW", "minH", "maxH")}
            for goal in self._store.list()
            for view, size in self._sizes.items()
        }

    # Calls -------------------------------------------------------------------------------------

    def goals(self) -> list[dict[str, Any]]:
        return self._store.list()

    def keep(self, draft: Mapping[str, Any], reader: CollectionReader) -> dict[str, Any]:
        today = AnkiCalendar(reader.day_cutoff).today
        existing = self._store.get(draft["id"]) if draft["id"] else None
        if draft["id"] and existing is None:
            raise InvalidParams("This goal no longer exists.")
        # Renaming or archiving keeps the settings as they are, even after the exam is over.
        config: dict[str, Any]
        if existing is not None and existing["config"] == draft["config"]:
            config = existing["config"]
        else:
            config = self._checked(draft["config"], reader, today)
        goal = {
            "id": existing["id"] if existing else f"{config['kind']}-{secrets.token_hex(4)}",
            "version": 1,
            "name": draft["name"].strip() or config["decks"][0]["name"].split("::")[-1],
            "createdDay": existing["createdDay"] if existing else today.isoformat(),
            "updatedAt": int(time.time()),
            "archived": draft["archived"],
            "config": config,
        }
        self._store.put(goal)
        return goal

    def delete(self, goal_id: str) -> None:
        self._store.delete(goal_id)
        self._ledger.forget(goal_id)
        if self._shared is not None:
            # Other computers learn of it with the next sync, and a deletion always wins there.
            self._shared.set_deleted({**self._shared.deleted(), goal_id: int(time.time())})

    # Syncing between computers -----------------------------------------------------------------

    def share(self, today: date) -> dict[str, Any] | None:
        """This computer's share for the other computers, see ``sync.py``."""
        if self._shared is None:
            return None
        goals = self._store.list()
        books = {goal["id"]: self._ledger.book(goal["id"]) for goal in goals}
        return build_state(
            self._shared.device(), goals, self._shared.deleted(), books, today, int(time.time())
        )

    def take(self, states: Iterable[Any]) -> bool:
        """Take over what the other computers shared. Returns whether anything changed here."""
        if self._shared is None:
            return False
        merged = merge(self._shared.device(), self._store.list(), self._shared.deleted(), states)
        changed = False
        for goal_id in merged.remove:
            self._store.delete(goal_id)
            self._ledger.forget(goal_id)
            changed = True
        for goal in merged.put:
            try:
                self._store.put(goal)
            except InvalidParams:
                # A goal that does not fit the contract, or one too many, stays where it was.
                continue
            changed = True
        self._shared.set_deleted(merged.deleted)
        for goal_id, days in merged.days.items():
            if self._store.get(goal_id) is not None:
                self._ledger.change(goal_id, lambda book, days=days: _adopt(book, days))
        for goal_id, best in merged.best.items():
            if self._store.get(goal_id) is not None:
                self._ledger.change(goal_id, lambda book, best=best: _best(book, best))
        return changed

    def status_of(self, goal_id: str, reader: CollectionReader) -> dict[str, Any]:
        goal = self._store.get(goal_id)
        if goal is None:
            raise InvalidParams("This goal no longer exists.")
        return self.status(goal, reader, record=True)

    def preview(self, draft: Mapping[str, Any], reader: CollectionReader) -> dict[str, Any]:
        """The numbers a goal would have now. Nothing is stored."""
        today = AnkiCalendar(reader.day_cutoff).today
        goal = {
            "id": draft["id"] or PREVIEW_ID,
            "version": 1,
            "name": draft["name"],
            "createdDay": today.isoformat(),
            "updatedAt": 0,
            "archived": False,
            "config": self._checked(draft["config"], reader, today),
        }
        return self.status(goal, reader, record=False)

    def acknowledge(self, goal_id: str) -> None:
        """The celebration of the newest day was shown, so it does not come again."""

        def mark(book: dict[str, Any]) -> bool:
            days = book["days"]
            if not days:
                return False
            newest = days[max(days)]
            if newest.get("celebrated"):
                return False
            newest["celebrated"] = True
            return True

        self._ledger.change(goal_id, mark)

    def record_all(self, reader: CollectionReader) -> tuple[int, list[LiveGoal]]:
        """Counts every goal that is still running, so the day book is current.

        Returns how many goals were counted and what is left of each for today, so the reviewer
        can count along without reading the collection.
        """
        recorded = 0
        live: list[LiveGoal] = []
        for goal in self._store.list():
            if not goal["archived"]:
                found = live_goal(goal, self.status(goal, reader, record=True))
                if found is not None:
                    live.append(found)
                recorded += 1
        return recorded, live

    def limits_needed(
        self, goal_id: str, reader: CollectionReader, studied: int | None = None
    ) -> tuple[tuple[int, int], ...]:
        """Decks of a goal whose limit today is below the new cards planned for them.

        Anki applies the limits of the deck one studies and of every deck inside it, so each deck
        is checked, subdecks included. With ``studied``, only that deck and the decks inside it.
        The numbers come from Statly's own plan, never from the page that asks.
        """
        goal = self._store.get(goal_id)
        if goal is None or goal["archived"]:
            return ()
        today = AnkiCalendar(reader.day_cutoff).today
        created = min(date.fromisoformat(goal["createdDay"]), today)
        days: dict[str, dict[str, Any]] = self._ledger.book(goal_id)["days"]
        config = goal["config"]
        inputs = self._inputs(reader, config, _origin(created, today, days))
        result = plan(config, inputs, _frozen(days.get(today.isoformat()), config_key(config)))
        if result.state not in ("active", "buffer") or result.new_target == 0:
            return ()
        limits = {deck.deck_id: deck.new_limit for deck in inputs.decks}
        names = reader.deck_names()
        inside = names.get(studied) if studied is not None else None
        needed: list[tuple[int, int]] = []
        for deck in result.decks:
            limit = limits.get(deck.deck_id)
            name = names.get(deck.deck_id, "")
            if studied is not None and (
                inside is None or (name != inside and not name.startswith(f"{inside}::"))
            ):
                continue
            if limit is not None and deck.target > limit:
                needed.append((deck.deck_id, deck.target))
        return tuple(needed)

    def get(self, goal_id: str) -> dict[str, Any] | None:
        return self._store.get(goal_id)

    def restore(self, goal: dict[str, Any]) -> None:
        """Put back an earlier version of a goal, as when an assistant's suggestion is undone."""
        self._store.put(goal)

    def overview(self, reader: CollectionReader) -> list[dict[str, Any]]:
        """Every goal in short, for the assistant. Deck names are hidden later where needed."""
        names = reader.deck_names()
        found: list[dict[str, Any]] = []
        for goal in self._store.list():
            config = goal["config"]
            status = self.status(goal, reader, record=not goal["archived"])
            time_left = status.get("time")
            found.append(
                {
                    "id": goal["id"],
                    "name": goal["name"],
                    "archived": goal["archived"],
                    "decks": [names.get(deck["id"], deck["name"]) for deck in config["decks"]],
                    "examDate": config["examDate"],
                    "bufferDays": config["bufferDays"],
                    "mode": config["mode"],
                    "counts": config["counts"],
                    "state": status["state"],
                    "today": {"target": status["target"], "done": status["done"]},
                    "studyDaysLeft": status["studyDaysLeft"],
                    "streak": {
                        "current": status["streak"]["current"],
                        "best": status["streak"]["best"],
                    },
                    "minutesLeft": round(time_left["left"]["seconds"] / 60) if time_left else None,
                    "warnings": [warning["kind"] for warning in status["warnings"]],
                }
            )
        return found

    def phone_block(
        self, widget_type: str, reader: CollectionReader, language: str, stand: str
    ) -> dict[str, Any] | None:
        """A goal widget as a block of the phone card. None once the goal is gone."""
        parts = widget_type.split(":")
        if len(parts) != 3 or parts[2] not in self._sizes:
            return None
        goal = self._store.get(parts[1])
        if goal is None:
            return None
        status = self.status(goal, reader, record=True)
        size = self._sizes[parts[2]]
        return phone_block(goal, status, parts[2], size, language, stand)

    def raises_today(self, goal_id: str, today: date) -> int:
        """How often Statly raised this goal's limits by itself today."""
        entry = self._ledger.book(goal_id)["days"].get(today.isoformat())
        return _raises(entry)

    def mark_raised(self, goal_id: str, today: date) -> None:
        """Count one raise Statly made by itself. See ``MAX_RAISES_A_DAY``."""

        def mark(book: dict[str, Any]) -> bool:
            entry = book["days"].setdefault(today.isoformat(), {})
            entry["limitsRaised"] = _raises(entry) + 1
            return True

        self._ledger.change(goal_id, mark)

    def deck_choices(self, reader: CollectionReader) -> list[dict[str, Any]]:
        """Decks a goal can use, with how many cards each holds and how many are still open."""
        names = reader.deck_names()
        usable = {
            deck: name
            for deck, name in names.items()
            if deck not in reader.filtered_deck_ids() and name != STATLY_DECK_NAME
        }
        excluded = reader.excluded_cards
        skip = f"WHERE c.id NOT IN ({', '.join('?' for _ in excluded)})" if excluded else ""
        counts = {
            int(home): (int(cards or 0), int(still_open or 0))
            for home, cards, still_open in reader.rows(
                f"""SELECT (CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END),
                    SUM(c.queue != -1), SUM(c.type IN (0, 1) AND c.queue != -1)
                FROM cards AS c {skip} GROUP BY 1""",
                *excluded,
            )
        }
        return [
            {
                "id": deck,
                "name": name,
                "cards": counts.get(deck, (0, 0))[0],
                "open": counts.get(deck, (0, 0))[1],
            }
            for deck, name in sorted(usable.items(), key=lambda item: item[1].lower())
        ]

    # Working it out ----------------------------------------------------------------------------

    def status(
        self, goal: Mapping[str, Any], reader: CollectionReader, record: bool
    ) -> dict[str, Any]:
        today = AnkiCalendar(reader.day_cutoff).today
        created = min(date.fromisoformat(goal["createdDay"]), today)
        empty: dict[str, Any] = {"best": 0, "days": {}}
        book: dict[str, Any] = self._ledger.book(goal["id"]) if record else empty
        days: dict[str, dict[str, Any]] = book["days"]
        best_before = int(book["best"])
        config = goal["config"]
        key = config_key(config)
        origin = _origin(created, today, days)
        inputs = self._inputs(reader, config, origin)

        entry = days.get(today.isoformat())
        result = plan(config, inputs, _frozen(entry, key))
        history = _history(config, inputs, result, days, created, today)
        found = streak(
            [DayResult(date.fromisoformat(day["date"]), day["result"]) for day in history],
            today,
            best_before,
        )
        if record:
            self._record(goal["id"], config, key, result, inputs, history, found.best, today)
        met = history[-1]["result"] == "met" if history else False
        celebrated = bool(entry and entry.get("celebrated") and entry.get("config") == key)
        found_status = _status(
            goal["id"], result, history, found, met and not celebrated and record, inputs
        )
        found_status["time"] = self._time(reader, result, inputs)
        return found_status

    def _time(
        self, reader: CollectionReader, result: ExamPlan, inputs: ExamInputs
    ) -> dict[str, Any] | None:
        """How long today's goal takes, and how much of it is left, by the person's own pace."""
        if self._estimates is None or result.state not in ("active", "buffer"):
            return None
        profile = self._estimates.profile(reader)
        below: dict[int, list[Any]] = {}
        for deck in result.decks:
            if deck.parent_id is not None:
                below.setdefault(deck.parent_id, []).append(deck)

        def own(deck: Any, name: str) -> int:
            inside = sum(getattr(child, name) for child in below.get(deck.deck_id, []))
            return max(getattr(deck, name) - inside, 0)

        due = {deck.deck_id: deck.due_reviews for deck in inputs.decks}
        roots = [deck.deck_id for deck in result.decks if deck.parent_id is None]
        new_today = [(deck.deck_id, own(deck, "target"), 0) for deck in result.decks]
        new_left = [
            (deck.deck_id, max(own(deck, "target") - own(deck, "done"), 0), 0)
            for deck in result.decks
        ]
        reviews_left = [(deck, 0, count) for deck, count in due.items()]
        # Which deck a review done today came from is not counted, so it goes with the first.
        reviews_done = [(roots[0] if roots else None, 0, result.review_done)]
        new_cards = profile.predict(new_today)
        reviews = profile.predict(reviews_left + reviews_done)
        counted = result.reviews_counted
        left = profile.predict(new_left + (reviews_left if counted else []))
        return {
            "left": left.as_json(),
            "day": (new_cards + reviews if counted else new_cards).as_json(),
            "newCards": new_cards.as_json(),
            "reviews": reviews.as_json(),
            "model": MODEL,
        }

    def _inputs(
        self, reader: CollectionReader, config: Mapping[str, Any], origin: date
    ) -> ExamInputs:
        found: ExamInputs = self._collect({"config": config, "origin": origin.isoformat()}, reader)
        # Limits can change without anything the cache sees, so they are read every time. Each
        # deck's own counts, because Anki applies the limits of subdecks too.
        decks = tuple(replace(deck, new_limit=_limit(reader, deck.deck_id)) for deck in found.decks)
        roots = [deck.deck_id for deck in decks if deck.parent_id is None]
        options = reader.deck_options(roots[0]) if roots else None
        graduating = options.graduating_days if options else 1
        if self._estimates is None:
            gap, measured = max(1, graduating), ()
        else:
            profile = self._estimates.profile(reader)
            gap = first_gap(profile.gaps, (deck.deck_id for deck in decks), graduating)
            measured = profile.echo
        return replace(
            found,
            decks=decks,
            first_gap_days=gap,
            echo=echo_with_fallback(measured or (None,) * (ECHO_DAYS + 1), gap),
        )

    def _checked(
        self, config: Mapping[str, Any], reader: CollectionReader, today: date
    ) -> dict[str, Any]:
        if date.fromisoformat(config["examDate"]) <= today:
            raise InvalidParams("The exam has to lie in the future.")
        names = reader.deck_names()
        filtered = reader.filtered_deck_ids()
        chosen = [
            deck for deck in config["decks"] if deck["id"] in names and deck["id"] not in filtered
        ]
        if not chosen:
            raise InvalidParams("Choose at least one deck.")
        # A deck inside another chosen deck is already part of it.
        paths = {deck["id"]: names[deck["id"]] for deck in chosen}
        roots = [
            {"id": deck, "name": name}
            for deck, name in paths.items()
            if not any(name.startswith(f"{other}::") for other in paths.values() if other != name)
        ]
        return {
            **config,
            "decks": sorted(roots, key=lambda deck: deck["name"].lower()),
            "studyWeekdays": sorted(set(config["studyWeekdays"])),
            "freeDates": sorted(set(config["freeDates"])),
        }

    def _record(
        self,
        goal_id: str,
        config: Mapping[str, Any],
        key: str,
        result: ExamPlan,
        inputs: ExamInputs,
        history: list[dict[str, Any]],
        best: int,
        today: date,
    ) -> None:
        settle_before = today - timedelta(days=SETTLE_AFTER_DAYS - 1)

        def write(book: dict[str, Any]) -> bool:
            days: dict[str, dict[str, Any]] = book["days"]
            before = json.dumps(book, sort_keys=True)
            current = days.get(today.isoformat())
            if current is None or current.get("config") != key:
                days[today.isoformat()] = {
                    "newTarget": result.new_target,
                    "reviewsTarget": result.review_target if result.reviews_counted else 0,
                    "openAtStart": result.open_at_start,
                    "reviewsAtStart": result.reviews_at_start,
                    "newestCard": inputs.newest_card,
                    "config": key,
                    "frozenAt": int(time.time()),
                    "algorithm": ALGORITHM,
                    "source": "live",
                    "settled": False,
                    "celebrated": False,
                }
                # New settings fix a new goal for the day, but the raises still count.
                if current is not None and _raises(current):
                    days[today.isoformat()]["limitsRaised"] = _raises(current)
            for day in history:
                when = date.fromisoformat(day["date"])
                stored = days.get(day["date"])
                if when < today and stored is None:
                    new_target, review_target, _, _ = replay(config, inputs, when)
                    stored = days[day["date"]] = {
                        "newTarget": new_target,
                        "reviewsTarget": review_target,
                        "algorithm": ALGORITHM,
                        "source": "replayed",
                        "settled": False,
                    }
                if stored is not None and when < settle_before and not stored.get("settled"):
                    stored.update(
                        target=day["target"], done=day["done"], result=day["result"], settled=True
                    )
            book["best"] = max(book["best"], best)
            return json.dumps(book, sort_keys=True) != before

        self._ledger.change(goal_id, write)


def _adopt(book: dict[str, Any], shared: Mapping[str, Mapping[str, Any]]) -> bool:
    """Take another computer's day's goals where they were fixed first. Settled days stay."""
    days: dict[str, dict[str, Any]] = book["days"]
    changed = False
    for day, entry in shared.items():
        mine = days.get(day)
        if mine is not None and mine.get("settled"):
            continue
        frozen = {name: entry[name] for name in FROZEN}
        if mine is None:
            days[day] = {
                **frozen,
                "config": entry["config"],
                "frozenAt": entry["frozenAt"],
                "algorithm": ALGORITHM,
                "source": "synced",
                "settled": False,
                "celebrated": entry["celebrated"],
            }
            changed = True
            continue
        if mine.get("config") == entry["config"] and entry["frozenAt"] < mine.get(
            "frozenAt", entry["frozenAt"] + 1
        ):
            mine.update(frozen, frozenAt=entry["frozenAt"])
            changed = True
        if entry["celebrated"] and not mine.get("celebrated"):
            mine["celebrated"] = True
            changed = True
    return changed


def _best(book: dict[str, Any], best: int) -> bool:
    if best <= int(book.get("best", 0)):
        return False
    book["best"] = best
    return True


def _raises(entry: Mapping[str, Any] | None) -> int:
    """Raises counted on a day. Early day books only said whether there was one."""
    found = entry.get("limitsRaised") if entry else None
    if found is True:
        return 1
    return int(found) if isinstance(found, int) and not isinstance(found, bool) else 0


def _frozen(entry: Mapping[str, Any] | None, key: str) -> FrozenDay | None:
    """The day's goal as fixed at its first count, if it was fixed for these settings."""
    if entry is None or entry.get("config") != key or "openAtStart" not in entry:
        return None
    return FrozenDay(
        int(entry["openAtStart"]), int(entry["reviewsAtStart"]), int(entry.get("newestCard", 0))
    )


def _limit(reader: CollectionReader, deck: int) -> int | None:
    options = reader.deck_options(deck)
    return options.new_per_day if options else None


def _origin(created: date, today: date, days: Mapping[str, Mapping[str, Any]]) -> date:
    """The first day that still needs Anki's history: not settled, or never counted at all."""
    earliest = max(created, today - timedelta(days=MAX_WINDOW_DAYS))
    for day in every_day(earliest, today):
        entry = days.get(day.isoformat())
        if entry is None or not entry.get("settled"):
            return day
    return today


def _history(
    config: Mapping[str, Any],
    inputs: ExamInputs,
    result: ExamPlan,
    days: Mapping[str, Mapping[str, Any]],
    created: date,
    today: date,
) -> list[dict[str, Any]]:
    """One entry per day since the goal began, today last."""
    history: list[dict[str, Any]] = []
    start = max(created, today - timedelta(days=MAX_HISTORY_DAYS - 1))
    for day in every_day(start, today):
        stored = days.get(day.isoformat())
        if day == today:
            new_target, review_target = result.new_target, result.review_target
            new_done, review_done = result.new_done, result.review_done
        elif stored is not None and stored.get("settled"):
            history.append(
                {
                    "date": day.isoformat(),
                    "target": int(stored["target"]),
                    "done": int(stored["done"]),
                    "result": str(stored["result"]),
                }
            )
            continue
        elif day in inputs.days:
            replayed = replay(config, inputs, day)
            new_done, review_done = replayed[2], replayed[3]
            if stored is not None:
                new_target, review_target = int(stored["newTarget"]), int(stored["reviewsTarget"])
            else:
                new_target, review_target = replayed[0], replayed[1]
        else:
            continue
        counted_reviews = review_done if review_target else 0
        history.append(
            {
                "date": day.isoformat(),
                "target": new_target + review_target,
                "done": day_done(new_target, new_done, review_target, counted_reviews),
                "result": day_result(
                    new_target, new_done, review_target, review_done, day == today
                ),
            }
        )
    return history


def _status(
    goal_id: str,
    result: ExamPlan,
    history: list[dict[str, Any]],
    found: Any,
    celebrate: bool,
    inputs: ExamInputs,
) -> dict[str, Any]:
    review_target = result.review_target if result.reviews_counted else 0
    return {
        "kind": "exam",
        "goalId": goal_id,
        "state": result.state,
        "tone": tone(result.new_target, result.new_done, review_target, result.review_done),
        "today": result.today.isoformat(),
        "deadline": result.deadline.isoformat(),
        "learnBy": result.learn_by.isoformat() if result.learn_by else None,
        "firstGapDays": result.first_gap,
        "examDate": result.exam.isoformat(),
        "studyDaysLeft": result.study_days_left,
        "target": result.target,
        "done": result.done,
        "newCards": {"target": result.new_target, "done": result.new_done},
        "reviews": {
            "target": result.reviews_at_start
            if not result.reviews_counted
            else result.review_target,
            "done": result.review_done,
            "counted": result.reviews_counted,
        },
        "tomorrow": {
            "ifMet": result.tomorrow_if_met,
            "ifStopped": result.tomorrow_if_stopped,
            "inBuffer": result.tomorrow_in_buffer,
        },
        "totals": dict(result.totals),
        "decks": [
            {
                "deckId": deck.deck_id,
                "parentId": deck.parent_id,
                "name": deck.name,
                "open": deck.open,
                "inProgress": deck.in_progress,
                "target": deck.target,
                "done": deck.done,
            }
            for deck in result.decks
        ],
        "streak": {
            "current": found.current,
            "best": found.best,
            "atRisk": found.at_risk,
            "milestone": found.milestone,
        },
        "history": history,
        "plan": [
            {
                "date": day.day.isoformat(),
                "target": day.target,
                "reviews": day.reviews,
                "kind": day.kind,
            }
            for day in result.plan
        ],
        "warnings": [dict(warning) for warning in result.warnings],
        "celebrate": celebrate,
        "refreshAt": inputs.refresh_at,
        "algorithm": ALGORITHM,
    }
