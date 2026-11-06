"""Study goals: how much to learn each day to be ready in time.

A goal is the main thing, and a dashboard widget is a window onto it. ``exam/`` holds the first kind
of goal, ``service.py`` puts a goal together, ``store.py`` and ``ledger.py`` keep it, and the pure
helpers ``days.py``, ``allocate.py`` and ``streaks.py`` hold the rules every kind shares.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from ...core.module import Context
from ...core.reader import CollectionReader
from ..changes import ChangeGate, goal_sync
from ..changes.deck_limits import PERMISSION as DECK_LIMITS
from ..changes.deck_limits import DeckLimitChange
from ..dashboard import DashboardService
from ..permissions import PermissionService
from ..review import ANSWERED, FINISHED, UNDONE, Attempt
from ..statistics.calendar import AnkiCalendar
from .labels import reached_note
from .ledger import Ledger
from .live import LiveCounter, LiveGoal, kind_of
from .service import GoalService
from .store import GoalStore, SyncStore

logger = logging.getLogger(__name__)

# Counting again when the deck list shows is cheap, but once a minute is plenty.
_MIN_SECONDS_BETWEEN_COUNTS = 60
# With "always", Statly raises a goal's limits by itself this often a day at most. Someone who
# undoes it gets it again on the next overview, so changing one's mind works, but after the third
# undo Statly leaves the limits as they are for the rest of the day.
MAX_RAISES_A_DAY = 3
# Before studying and after it, the numbers must be fresh. Two calls this close are one.
_SAME_MOMENT_SECONDS = 5


class GoalsModule:
    def register(self, context: Context) -> None:
        host, router = context.host, context.router
        settings = context.contract.goals
        cache: Any = context.services.get("cache")
        shared = SyncStore(host.data_folder, lambda: secrets.token_hex(4))
        service = GoalService(
            GoalStore(host.data_folder, context.contract, settings["maxGoals"]),
            Ledger(host.data_folder),
            cache.wrap if cache is not None else None,
            settings["sizes"],
            context.services.get("estimates"),
            shared,
        )
        context.services["goals"] = service
        context.services["goals.shared"] = shared
        dashboard: DashboardService = context.services["dashboard"]
        dashboard.add_source(settings["prefix"], service.widget_rules)

        def changed() -> None:
            host.emit("goals.changed", {})

        def save(params: Any, reader: CollectionReader) -> Any:
            first = not service.goals()
            goal = service.keep(params["goal"], reader)
            host.run_on_main(changed)
            if first:
                host.run_on_main(offer_sync)
            return goal

        def delete(params: Any) -> None:
            service.delete(params["id"])
            changed()

        router.local("goals.list", lambda _params: service.goals())
        router.query("goals.save", save)
        router.local("goals.delete", delete)
        router.query("goals.status", lambda params, reader: service.status_of(params["id"], reader))
        router.query(
            "goals.preview", lambda params, reader: service.preview(params["goal"], reader)
        )
        router.query("goals.decks", lambda _params, reader: service.deck_choices(reader))
        router.query("goals.overview", lambda _params, reader: service.overview(reader))
        router.local("goals.acknowledge", lambda params: service.acknowledge(params["id"]))

        gate: ChangeGate = context.services["changes"]
        permissions: PermissionService = context.services["permissions"]
        # Allowed where a goal needs it, listed under Privacy & Security to take back.
        permissions.offer(DECK_LIMITS, requestable=False)

        def raise_limit(params: Any, finish: Any, fail: Any) -> None:
            """The person's button. Statly works out the limits itself, the page only names the
            goal, and the gate asks in Statly's own popup unless this was allowed for good."""

            def decided(limits: tuple[tuple[int, int], ...]) -> None:
                if not limits:
                    finish({"applied": False, "reason": "notNeeded"})
                    return

                def done(result: Any) -> None:
                    finish(result)
                    if result.get("applied"):
                        changed()

                gate.apply(DeckLimitChange(limits), "user", done, fail)

            router.run_background(
                lambda reader: service.limits_needed(params["id"], reader), decided, fail
            )

        def open_deck_options(params: Any) -> None:
            host.open_deck_options(int(params["deckId"]))

        router.deferred("goals.raiseLimit", raise_limit)
        router.local("goals.openDeckOptions", open_deck_options)

        def raise_by_itself() -> None:
            """With "always", Statly raises what the studied deck needs, a few times a day at most.

            Never while studying: the gate waits then, and the next overview tries again.
            """
            if host.is_reviewing() or not permissions.grants.allowed(DECK_LIMITS):
                return
            studied = host.current_deck_id()
            if studied is None:
                return

            def needed(reader: CollectionReader) -> Any:
                today = AnkiCalendar(reader.day_cutoff).today
                goals: list[str] = []
                limits: dict[int, int] = {}
                for goal in service.goals():
                    raised = service.raises_today(goal["id"], today)
                    if goal["archived"] or raised >= MAX_RAISES_A_DAY:
                        continue
                    found = service.limits_needed(goal["id"], reader, studied)
                    if found:
                        goals.append(goal["id"])
                        for deck, limit in found:
                            limits[deck] = max(limits.get(deck, 0), limit)
                return today, goals, tuple(sorted(limits.items()))

            def apply(found: Any) -> None:
                today, goals, limits = found
                if not limits:
                    return

                def done(result: Any) -> None:
                    if result.get("applied"):
                        for goal_id in goals:
                            service.mark_raised(goal_id, today)
                        changed()

                gate.apply(
                    DeckLimitChange(limits),
                    "automatic",
                    done,
                    lambda error: logger.warning("Statly could not raise a limit: %s", error),
                )

            router.run_background(needed, apply)

        last_count = [float("-inf")]
        live = LiveCounter()
        context.services["goals.live"] = live

        def counted(found: tuple[int, list[LiveGoal]]) -> None:
            goals, left = found
            live.seed(left)
            if goals:
                changed()

        def count_now() -> None:
            # Never while studying: a query then would hold up the next card.
            if host.is_reviewing():
                return
            last_count[0] = host.monotonic()
            router.run_background(service.record_all, counted)

        def count_if_older_than(seconds: float) -> None:
            if host.monotonic() - last_count[0] >= seconds:
                count_now()

        def screen_changed(new_state: str, _old_state: str) -> None:
            # The deck's overview comes right before studying, so the tally starts fresh.
            if new_state == "overview":
                count_if_older_than(_SAME_MOMENT_SECONDS)
                raise_by_itself()

        def language() -> str:
            chosen = context.settings.get()["language"]
            return host.info()["language"] if chosen == "auto" else chosen

        def answered(attempt: Attempt) -> None:
            now = host.wall_clock()
            if attempt.undone or not live.wants(attempt.deck_id, now):
                return
            after = host.card_state(attempt.card_id)
            kind = kind_of(attempt.card_type, *after) if after else None
            if kind is None:
                return
            for goal in live.count(attempt.key, attempt.deck_id, kind, now):
                if context.settings.get()["goalToast"]:
                    host.show_tooltip(reached_note(language(), goal.name, goal.streak_after))

        host.on_deck_overview(lambda: count_if_older_than(_MIN_SECONDS_BETWEEN_COUNTS))
        host.on_state_changed(screen_changed)
        # Syncing goals between computers, see ``sync.py`` and ``changes/goal_sync.py``.

        def offer_sync() -> None:
            """Asked once, with the first goal. The switch under Privacy & Security stays."""
            if shared.asked() or permissions.grants.allowed(goal_sync.PERMISSION):
                return
            shared.mark_asked()
            permissions.ask(goal_sync.PERMISSION, lambda _answer: None, modes=("always",))

        def stop_sharing(cleaned: Any, failed: Any) -> None:
            """Taken back: the other computers hear that this one shares nothing any more."""
            gate.run(
                goal_sync.PERMISSION,
                lambda collection: goal_sync.switch_off(collection, shared.device()),
                lambda _result: cleaned(),
                failed,
            )

        permissions.offer(goal_sync.PERMISSION, requestable=True, on_revoke=stop_sharing)

        def share_before_sync() -> None:
            def work(collection: Any) -> bool:
                state = service.share(AnkiCalendar(collection.sched.day_cutoff).today)
                return state is not None and goal_sync.write_state(
                    collection, shared.device(), state
                )

            # Runs only with the permission, and the gate checks it again right before writing.
            gate.before_sync(goal_sync.PERMISSION, work)

        def take_after_sync() -> None:
            if not permissions.grants.allowed(goal_sync.PERMISSION):
                count_now()
                return

            def taken(found: bool) -> None:
                if found:
                    changed()
                count_now()

            router.run_background(
                lambda reader: service.take(reader.configs(goal_sync.KEY_PREFIX).values()),
                taken,
            )

        host.on_sync(share_before_sync, take_after_sync)
        context.events.subscribe(ANSWERED, answered)
        context.events.subscribe(UNDONE, lambda attempt: live.undo(attempt.key))
        context.events.subscribe(
            FINISHED, lambda _value: host.later(lambda: count_if_older_than(_SAME_MOMENT_SECONDS))
        )
