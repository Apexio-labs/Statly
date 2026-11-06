"""Only the person allows things, in Statly's own dialog, and taking back always works."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.core.contract import Contract
from statly.core.errors import NotAllowed
from statly.core.module import Context, PermissionPrompt
from statly.core.permissions import Permissions
from statly.core.rpc import Router
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.modules import MODULES
from statly.modules.changes import phone_card
from statly.modules.permissions import DENY_PAUSE_SECONDS, PermissionService
from test_rpc import FakeRuntime, call, error_code, make_context, make_router

RULES = Contract().permissions["rules"]


@pytest.fixture
def grants(tmp_path: Path) -> Permissions:
    return Permissions(JsonStore(lambda: tmp_path), RULES, lambda: datetime(2026, 11, 4, 9, 30))


class Window:
    """A host that only shows dialogs, with a clock the test moves by hand."""

    def __init__(self, *answers: str | None) -> None:
        self.answers = list(answers)
        self.prompts: list[PermissionPrompt] = []
        self.now = 0.0
        self.emitted: list[str] = []
        # With ``hold``, the popup stays open until ``release``, as it does for a person.
        self.hold = False
        self.waiting: list[Callable[[str | None], None]] = []

    def ask_permission(
        self, prompt: PermissionPrompt, answered: Callable[[str | None], None]
    ) -> None:
        self.prompts.append(prompt)
        if self.hold:
            self.waiting.append(answered)
        else:
            answered(self.answers.pop(0) if self.answers else None)

    def release(self, answer: str | None) -> None:
        self.waiting.pop(0)(answer)

    def monotonic(self) -> float:
        return self.now

    def emit(self, event: str, _payload: Any) -> None:
        self.emitted.append(event)


def asked(service: PermissionService, permission: str, **options: Any) -> str | None:
    """Ask and take the answer, which this host gives right away."""
    answers: list[str | None] = []
    service.ask(permission, answers.append, **options)
    assert len(answers) == 1
    return answers[0]


def service_with(window: Window, grants: Permissions) -> PermissionService:
    return PermissionService(window, grants, RULES, lambda: "en")  # type: ignore[arg-type]


def test_nothing_is_allowed_until_it_is_granted(grants: Permissions) -> None:
    assert not grants.allowed("ai.decks")
    with pytest.raises(NotAllowed):
        grants.require("ai.decks")
    grants.grant("ai.decks")
    assert grants.allowed("ai.decks")
    assert grants.grants()["ai.decks"].granted_at == "2026-11-04T09:30"
    assert grants.revoke("ai.decks")
    assert not grants.allowed("ai.decks")
    assert not grants.revoke("ai.decks")


def test_unknown_permissions_are_refused(grants: Permissions) -> None:
    with pytest.raises(NotAllowed):
        grants.allowed("anki.everything")
    with pytest.raises(NotAllowed):
        grants.grant("anki.everything")


def test_a_damaged_file_means_nothing_is_allowed(grants: Permissions, tmp_path: Path) -> None:
    grants.grant("ai.cards")
    (tmp_path / "permissions.json").write_text("{not json", encoding="utf-8")
    assert not grants.allowed("ai.cards")


def test_unknown_entries_in_the_file_are_ignored(grants: Permissions, tmp_path: Path) -> None:
    stored: dict[str, Any] = {
        "version": 1,
        "grants": {"anki.everything": {"grantedAt": "x"}},
        "migrated": [],
    }
    (tmp_path / "permissions.json").write_text(json.dumps(stored), encoding="utf-8")
    assert grants.grants() == {}


def test_a_migration_runs_once_and_asks_nobody(grants: Permissions) -> None:
    grants.migrate("ai", ["ai.decks", "anki.everything"])
    assert grants.grants()["ai.decks"].source == "migrated"
    grants.revoke("ai.decks")
    grants.migrate("ai", ["ai.decks"])
    assert not grants.allowed("ai.decks")


def test_the_dialog_offers_the_safe_answer_first(grants: Permissions) -> None:
    window = Window("once")
    service = service_with(window, grants)
    assert asked(service, "ai.cards") == "once"
    choices = [answer for answer, _label in window.prompts[0].choices]
    assert choices == ["deny", "once", "always"]
    assert "Settings → Privacy & Security" in window.prompts[0].body
    assert not grants.allowed("ai.cards")


def test_always_is_kept_and_once_is_not(grants: Permissions) -> None:
    service = service_with(Window("always"), grants)
    assert asked(service, "ai.decks") == "always"
    assert grants.allowed("ai.decks")


def test_a_permission_only_offers_its_own_modes(grants: Permissions) -> None:
    window = Window("once")
    service = service_with(window, grants)
    assert asked(service, "mobile.card") is None
    assert [answer for answer, _label in window.prompts[0].choices] == ["deny", "always"]
    assert window.prompts[0].choices[1][1] == "Allow"


def test_after_no_a_question_from_the_assistant_waits(grants: Permissions) -> None:
    window = Window("deny", "always", "always")
    service = service_with(window, grants)
    assert asked(service, "anki.deckLimits", pause_after_no=True) is None
    window.now += DENY_PAUSE_SECONDS - 1
    assert asked(service, "anki.deckLimits", pause_after_no=True) is None
    assert len(window.prompts) == 1
    window.now += 2
    assert asked(service, "anki.deckLimits", pause_after_no=True) == "always"


def test_a_question_the_person_starts_comes_right_away_after_a_no(grants: Permissions) -> None:
    window = Window("deny", "always")
    service = service_with(window, grants)
    assert asked(service, "ai.decks") is None
    assert asked(service, "ai.decks") == "always"
    assert len(window.prompts) == 2


def test_closing_the_dialog_counts_as_no(grants: Permissions) -> None:
    service = service_with(Window(None), grants)
    assert asked(service, "ai.decks") is None
    assert not grants.allowed("ai.decks")


def test_only_one_popup_at_a_time(grants: Permissions) -> None:
    window = Window()
    window.hold = True
    service = service_with(window, grants)
    first: list[str | None] = []
    service.ask("ai.decks", first.append)
    assert first == []

    assert asked(service, "ai.cards") is None
    window.release("always")

    assert first == ["always"]
    assert len(window.prompts) == 1


def test_nothing_waits_for_the_answer(grants: Permissions) -> None:
    """A page cannot run its scripts while a call from it is handled, so asking must return."""
    window = Window()
    window.hold = True
    service = service_with(window, grants)
    answers: list[str | None] = []
    service.ask("ai.decks", answers.append)
    assert answers == []
    assert not grants.allowed("ai.decks")
    window.release("deny")
    assert answers == [None]


def test_the_page_can_only_ask_for_a_dialog(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    runtime.default_answer = "deny"
    router = make_router(runtime)

    states = call(router, "permissions.request", {"id": "ai.decks"})[0]["result"]

    assert runtime.prompts[0].title == "Darf die KI deine Decknamen lesen?"
    assert next(state for state in states if state["id"] == "ai.decks")["granted"] is False


def test_what_belongs_to_a_setup_is_not_requested_from_the_settings() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    assert error_code(call(router, "permissions.request", {"id": "mobile.card"})) == "not_allowed"
    assert runtime.prompts == []


def test_the_list_shows_what_the_parts_of_statly_offer() -> None:
    states = call(make_router(FakeRuntime()), "permissions.list", {})[0]["result"]
    shown = {state["id"]: state["requestable"] for state in states}
    assert shown == {
        "ai.decks": True,
        "ai.cards": True,
        "ai.external": True,
        "mobile.card": False,
        "anki.deckLimits": False,
        "goals.sync": True,
    }


def test_the_phone_card_needs_a_yes_in_the_dialog(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    runtime.default_answer = "deny"
    router = make_router(runtime)

    status = call(router, "mobile.enable", {})[0]["result"]

    assert status["enabled"] is False
    assert not phone_card.is_set_up(collection)
    assert runtime.backups == 0


def test_revoking_the_phone_card_removes_it(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    assert phone_card.is_set_up(collection)

    states = call(router, "permissions.revoke", {"id": "mobile.card"})[0]["result"]

    assert not phone_card.is_set_up(collection)
    assert next(state for state in states if state["id"] == "mobile.card")["granted"] is False
    assert call(router, "mobile.status", {})[0]["result"]["enabled"] is False


def test_without_the_permission_the_card_is_never_written(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    context = make_context(runtime)
    call(context.router, "mobile.enable", {})
    context.services["permissions"].grants.revoke("mobile.card")
    database: Any = collection.db
    before = database.scalar("select mod from notes where guid = ?", phone_card.NOTE_GUID)

    runtime.deck_overview()
    call(context.router, "mobile.refresh", {})

    after = database.scalar("select mod from notes where guid = ?", phone_card.NOTE_GUID)
    assert after == before


def test_older_switches_are_taken_over_without_asking() -> None:
    runtime = FakeRuntime()
    ai_file = runtime.data_folder() / "ai.json"
    ai_file.write_text(
        json.dumps({"permissions": {"decks": True, "cards": False}, "externalPermissions": True})
    )
    (runtime.data_folder() / "settings.json").write_text(json.dumps({"mobileSync": True}))

    states = call(make_router(runtime), "permissions.list", {})[0]["result"]

    granted = {state["id"]: state["source"] for state in states if state["granted"]}
    assert granted == {"ai.decks": "migrated", "ai.external": "migrated", "mobile.card": "migrated"}
    assert runtime.prompts == []
    assert json.loads(ai_file.read_text())["permissions"] == {"decks": False, "cards": False}


def test_the_assistant_settings_switch_asks_first(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    runtime.default_answer = "deny"
    router = make_router(runtime)
    status = call(router, "ai.setPermission", {"scope": "cards", "allowed": True})[0]["result"]
    assert status["permissions"]["cards"] is False

    runtime.permission_answers.append("always")
    status = call(router, "ai.setPermission", {"scope": "cards", "allowed": True})[0]["result"]
    assert status["permissions"]["cards"] is True

    status = call(router, "ai.setPermission", {"scope": "cards", "allowed": False})[0]["result"]
    assert status["permissions"]["cards"] is False
    assert len(runtime.prompts) == 2


def test_statly_starts_before_anki_opens_a_profile() -> None:
    """Anki loads add-ons first and opens the profile later, unless it was started with -p.

    Statly 2.1.0 read the profile's settings while loading, so a normal start stopped there and
    the toolbar kept Anki's own Stats link.
    """
    runtime = FakeRuntime()
    runtime.profile_open = False
    router = Router(Contract(), runtime, check_results=True)
    settings = SettingsService(JsonStore(runtime.data_folder), router.contract)
    context = Context(router=router, host=runtime, contract=router.contract, settings=settings)

    for module in MODULES:
        module.register(context)

    (runtime.folder / "settings.json").write_text(json.dumps({"mobileSync": True}))
    runtime.profile_opened()
    states = call(router, "permissions.list", {})[0]["result"]
    assert {state["id"] for state in states if state["granted"]} == {"mobile.card"}
