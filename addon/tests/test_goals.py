"""Exam goals against real Anki collections, through the same calls the app makes."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.core.module import Context
from statly.core.reader import CollectionReader
from statly.modules.changes import phone_card
from statly.modules.statistics.calendar import AnkiCalendar
from test_rpc import FakeRuntime, call, drain, error_code, make_context

DAY_MS = 86_400_000
RATINGS = {"again": CardAnswer.AGAIN, "hard": CardAnswer.HARD, "good": CardAnswer.GOOD}


class Setup:
    def __init__(self, collection: Collection) -> None:
        self.collection = collection
        self.database: Any = collection.db
        self.runtime = FakeRuntime(collection)
        self.context: Context = make_context(self.runtime)
        # Asking about sync with the first goal has tests of its own in test_goal_sync.py.
        self.context.services["goals.shared"].mark_asked()
        self.today = AnkiCalendar(collection.sched.day_cutoff).today
        self.anatomy = self.add_cards("Anatomy", 20)
        self.bones = self.add_cards("Anatomy::Bones", 10)

    def deck(self, name: str) -> int:
        deck_id = self.collection.decks.id(name)
        assert deck_id is not None
        return int(deck_id)

    def add_cards(self, deck: str, number: int) -> list[int]:
        notetype: Any = self.collection.models.by_name("Basic")
        cards: list[int] = []
        for index in range(number):
            note = self.collection.new_note(notetype)
            note["Front"] = f"{deck} {index}"
            self.collection.add_note(note, self.deck(deck))  # type: ignore[arg-type]
            cards.append(note.cards()[0].id)
        return cards

    def answer(self, card_id: int, *ratings: str) -> None:
        for rating in ratings:
            card = self.collection.get_card(card_id)  # type: ignore[arg-type]
            card.start_timer()
            scheduler: Any = self.collection.sched
            states = self.collection._backend.get_scheduling_states(card.id)
            answer = scheduler.build_answer(card=card, states=states, rating=RATINGS[rating])
            scheduler.answer_card(answer)

    def learn(self, card_id: int) -> None:
        """The owner's example: Hard, then Good after a minute, then Good to a full day."""
        self.answer(card_id, "hard", "good", "good")

    def call(self, method: str, params: Any) -> Any:
        responses = call(self.context.router, method, params)
        drain(self.runtime)
        return responses

    def result(self, method: str, params: Any) -> Any:
        responses: list[Any] = []
        self.context.router.handle(
            json.dumps({"id": 1, "method": method, "params": params}), responses.append
        )
        drain(self.runtime)
        assert responses and responses[0]["ok"], responses
        return responses[0]["result"]

    def save(self, **changes: Any) -> dict[str, Any]:
        config = {
            "kind": "exam",
            "decks": [{"id": self.deck("Anatomy"), "name": "Anatomy"}],
            # Ten study days: today and the nine after it, then the exam.
            "examDate": (self.today + timedelta(days=10)).isoformat(),
            "bufferDays": 0,
            "mode": "learned",
            "counts": "newOnly",
            "studyWeekdays": [0, 1, 2, 3, 4, 5, 6],
            "freeDates": [],
            **changes,
        }
        return self.result(
            "goals.save", {"goal": {"id": None, "name": "", "archived": False, "config": config}}
        )

    def status(self, goal: dict[str, Any]) -> dict[str, Any]:
        return self.result("goals.status", {"id": goal["id"]})

    def book(self, goal: dict[str, Any]) -> dict[str, Any]:
        path = self.runtime.data_folder() / "goal-history" / f"{goal['id']}.json"
        return json.loads(path.read_text()) if path.exists() else {}


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "goals.anki2"))
    yield Setup(collection)
    collection.close()


def test_open_cards_are_spread_over_the_days_before_the_exam(setup: Setup) -> None:
    goal = setup.save()
    status = setup.status(goal)

    assert goal["name"] == "Anatomy"
    assert status["state"] == "active"
    assert status["studyDaysLeft"] == 10
    assert status["newCards"] == {"target": 3, "done": 0}
    assert status["totals"] == {
        "cards": 30,
        "learned": 0,
        "open": 30,
        "inProgress": 0,
        "finished": None,
        "waiting": None,
    }
    decks = {deck["name"]: deck for deck in status["decks"]}
    assert decks["Anatomy"]["open"] == 30
    assert decks["Anatomy::Bones"]["parentId"] == setup.deck("Anatomy")
    assert decks["Anatomy::Bones"]["target"] <= decks["Anatomy"]["target"]


def test_a_card_counts_once_its_learning_steps_are_done(setup: Setup) -> None:
    goal = setup.save()
    setup.answer(setup.anatomy[0], "hard", "good")
    halfway = setup.status(goal)
    assert halfway["newCards"]["done"] == 0
    assert halfway["totals"]["inProgress"] == 1

    setup.answer(setup.anatomy[0], "good")
    learned = setup.status(goal)
    assert learned["newCards"]["done"] == 1
    assert learned["totals"]["learned"] == 1
    assert learned["newCards"]["target"] == 3


def test_meeting_the_goal_celebrates_once(setup: Setup) -> None:
    goal = setup.save()
    for card in setup.anatomy[:3]:
        setup.learn(card)
    met = setup.status(goal)
    assert met["tone"] == "done"
    assert met["celebrate"] is True
    assert met["history"][-1]["result"] == "met"

    setup.result("goals.acknowledge", {"id": goal["id"]})
    assert setup.status(goal)["celebrate"] is False


def test_deleted_cards_lower_today_and_added_ones_wait_for_tomorrow(setup: Setup) -> None:
    goal = setup.save()
    assert setup.status(goal)["newCards"]["target"] == 3

    setup.add_cards("Anatomy", 30)
    assert setup.status(goal)["newCards"]["target"] == 3
    assert setup.status(goal)["tomorrow"]["ifMet"] == 7

    setup.collection.remove_notes(
        [setup.collection.get_card(card).nid for card in setup.anatomy[:10]]  # type: ignore[arg-type]
    )
    assert setup.status(goal)["newCards"]["target"] == 2


def test_cards_in_a_filtered_deck_still_count_for_their_own(setup: Setup) -> None:
    goal = setup.save()
    setup.collection.sched.rebuild_filtered_deck(
        setup.collection.decks.new_filtered("Cram")  # type: ignore[arg-type]
    )
    status = setup.status(goal)
    assert status["totals"]["cards"] == 30
    assert status["newCards"]["target"] == 3


def test_suspended_cards_leave_the_plan_and_are_named(setup: Setup) -> None:
    goal = setup.save()
    setup.collection.sched.suspend_cards(setup.anatomy[:10])  # type: ignore[arg-type]
    status = setup.status(goal)
    assert status["totals"]["cards"] == 20
    assert status["newCards"]["target"] == 2
    assert {"kind": "suspended", "cards": 10} in status["warnings"]


def test_a_low_new_card_limit_is_pointed_out(setup: Setup) -> None:
    goal = setup.save(examDate=(setup.today + timedelta(days=3)).isoformat())
    status = setup.status(goal)
    assert status["newCards"]["target"] == 10
    assert {
        "kind": "newLimit",
        "deckId": setup.deck("Anatomy"),
        "name": "Anatomy",
        "limit": 20,
        "target": 10,
    } not in status["warnings"]

    deck: Any = setup.collection.decks.get(setup.deck("Anatomy"))  # type: ignore[arg-type]
    deck["newLimitToday"] = {"limit": 5, "today": setup.collection.sched.today}
    setup.collection.decks.save(deck)
    warnings = setup.status(goal)["warnings"]
    assert {
        "kind": "newLimit",
        "deckId": setup.deck("Anatomy"),
        "name": "Anatomy",
        "limit": 5,
        "target": 10,
    } in warnings


def test_a_deleted_deck_is_named_and_no_decks_left_says_so(setup: Setup) -> None:
    chemistry = setup.add_cards("Chemistry", 5)
    goal = setup.save(
        decks=[
            {"id": setup.deck("Anatomy"), "name": "Anatomy"},
            {"id": setup.deck("Chemistry"), "name": "Chemistry"},
        ]
    )
    assert setup.status(goal)["totals"]["cards"] == 35
    assert chemistry

    setup.collection.decks.remove([setup.deck("Chemistry")])  # type: ignore[list-item]
    status = setup.status(goal)
    assert {"kind": "deckMissing", "name": "Chemistry"} in status["warnings"]
    assert status["totals"]["cards"] == 30

    setup.collection.decks.remove([setup.deck("Anatomy")])  # type: ignore[list-item]
    assert setup.status(goal)["state"] == "noDecks"


def test_reviews_count_when_chosen(setup: Setup) -> None:
    goal = setup.save(counts="newAndDue")
    setup.learn(setup.anatomy[0])
    card: Any = setup.collection.get_card(setup.anatomy[0])  # type: ignore[arg-type]
    setup.database.execute(
        "update cards set due = ? where id = ?", setup.collection.sched.today, card.id
    )
    status = setup.status(goal)
    assert status["reviews"] == {"target": 1, "done": 0, "counted": True}
    assert status["target"] == status["newCards"]["target"] + 1


def test_a_lapsed_card_counts_as_reviewed_once_it_leaves_relearning(setup: Setup) -> None:
    goal = setup.save(counts="newAndDue")
    setup.learn(setup.anatomy[0])
    # Learned on an earlier day, due today.
    setup.database.execute("update revlog set id = id - ?", 2 * DAY_MS)
    setup.database.execute(
        "update cards set due = ? where id = ?", setup.collection.sched.today, setup.anatomy[0]
    )

    setup.answer(setup.anatomy[0], "again")
    assert setup.status(goal)["reviews"]["done"] == 0
    setup.answer(setup.anatomy[0], "good")
    assert setup.status(goal)["reviews"]["done"] == 1


def test_days_without_anki_are_worked_out_from_its_history(setup: Setup) -> None:
    goal = setup.save()
    # The cards were added a week ago and the goal began three days ago. Two cards were learned
    # the day before yesterday, and Anki did not run on this computer since.
    setup.database.execute("update cards set id = id - ?", 7 * DAY_MS)
    setup.anatomy = [card - 7 * DAY_MS for card in setup.anatomy]
    path = setup.runtime.data_folder() / "goals" / f"{goal['id']}.json"
    stored = json.loads(path.read_text())
    stored["createdDay"] = (setup.today - timedelta(days=3)).isoformat()
    path.write_text(json.dumps(stored))
    start_ms = (setup.collection.sched.day_cutoff - 86_400) * 1000
    for card in setup.anatomy[:2]:
        setup.database.execute(
            "update cards set type = 2, queue = 2, ivl = 1, due = ? where id = ?",
            setup.collection.sched.today + 1,
            card,
        )
        setup.database.execute(
            "insert into revlog values (?, ?, -1, 3, 1, -600, 2500, 5000, 0)",
            start_ms - 2 * DAY_MS + card % 1000,
            card,
        )

    status = setup.status(goal)

    by_day = {entry["date"]: entry for entry in status["history"]}
    two_days_ago = (setup.today - timedelta(days=2)).isoformat()
    assert by_day[two_days_ago]["done"] == 2
    assert by_day[(setup.today - timedelta(days=3)).isoformat()]["result"] == "missed"
    assert setup.book(goal)["days"][two_days_ago]["source"] == "replayed"


def test_the_deck_list_counts_goals_without_the_window(setup: Setup) -> None:
    goal = setup.save()
    setup.runtime.deck_overview()
    drain(setup.runtime)
    assert setup.today.isoformat() in setup.book(goal)["days"]
    assert ("goals.changed", {}) in setup.runtime.emitted


def test_a_preview_stores_nothing(setup: Setup) -> None:
    config = {
        "kind": "exam",
        "decks": [{"id": setup.deck("Anatomy"), "name": "Anatomy"}],
        "examDate": (setup.today + timedelta(days=6)).isoformat(),
        "bufferDays": 0,
        "mode": "learned",
        "counts": "newOnly",
        "studyWeekdays": [0, 1, 2, 3, 4, 5, 6],
        "freeDates": [],
    }
    status = setup.result(
        "goals.preview", {"goal": {"id": None, "name": "x", "archived": False, "config": config}}
    )
    assert status["newCards"]["target"] == 5
    assert setup.result("goals.list", {}) == []
    assert not (setup.runtime.data_folder() / "goal-history").exists()


def test_a_goal_needs_a_future_exam_and_a_deck(setup: Setup) -> None:
    draft: Any = {
        "id": None,
        "name": "x",
        "archived": False,
        "config": {
            "kind": "exam",
            "decks": [{"id": 424242, "name": "Gone"}],
            "examDate": (setup.today + timedelta(days=6)).isoformat(),
            "bufferDays": 0,
            "mode": "learned",
            "counts": "newOnly",
            "studyWeekdays": [0],
            "freeDates": [],
        },
    }
    assert error_code(setup.call("goals.save", {"goal": draft})) == "invalid_params"
    draft["config"]["decks"] = [{"id": setup.deck("Anatomy"), "name": "Anatomy"}]
    draft["config"]["examDate"] = setup.today.isoformat()
    assert error_code(setup.call("goals.save", {"goal": draft})) == "invalid_params"


def test_a_deck_inside_a_chosen_deck_is_not_chosen_twice(setup: Setup) -> None:
    goal = setup.save(
        decks=[
            {"id": setup.deck("Anatomy::Bones"), "name": "x"},
            {"id": setup.deck("Anatomy"), "name": "y"},
        ]
    )
    assert goal["config"]["decks"] == [{"id": setup.deck("Anatomy"), "name": "Anatomy"}]


def test_the_deck_choice_leaves_out_filtered_decks_and_the_phone_card(setup: Setup) -> None:
    setup.collection.decks.new_filtered("Cram")
    phone_card.set_up(setup.collection, "e30=")
    choices = setup.result("goals.decks", {})
    names = [choice["name"] for choice in choices]
    assert "Cram" not in names
    assert "Statly Dashboard" not in names
    assert {"id": setup.deck("Anatomy"), "name": "Anatomy", "cards": 20, "open": 20} in choices


def test_a_goal_widget_leaves_the_dashboard_with_its_goal(setup: Setup) -> None:
    goal = setup.save()
    widget = {"id": "goal-1", "type": f"goal:{goal['id']}:ring", "x": 0, "y": 0, "w": 4, "h": 6}
    setup.result("dashboard.save", {"layout": {"widgets": [widget]}})
    assert setup.result("dashboard.get", {})["widgets"] == [widget]

    setup.result("goals.delete", {"id": goal["id"]})

    assert setup.result("dashboard.get", {})["widgets"] == []
    assert not (setup.runtime.data_folder() / "goal-history" / f"{goal['id']}.json").exists()


def test_counting_mid_review_changes_nothing(setup: Setup) -> None:
    goal = setup.save()
    setup.collection.decks.select(setup.deck("Anatomy"))  # type: ignore[arg-type]
    setup.answer(setup.anatomy[0], "good")
    status_before = setup.collection.undo_status()
    modified = setup.collection.mod

    setup.status(goal)
    setup.result("goals.decks", {})
    setup.runtime.deck_overview()
    drain(setup.runtime)

    status_after = setup.collection.undo_status()
    assert status_after.undo == status_before.undo
    assert status_after.last_step == status_before.last_step
    assert setup.collection.mod == modified


def test_the_day_s_goal_is_kept_in_the_day_book(setup: Setup) -> None:
    goal = setup.save()
    setup.status(goal)
    entry = setup.book(goal)["days"][setup.today.isoformat()]
    assert entry["newTarget"] == 3
    assert entry["openAtStart"] == 30
    assert entry["algorithm"] == "exam.even-split/1"
    assert entry["source"] == "live"
    assert date.fromisoformat(next(iter(setup.book(goal)["days"])))


def test_a_goal_can_be_archived_after_its_exam(setup: Setup) -> None:
    goal = setup.save()
    path = setup.runtime.data_folder() / "goals" / f"{goal['id']}.json"
    stored = json.loads(path.read_text())
    stored["config"]["examDate"] = (setup.today - timedelta(days=2)).isoformat()
    path.write_text(json.dumps(stored))

    draft = {"id": goal["id"], "name": "Done", "archived": True, "config": stored["config"]}
    archived = setup.result("goals.save", {"goal": draft})

    assert archived["archived"] is True
    assert archived["name"] == "Done"
    assert setup.status(archived)["state"] == "over"


# "Reviewed" goals ------------------------------------------------------------------------------


def test_a_card_is_finished_only_once_it_was_seen_again(setup: Setup) -> None:
    goal = setup.save(mode="reviewed")
    card = setup.anatomy[0]
    setup.learn(card)
    status = setup.status(goal)
    assert (status["totals"]["finished"], status["totals"]["waiting"]) == (0, 1)

    # A review on a later day, as Anki writes it: type 1, a button, an interval.
    tomorrow_ms = (setup.collection.sched.day_cutoff + 3600) * 1000
    setup.database.execute(
        "INSERT INTO revlog VALUES (?, ?, -1, 3, 3, 1, 2500, 5000, 1)", tomorrow_ms, card
    )
    status = setup.status(goal)
    assert (status["totals"]["finished"], status["totals"]["waiting"]) == (1, 0)


def test_the_first_gap_comes_from_the_persons_own_cards(setup: Setup) -> None:
    goal = setup.save(mode="reviewed")
    for card in setup.anatomy[:3]:
        setup.learn(card)
    status = setup.status(goal)
    first: list[int] = setup.database.list("SELECT ivl FROM revlog WHERE type = 0 AND ivl > 0")
    assert first and status["firstGapDays"] == max(first)
    deadline = date.fromisoformat(status["deadline"])
    assert status["learnBy"] == (deadline - timedelta(days=status["firstGapDays"])).isoformat()


def test_cards_due_after_the_deadline_are_named_also_in_a_filtered_deck(setup: Setup) -> None:
    goal = setup.save(mode="reviewed")
    today = setup.collection.sched.today
    late, borrowed = setup.anatomy[0], setup.anatomy[1]
    setup.database.execute(
        "UPDATE cards SET type = 2, queue = 2, ivl = 60, due = ? WHERE id = ?", today + 60, late
    )
    filtered = setup.collection.decks.new_filtered("Cram")
    setup.database.execute(
        "UPDATE cards SET type = 2, queue = 2, ivl = 60, did = ?, odid = ?, due = ?, odue = ? "
        "WHERE id = ?",
        filtered,
        setup.deck("Anatomy"),
        today,
        today + 60,
        borrowed,
    )
    status = setup.status(goal)
    assert {"kind": "lateCards", "cards": 2} in status["warnings"]


def test_a_learned_goal_does_not_read_whether_cards_were_seen_again(setup: Setup) -> None:
    status = setup.status(setup.save())
    assert status["learnBy"] is None and status["firstGapDays"] is None
    assert all(day["reviews"] >= 0 for day in status["plan"])


# Raising today's limit -------------------------------------------------------------------------


def limit_decks(setup: Setup, anatomy: int = 1, bones: int = 0) -> None:
    """Give both decks a limit of their own below what the goal plans for them today."""
    for name, limit in (("Anatomy", anatomy), ("Anatomy::Bones", bones)):
        deck: Any = setup.collection.decks.get(setup.deck(name))  # type: ignore[arg-type]
        deck["newLimit"] = limit
        setup.collection.decks.update_dict(deck)


def limit_today(setup: Setup, name: str) -> Any:
    deck: Any = setup.collection.decks.get(setup.deck(name))  # type: ignore[arg-type]
    return deck.get("newLimitToday")


def planned(status: dict[str, Any], name: str) -> int:
    return next(deck["target"] for deck in status["decks"] if deck["name"] == name)


def test_raising_takes_statlys_own_numbers_for_every_deck_and_asks_first(setup: Setup) -> None:
    setup.runtime.default_answer = None
    goal = setup.save()
    limit_decks(setup)
    status = setup.status(goal)
    warned = [warning["name"] for warning in status["warnings"] if warning["kind"] == "newLimit"]
    assert warned == ["Anatomy", "Anatomy::Bones"]

    setup.runtime.permission_answers.append("once")
    assert setup.result("goals.raiseLimit", {"id": goal["id"]})["applied"] is True
    anatomy, bones = planned(status, "Anatomy"), planned(status, "Anatomy::Bones")
    assert setup.runtime.prompts[-1].details == (
        f"Anatomy: 1 → {anatomy} neue Karten, nur heute",
        f"Anatomy \u203a Bones: 0 → {bones} neue Karten, nur heute",
    )
    assert limit_today(setup, "Anatomy")["limit"] == anatomy
    assert limit_today(setup, "Anatomy::Bones")["limit"] == bones
    assert not [w for w in setup.status(goal)["warnings"] if w["kind"] == "newLimit"]
    assert ("goals.changed", {}) in setup.runtime.emitted


def test_a_no_leaves_every_limit_as_it_was(setup: Setup) -> None:
    setup.runtime.default_answer = None
    goal = setup.save()
    limit_decks(setup)
    assert setup.result("goals.raiseLimit", {"id": goal["id"]}) == {
        "applied": False,
        "reason": "denied",
    }
    assert limit_today(setup, "Anatomy") is None
    assert limit_today(setup, "Anatomy::Bones") is None


def test_nothing_is_asked_when_the_limits_are_enough(setup: Setup) -> None:
    goal = setup.save()
    assert setup.result("goals.raiseLimit", {"id": goal["id"]}) == {
        "applied": False,
        "reason": "notNeeded",
    }
    assert setup.runtime.prompts == []


def test_the_page_cannot_name_a_limit(setup: Setup) -> None:
    goal = setup.save()
    limit_decks(setup)
    response = setup.call("goals.raiseLimit", {"id": goal["id"], "limit": 9999})
    assert error_code(response) == "invalid_params"
    assert limit_today(setup, "Anatomy") is None


def test_with_always_statly_raises_the_studied_deck_three_times_a_day_at_most(
    setup: Setup,
) -> None:
    goal = setup.save()
    limit_decks(setup)
    setup.context.services["permissions"].grants.grant("anki.deckLimits")
    setup.collection.decks.select(setup.deck("Anatomy"))  # type: ignore[arg-type]
    anatomy = planned(setup.status(goal), "Anatomy")

    def open_overview() -> None:
        setup.runtime.change_state("overview", "deckBrowser")
        drain(setup.runtime)

    def undo_in_statly() -> None:
        newest = call(setup.context.router, "changes.list", {})[0]["result"][0]["id"]
        call(setup.context.router, "changes.undo", {"id": newest})

    # Raised, taken back with Statly's undo, raised again: changing one's mind works.
    open_overview()
    assert limit_today(setup, "Anatomy")["limit"] == anatomy
    undo_in_statly()
    assert limit_today(setup, "Anatomy") is None
    open_overview()
    assert limit_today(setup, "Anatomy")["limit"] == anatomy

    # Taken back with Anki's undo: while Anki offers to redo it, Statly changes nothing by
    # itself, because that would throw the redo away. Anki's redo brings the raise back.
    setup.collection.undo()
    open_overview()
    assert limit_today(setup, "Anatomy") is None
    assert setup.collection.undo_status().redo == "Statly: Neue Karten heute"

    # Once the person did something else in Anki, Statly raises a third time, and no more.
    setup.collection.decks.id("Something else")
    open_overview()
    assert limit_today(setup, "Anatomy")["limit"] == anatomy
    undo_in_statly()
    open_overview()
    assert limit_today(setup, "Anatomy") is None
    assert setup.runtime.prompts == []
    assert len(setup.runtime.tooltips) == 3
    assert setup.book(goal)["days"][setup.today.isoformat()]["limitsRaised"] == 3


def test_an_early_mark_of_one_raise_still_counts(setup: Setup) -> None:
    goal = setup.save()
    setup.status(goal)
    service = setup.context.services["goals"]
    path = setup.runtime.data_folder() / "goal-history" / f"{goal['id']}.json"
    book = json.loads(path.read_text())
    book["days"][setup.today.isoformat()]["limitsRaised"] = True
    path.write_text(json.dumps(book))
    assert service.raises_today(goal["id"], setup.today) == 1


def test_statly_raises_nothing_by_itself_for_a_deck_it_does_not_study(setup: Setup) -> None:
    setup.save()
    limit_decks(setup)
    setup.context.services["permissions"].grants.grant("anki.deckLimits")
    other = setup.collection.decks.id("Languages")
    setup.collection.decks.select(other)  # type: ignore[arg-type]
    setup.runtime.change_state("overview", "deckBrowser")
    drain(setup.runtime)
    assert limit_today(setup, "Anatomy") is None


def test_without_always_statly_raises_nothing_by_itself(setup: Setup) -> None:
    setup.save()
    limit_decks(setup)
    setup.collection.decks.select(setup.deck("Anatomy"))  # type: ignore[arg-type]
    setup.runtime.change_state("overview", "deckBrowser")
    drain(setup.runtime)
    assert limit_today(setup, "Anatomy") is None
    assert setup.runtime.prompts == []


# On the phone card -----------------------------------------------------------------------------


def on_phone(goal: dict[str, Any], view: str = "ring") -> dict[str, Any]:
    kind = f"goal:{goal['id']}:{view}"
    return {"id": f"goal-{view}", "type": kind, "x": 0, "y": 0, "w": 4, "h": 6, "period": "today"}


def test_a_goal_on_the_phone_card_shows_the_day_and_when_it_was_counted(setup: Setup) -> None:
    goal = setup.save()
    setup.learn(setup.anatomy[0])
    placed = [on_phone(goal), on_phone(goal, "timeline")]
    snapshot = setup.result("mobile.preview", {"tablet": placed, "phone": placed})

    ring = snapshot["blocks"][f"goal:{goal['id']}:ring|today"]
    assert ring["kind"] == "custom" and ring["label"] == "Anatomy"
    status = setup.status(goal)
    shown = f"{status['done']} / {status['target']}"
    assert ring["values"]["progress"]["text"] == shown
    assert ring["values"]["progress"]["share"] == pytest.approx(status["done"] / status["target"])
    assert ring["values"]["line"]["text"] == f"Noch {status['target'] - status['done']}"
    assert ring["values"]["stand"]["text"].startswith("Stand: ")
    timeline = snapshot["blocks"][f"goal:{goal['id']}:timeline|today"]
    assert [
        element["style"]
        for element in timeline["widget"]["elements"]
        if element["kind"] == "progress"
    ] == ["bar"]


def test_an_unchanged_goal_leaves_the_phone_card_unchanged(setup: Setup) -> None:
    from statly.modules.mobile.snapshot import STAND, build_snapshot, content_hash

    goal = setup.save()
    service = setup.context.services["goals"]
    reader = CollectionReader(setup.collection)  # type: ignore[arg-type]

    def made() -> dict[str, Any]:
        devices = {"tablet": [on_phone(goal)], "phone": []}
        return build_snapshot(
            reader,
            devices,
            "de",
            {},
            goal_block=lambda kind: service.phone_block(kind, reader, "de", STAND),
        )

    assert content_hash(made()) == content_hash(made())


def test_a_deleted_goal_leaves_the_phone_card(setup: Setup) -> None:
    goal = setup.save()
    setup.result("goals.delete", {"id": goal["id"]})
    placed = [on_phone(goal)]
    snapshot = setup.result("mobile.preview", {"tablet": placed, "phone": placed})
    assert snapshot["blocks"] == {}
    assert snapshot["phone"] == []
