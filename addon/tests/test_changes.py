"""Every change to Anki passes one gate: permission first, then a step that can be undone."""

from __future__ import annotations

from typing import Any

import pytest
from anki.collection import Collection

from statly.core.errors import InvalidParams, NotAllowed
from statly.core.module import Context
from statly.modules.changes import ChangeGate
from statly.modules.changes.deck_limits import DeckLimitChange
from test_rpc import FakeRuntime, call, drain, error_code, make_context


class Setup:
    def __init__(self, collection: Collection) -> None:
        self.collection = collection
        self.runtime = FakeRuntime(collection)
        self.runtime.default_answer = None
        self.context: Context = make_context(self.runtime)
        self.gate: ChangeGate = self.context.services["changes"]
        self.grants: Any = self.context.services["permissions"].grants
        deck_id = collection.decks.id("Test")
        assert deck_id is not None
        self.deck_id = int(deck_id)

    def apply(self, limit: int, source: Any = "user") -> dict[str, Any]:
        results: list[Any] = []
        errors: list[Exception] = []
        change = DeckLimitChange(((self.deck_id, limit),))
        self.gate.apply(change, source, results.append, errors.append)
        drain(self.runtime)
        if errors:
            raise errors[0]
        return results[0]

    def limit_today(self) -> Any:
        deck: Any = self.collection.decks.get(self.deck_id)  # type: ignore[arg-type]
        return deck.get("newLimitToday")

    def answer(self, *answers: str) -> None:
        self.runtime.permission_answers.extend(answers)


@pytest.fixture
def setup(collection: Collection) -> Setup:
    return Setup(collection)


def test_a_change_asks_and_shows_exactly_what_it_does(setup: Setup) -> None:
    setup.answer("once")
    result = setup.apply(85)

    assert result["applied"] is True
    prompt = setup.runtime.prompts[0]
    assert prompt.title == "Darf Statly das Limit für neue Karten ändern?"
    assert prompt.details == ("Test: 20 → 85 neue Karten, nur heute",)
    assert [answer for answer, _label in prompt.choices] == ["deny", "once", "always"]
    assert setup.limit_today() == {"limit": 85, "today": setup.collection.sched.today}


def test_once_covers_one_change_and_always_covers_the_next(setup: Setup) -> None:
    setup.answer("once")
    setup.apply(85)
    assert not setup.grants.allowed("anki.deckLimits")

    setup.answer("always")
    setup.apply(90)
    assert setup.grants.allowed("anki.deckLimits")

    setup.apply(95)
    assert len(setup.runtime.prompts) == 2
    assert setup.limit_today()["limit"] == 95


def test_no_means_nothing_changes(setup: Setup) -> None:
    setup.answer("deny")
    assert setup.apply(85) == {"applied": False, "reason": "denied"}
    assert setup.limit_today() is None
    assert call(setup.context.router, "changes.list", {})[0]["result"] == []


def test_the_change_is_a_named_step_above_the_users_own(setup: Setup) -> None:
    database: Any = setup.collection.db
    scheme = database.scalar("select scm from col")
    setup.answer("once")
    setup.apply(85)

    status = setup.collection.undo_status()
    assert status.undo == "Statly: Neue Karten heute"
    assert database.scalar("select scm from col") == scheme
    setup.collection.undo()
    assert setup.limit_today() is None
    assert setup.collection.undo_status().undo == "Answer Card"


def test_after_a_no_the_assistant_cannot_ask_again_at_once(setup: Setup) -> None:
    setup.runtime.monotonic = lambda: 0.0  # type: ignore[method-assign]
    setup.answer("deny")
    assert setup.apply(85, source="ai")["reason"] == "denied"
    assert setup.apply(85, source="ai")["reason"] == "denied"
    assert len(setup.runtime.prompts) == 1


def test_the_assistant_always_asks_and_never_for_good(setup: Setup) -> None:
    setup.grants.grant("anki.deckLimits")
    setup.answer("once")
    assert setup.apply(85, source="ai")["applied"] is True
    choices = [answer for answer, _label in setup.runtime.prompts[0].choices]
    assert choices == ["deny", "once"]


def test_statly_alone_needs_always(setup: Setup) -> None:
    with pytest.raises(NotAllowed):
        setup.apply(85, source="automatic")
    assert setup.runtime.prompts == []


def test_statly_alone_waits_while_someone_reviews(setup: Setup) -> None:
    setup.grants.grant("anki.deckLimits")
    setup.runtime.reviewing = True
    assert setup.apply(85, source="automatic") == {"applied": False, "reason": "postponed"}
    assert setup.limit_today() is None


def test_statly_alone_never_destroys_a_waiting_redo(setup: Setup) -> None:
    setup.grants.grant("anki.deckLimits")
    setup.collection.undo()
    assert setup.collection.undo_status().redo == "Answer Card"

    assert setup.apply(85, source="automatic") == {"applied": False, "reason": "postponed"}
    assert setup.collection.undo_status().redo == "Answer Card"
    assert setup.limit_today() is None


def test_a_missing_deck_is_reported(setup: Setup) -> None:
    results: list[Any] = []
    errors: list[Exception] = []
    setup.gate.apply(DeckLimitChange(((123456789, 50),)), "user", results.append, errors.append)
    drain(setup.runtime)
    assert isinstance(errors[0], InvalidParams)
    assert results == []


def test_limits_stay_within_what_anki_accepts() -> None:
    with pytest.raises(InvalidParams):
        DeckLimitChange(((1, 10_000),))
    with pytest.raises(InvalidParams):
        DeckLimitChange(((1, -1),))
    with pytest.raises(InvalidParams):
        DeckLimitChange(())
    with pytest.raises(InvalidParams):
        DeckLimitChange(((1, 10), (1, 20)))


def test_the_log_lists_changes_newest_first(setup: Setup) -> None:
    setup.answer("always")
    setup.apply(85)
    setup.apply(90)
    entries = call(setup.context.router, "changes.list", {})[0]["result"]

    assert [entry["details"]["decks"][0]["after"] for entry in entries] == [90, 85]
    assert [entry["details"]["decks"][0]["before"] for entry in entries] == [85, 20]
    assert [entry["canUndo"] for entry in entries] == [True, False]
    assert entries[0]["source"] == "user"
    assert ("changes.applied", {"id": entries[0]["id"]}) in setup.runtime.emitted


def test_undo_puts_back_what_was_there(setup: Setup) -> None:
    setup.answer("once")
    first = setup.apply(85)

    entries = call(setup.context.router, "changes.undo", {"id": first["id"]})[0]["result"]

    assert setup.limit_today() is None
    assert entries[0]["undone"] is True
    assert entries[0]["canUndo"] is False
    assert setup.collection.undo_status().undo == "Statly: Neue Karten heute zurück"


def test_undo_leaves_alone_what_someone_changed_since(setup: Setup) -> None:
    setup.answer("once")
    first = setup.apply(85)
    deck: Any = setup.collection.decks.get(setup.deck_id)  # type: ignore[arg-type]
    deck["newLimitToday"] = {"limit": 40, "today": setup.collection.sched.today}
    setup.collection.decks.update_dict(deck)

    assert error_code(call(setup.context.router, "changes.undo", {"id": first["id"]})) == (
        "not_allowed"
    )
    assert setup.limit_today()["limit"] == 40


def test_an_older_change_cannot_be_undone_over_a_newer_one(setup: Setup) -> None:
    setup.answer("always")
    first = setup.apply(85)
    setup.apply(90)
    assert error_code(call(setup.context.router, "changes.undo", {"id": first["id"]})) == (
        "not_allowed"
    )
    assert setup.limit_today()["limit"] == 90


def test_taking_back_always_stops_changes_at_once(setup: Setup) -> None:
    setup.answer("always")
    setup.apply(85)
    call(setup.context.router, "permissions.revoke", {"id": "anki.deckLimits"})
    with pytest.raises(NotAllowed):
        setup.apply(90, source="automatic")


def snapshot(collection: Collection) -> dict[str, Any]:
    """Everything a deck limit must never touch: cards, notes, history, presets, other decks."""
    database: Any = collection.db
    decks = {}
    for entry in collection.decks.all_names_and_ids():
        deck: dict[str, Any] = dict(collection.decks.get(entry.id) or {})  # type: ignore[arg-type]
        for key in ("newLimitToday", "mod", "usn"):
            deck.pop(key, None)
        decks[entry.id] = deck
    return {
        "cards": database.all("SELECT * FROM cards ORDER BY id"),
        "notes": database.all("SELECT * FROM notes ORDER BY id"),
        "revlog": database.all("SELECT * FROM revlog ORDER BY id"),
        "presets": [dict(preset) for preset in collection.decks.all_config()],
        "decks": decks,
        "scm": database.scalar("SELECT scm FROM col"),
    }


def test_a_raise_touches_nothing_but_the_limit_of_today(setup: Setup) -> None:
    before = snapshot(setup.collection)
    setup.answer("once")
    setup.apply(85)
    assert snapshot(setup.collection) == before
    assert setup.limit_today() == {"limit": 85, "today": setup.collection.sched.today}


def test_statly_never_lowers_a_limit(setup: Setup) -> None:
    deck: Any = setup.collection.decks.get(setup.deck_id)  # type: ignore[arg-type]
    deck["newLimitToday"] = {"limit": 120, "today": setup.collection.sched.today}
    setup.collection.decks.update_dict(deck)
    setup.answer("once")
    setup.apply(85)
    assert setup.limit_today()["limit"] == 120


def test_several_decks_change_in_one_step_that_anki_takes_back_at_once(setup: Setup) -> None:
    other = int(setup.collection.decks.id("Test::Part") or 0)
    setup.answer("once")
    results: list[Any] = []
    change = DeckLimitChange(((setup.deck_id, 60), (other, 30)))
    setup.gate.apply(change, "user", results.append, lambda error: None)
    drain(setup.runtime)
    assert results[0]["applied"] is True
    assert setup.runtime.prompts[0].details == (
        "Test: 20 → 60 neue Karten, nur heute",
        "Test \u203a Part: 20 → 30 neue Karten, nur heute",
    )
    part: Any = setup.collection.decks.get(other)  # type: ignore[arg-type]
    assert part["newLimitToday"]["limit"] == 30

    assert setup.collection.undo_status().undo == "Statly: Neue Karten heute"
    setup.collection.undo()
    part = setup.collection.decks.get(other)  # type: ignore[arg-type]
    assert setup.limit_today() is None and part.get("newLimitToday") is None


def test_statly_says_in_anki_when_it_raised_a_limit_by_itself(setup: Setup) -> None:
    setup.grants.grant("anki.deckLimits")
    assert setup.apply(85, source="automatic")["applied"] is True
    assert setup.runtime.tooltips == [
        "Statly hat für heute mehr neue Karten erlaubt:\n"
        "Test: 20 → 85 neue Karten, nur heute\n"
        "Rückgängig mit Bearbeiten → Rückgängig oder in Statly."
    ]


def test_an_early_entry_with_one_deck_still_reads(setup: Setup) -> None:
    store = setup.context.services["changes"]._log
    store._write(
        [
            {
                "id": "a" * 16,
                "at": "2026-11-04T09:30",
                "source": "user",
                "permission": "anki.deckLimits",
                "subject": f"deck:{setup.deck_id}",
                "undone": False,
                "details": {
                    "kind": "deckLimit",
                    "deckId": setup.deck_id,
                    "deckName": "Test",
                    "before": 20,
                    "after": 85,
                },
                "restore": None,
                "applied": {"limit": 85, "today": setup.collection.sched.today},
            }
        ]
    )
    entries = call(setup.context.router, "changes.list", {})[0]["result"]
    assert entries[0]["details"]["decks"] == [
        {"deckId": setup.deck_id, "deckName": "Test", "before": 20, "after": 85}
    ]
