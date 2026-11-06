"""Asks the person in a dialog of Statly's own, and keeps what they decided.

The web page can only ask for a dialog. What the person clicks there is the only way anything
gets allowed, so a page or an assistant cannot grant itself rights. Taking a permission back
works from anywhere and first cleans up what the permission allowed, such as the phone card.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from ...core.errors import NotAllowed
from ...core.module import Context, Host, PermissionPrompt
from ...core.permissions import Permissions
from ...core.storage import JsonStore
from .labels import labels_for, revoke_note

# After "Don't Allow" to a question the assistant brought up, the same question stays quiet for a
# while, so a model cannot pester someone into clicking yes. Questions the person starts with a
# click of their own, such as a switch in the settings, come without this pause.
DENY_PAUSE_SECONDS = 30.0

type Finish = Callable[[], None]
type Fail = Callable[[Exception], None]
type Cleanup = Callable[[Finish, Fail], None]
type Answered = Callable[[str | None], None]


@dataclass(frozen=True)
class Offer:
    requestable: bool
    on_revoke: Cleanup | None


class PermissionService:
    def __init__(
        self,
        host: Host,
        grants: Permissions,
        rules: dict[str, Any],
        language: Callable[[], str],
    ) -> None:
        self._host = host
        self.grants = grants
        self._rules = rules
        self._language = language
        self._offers: dict[str, Offer] = {}
        self._asking = False
        self._denied_at: dict[str, float] = {}

    def offer(
        self, permission: str, *, requestable: bool, on_revoke: Cleanup | None = None
    ) -> None:
        """A part of Statly says it can use this, so the settings list it."""
        if permission not in self._rules:
            raise ValueError(f"Unknown permission: {permission}")
        self._offers[permission] = Offer(requestable, on_revoke)

    def ask(
        self,
        permission: str,
        answered: Answered,
        *,
        modes: Sequence[str] = ("once", "always"),
        title: str | None = None,
        body: str | None = None,
        details: Sequence[str] = (),
        pause_after_no: bool = False,
    ) -> None:
        """Ask in Statly's own popup. ``answered`` gets "once", "always" or None, later.

        "always" is stored right here. "once" is up to the caller, who uses it for exactly the
        action it asked about. Nothing waits for the answer: see ``Host.ask_permission``.
        """
        allowed_modes = [mode for mode in self._rules[permission]["modes"] if mode in modes]
        if not allowed_modes or self._asking:
            answered(None)
            return
        now = self._host.monotonic()
        paused = now - self._denied_at.get(permission, float("-inf")) < DENY_PAUSE_SECONDS
        if pause_after_no and paused:
            answered(None)
            return
        language = self._language()
        text = labels_for(language)
        default_title, default_body = text["permissions"][permission]
        choices: list[tuple[str, str]] = [("deny", text["deny"])]
        for mode in allowed_modes:
            if mode == "once":
                choices.append(("once", text["once"]))
            else:
                choices.append(
                    ("always", text["allow" if allowed_modes == ["always"] else "always"])
                )
        prompt = PermissionPrompt(
            title=title or default_title,
            body=f"{body or default_body}\n\n{revoke_note(language)}",
            details=tuple(details),
            choices=tuple(choices),
        )

        def decided(answer: str | None) -> None:
            self._asking = False
            if answer not in allowed_modes:
                self._denied_at[permission] = self._host.monotonic()
                answered(None)
                return
            if answer == "always":
                self.grants.grant(permission)
                self._host.emit("permissions.changed", {})
            answered(answer)

        self._asking = True
        try:
            self._host.ask_permission(prompt, decided)
        except Exception:
            self._asking = False
            raise

    def states(self) -> list[dict[str, Any]]:
        grants = self.grants.grants()
        shown = [
            permission
            for permission in self._rules
            if permission in self._offers or permission in grants
        ]
        states: list[dict[str, Any]] = []
        for permission in shown:
            grant = grants.get(permission)
            offer = self._offers.get(permission)
            states.append(
                {
                    "id": permission,
                    "granted": grant is not None,
                    "grantedAt": grant.granted_at if grant else None,
                    "source": grant.source if grant else None,
                    "lastUsedAt": grant.last_used_at if grant else None,
                    "requestable": offer is not None and offer.requestable,
                }
            )
        return states

    def request(self, params: Any, finish: Callable[[Any], None], fail: Fail) -> None:
        """The settings' "Allow…" button. Only the dialog's answer counts."""
        permission = params["id"]
        offer = self._offers.get(permission)
        if offer is None or not offer.requestable:
            fail(NotAllowed("This permission is given where it is used."))
            return
        if self.grants.allowed(permission):
            finish(self.states())
        else:
            self.ask(permission, lambda _answer: finish(self.states()), modes=("always",))

    def revoke(self, params: Any, finish: Callable[[Any], None], fail: Fail) -> None:
        """Clean up first, while the permission still covers it, then take it back for good."""
        permission = params["id"]
        offer = self._offers.get(permission)

        def taken_back() -> None:
            if self.grants.revoke(permission):
                self._host.emit("permissions.changed", {})

        def cleaned() -> None:
            taken_back()
            finish(self.states())

        def cleanup_failed(error: Exception) -> None:
            # Stopping matters more than tidying up, so the permission goes either way.
            taken_back()
            fail(error)

        if offer is not None and offer.on_revoke is not None and self.grants.allowed(permission):
            offer.on_revoke(cleaned, cleanup_failed)
        else:
            cleaned()


class PermissionsModule:
    def register(self, context: Context) -> None:
        rules = context.contract.permissions["rules"]

        def language() -> str:
            chosen = context.settings.get()["language"]
            return context.host.info()["language"] if chosen == "auto" else chosen

        service = PermissionService(
            context.host,
            Permissions(JsonStore(context.host.data_folder), rules),
            rules,
            language,
        )
        context.services["permissions"] = service
        context.router.local("permissions.list", lambda _params: service.states())
        context.router.deferred("permissions.request", service.request)
        context.router.deferred("permissions.revoke", service.revoke)
