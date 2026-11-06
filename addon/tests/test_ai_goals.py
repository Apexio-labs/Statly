"""The assistant and study goals: it may read them and suggest one, and nothing more."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.modules.ai.tools import Session
from test_goals import Setup
from test_rpc import call, drain


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "assistant.anki2"))
    yield Setup(collection)
    collection.close()


def use_tool(setup: Setup, name: str, arguments: Any, session: Session | None = None) -> Any:
    answers: list[Any] = []
    assistant: Any = setup.context.services["ai"]

    def answer(result: dict[str, Any], failed: bool) -> None:
        answers.append((result, failed))

    assistant.toolbox.run(name, arguments, session or Session("chat"), answer)
    drain(setup.runtime)
    return answers[0]


def suggested(setup: Setup, **config: Any) -> dict[str, Any]:
    deck = setup.deck("Anatomy")
    return {
        "id": None,
        "name": "Anatomy exam",
        "archived": False,
        "config": {
            "kind": "exam",
            "decks": [{"id": deck, "name": "Anatomy"}],
            "examDate": (setup.today + timedelta(days=30)).isoformat(),
            "bufferDays": 3,
            "mode": "learned",
            "counts": "newAndDue",
            "studyWeekdays": [0, 1, 2, 3, 4, 5, 6],
            "freeDates": [],
            **config,
        },
    }


def test_the_assistant_reads_goals_without_deck_names_unless_allowed(setup: Setup) -> None:
    setup.save()
    result, failed = use_tool(setup, "get_goals", {})
    assert failed is False
    goal = result["result"][0]
    assert (goal["name"], goal["decks"]) == ("Goal 1", ["Deck 1"])
    assert goal["today"]["target"] > 0 and goal["state"] == "active"

    setup.context.services["permissions"].grants.grant("ai.decks")
    result, _failed = use_tool(setup, "get_goals", {})
    assert (result["result"][0]["name"], result["result"][0]["decks"]) == ("Anatomy", ["Anatomy"])


def test_a_suggested_goal_waits_for_the_person_even_in_the_automatic_mode(setup: Setup) -> None:
    assistant: Any = setup.context.services["ai"]
    assistant.set_auto_mode({"enabled": True, "acknowledged": True})
    result, failed = use_tool(
        setup, "propose_goal", {"goal": suggested(setup), "summary": "An exam goal"}
    )
    assert failed is False
    assert result["status"] == "waiting_for_user"
    assert setup.result("goals.list", {}) == []


def test_a_suggestion_counts_only_once_the_person_saved_it(setup: Setup) -> None:
    result, _failed = use_tool(
        setup, "propose_goal", {"goal": suggested(setup), "summary": "An exam goal"}
    )
    proposal = result["id"]
    # Marking it without a saved goal, or with one that is not stored, is refused.
    assert call(setup.context.router, "ai.applyProposal", {"id": proposal})[0]["ok"] is False
    fake = {**setup.save(), "name": "Changed elsewhere"}
    assert (
        call(setup.context.router, "ai.applyProposal", {"id": proposal, "goal": fake})[0]["ok"]
        is False
    )

    saved = setup.result("goals.save", {"goal": suggested(setup)})
    assert call(setup.context.router, "ai.applyProposal", {"id": proposal, "goal": saved})[0]["ok"]
    changes = call(setup.context.router, "ai.changes", {})[0]["result"]
    assert [(change["kind"], change["mode"]) for change in changes] == [("goal", "approved")]

    # Undoing the suggestion removes the goal it created.
    call(setup.context.router, "ai.rollback", {"id": changes[0]["id"]})
    assert saved["id"] not in [goal["id"] for goal in setup.result("goals.list", {})]


def test_undoing_a_suggested_change_puts_the_goal_back(setup: Setup) -> None:
    original = setup.save()
    change = {**suggested(setup), "id": original["id"], "config": original["config"]}
    change["config"] = {**original["config"], "bufferDays": 7}
    result, _failed = use_tool(setup, "propose_goal", {"goal": change, "summary": "More buffer"})
    saved = setup.result("goals.save", {"goal": {**change, "name": original["name"]}})
    call(setup.context.router, "ai.applyProposal", {"id": result["id"], "goal": saved})
    entry = call(setup.context.router, "ai.changes", {})[0]["result"][0]
    call(setup.context.router, "ai.rollback", {"id": entry["id"]})
    back = next(goal for goal in setup.result("goals.list", {}) if goal["id"] == original["id"])
    assert back["config"]["bufferDays"] == original["config"]["bufferDays"]


def test_a_broken_suggestion_never_becomes_a_proposal(setup: Setup) -> None:
    broken = suggested(setup, examDate="tomorrow")
    result, failed = use_tool(setup, "propose_goal", {"goal": broken, "summary": "Broken"})
    assert failed is True
    assert "error" in result
