"""The one door through which Statly changes Anki.

Everything that writes to the collection lives in this package, and only this file hands work to
Anki's worker. The gate checks the permission in Python right before anything runs, whatever the
web page or an assistant claims:

- Ongoing work such as the phone card needs an "always" permission (``run``, ``before_sync``).
- A single change (``apply``) asks the person in Statly's own dialog unless they allowed it for
  good. The assistant's changes always ask, and then only "Only this time" is offered.
- Every single change is a named step in Anki's undo history and an entry in Statly's log, so it
  can be undone from either place. Statly's undo only puts a value back if nobody changed it since.
- Changes Statly makes on its own wait while a review is on screen or a redo is waiting, because
  any write would slow down answering or destroy that redo.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal, Protocol, cast

from ...core.errors import InvalidParams, NotAllowed
from ...core.module import Context, Host
from ...core.reader import CollectionReader
from ...core.rpc import Router
from ...core.storage import JsonStore
from ..permissions import PermissionService
from .deck_limits import DeckLimitChange

_FILE = "changes"
_VERSION = 1

type Source = Literal["user", "automatic", "ai"]
type Done = Callable[[Any], None]
type Fail = Callable[[Exception], None]


class Change(Protocol):
    """One kind of change. Each lives in a file of its own in this package."""

    permission: str
    kind: str

    @property
    def subject(self) -> str: ...
    def preview(self, reader: CollectionReader) -> Any: ...
    def describe(self, preview: Any, language: str) -> tuple[str, ...]: ...
    def notice(self, preview: Any, language: str) -> str: ...
    def step_name(self, language: str, undo: bool = False) -> str: ...
    def details(self, preview: Any) -> dict[str, Any]: ...
    def current(self, collection: Any) -> Any: ...
    def target(self, collection: Any) -> Any: ...
    def write(self, collection: Any, value: Any) -> None: ...


def _details(details: dict[str, Any]) -> dict[str, Any]:
    """Details as the app reads them. Early entries named one deck on their own."""
    if details.get("kind") == "deckLimit" and "decks" not in details:
        single = {key: details[key] for key in ("deckId", "deckName", "before", "after")}
        return {"kind": "deckLimit", "decks": [single]}
    return details


def _rebuilt(entry: dict[str, Any]) -> Change:
    """The change behind a log entry, so it can be undone."""
    details = _details(entry["details"])
    if details["kind"] == "deckLimit":
        return DeckLimitChange(
            tuple((int(deck["deckId"]), int(deck["after"])) for deck in details["decks"])
        )
    raise InvalidParams(f"Unknown kind of change: {details['kind']}")


class Postponed(Exception):
    """A redo is waiting or a review is on screen, so a change Statly makes on its own waits."""


class ChangeLog:
    """What Statly changed, with what it replaced. It lives in the profile and does not sync."""

    def __init__(self, store: JsonStore, limit: int, now: Callable[[], datetime]) -> None:
        self._store = store
        self._limit = limit
        self._now = now

    def entries(self) -> list[dict[str, Any]]:
        stored: Any = self._store.read(_FILE)
        if not isinstance(stored, dict) or stored.get("version") != _VERSION:
            return []
        entries = cast(dict[str, Any], stored).get("entries")
        return cast(list[dict[str, Any]], entries) if isinstance(entries, list) else []

    def _write(self, entries: list[dict[str, Any]]) -> None:
        self._store.write(_FILE, {"version": _VERSION, "entries": entries[-self._limit :]})

    def add(
        self,
        change: Change,
        source: Source,
        details: dict[str, Any],
        before: Any,
        after: Any,
    ) -> str:
        identifier = secrets.token_hex(8)
        entry = {
            "id": identifier,
            "at": self._now().isoformat(timespec="minutes"),
            "source": source,
            "permission": change.permission,
            "subject": change.subject,
            "undone": False,
            "details": details,
            "restore": before,
            "applied": after,
        }
        self._write([*self.entries(), entry])
        return identifier

    def get(self, identifier: str) -> dict[str, Any] | None:
        return next((entry for entry in self.entries() if entry["id"] == identifier), None)

    def mark_undone(self, identifier: str) -> None:
        entries = self.entries()
        for entry in entries:
            if entry["id"] == identifier:
                entry["undone"] = True
        self._write(entries)

    def undoable(self, identifier: str) -> bool:
        """Only the newest change of a thing, because an older one was already replaced."""
        entries = self.entries()
        entry = next((item for item in entries if item["id"] == identifier), None)
        if entry is None or entry["undone"]:
            return False
        newest = [item for item in entries if item["subject"] == entry["subject"]][-1]
        return newest["id"] == identifier

    def public(self) -> list[dict[str, Any]]:
        shown = ("id", "at", "source", "permission", "undone")
        return [
            {
                **{key: entry[key] for key in shown},
                "details": _details(entry["details"]),
                "canUndo": self.undoable(entry["id"]),
            }
            for entry in reversed(self.entries())
        ]


class ChangeGate:
    def __init__(
        self,
        host: Host,
        router: Router,
        permissions: PermissionService,
        log: ChangeLog,
        language: Callable[[], str],
    ) -> None:
        self._host = host
        self._router = router
        self._permissions = permissions
        self._grants = permissions.grants
        self._log = log
        self._language = language

    def _checked(self, permission: str, work: Callable[[Any], Any]) -> Callable[[Any], Any]:
        """Checked again on the worker, because a permission can be taken back in between."""

        def run(collection: Any) -> Any:
            self._grants.require(permission)
            return work(collection)

        return run

    def run(self, permission: str, work: Callable[[Any], Any], done: Done, failed: Fail) -> None:
        """Ongoing work under an "always" permission, such as keeping the phone card current."""
        if not self._grants.allowed(permission):
            failed(NotAllowed(f"{permission} is not allowed."))
            return
        self._grants.used(permission)
        self._host.run_collection_write(self._checked(permission, work), done, failed)

    def before_sync(self, permission: str, work: Callable[[Any], Any]) -> None:
        if self._grants.allowed(permission):
            self._host.write_before_sync(self._checked(permission, work))

    def apply(self, change: Change, source: Source, done: Done, failed: Fail) -> None:
        """Make one change, after asking if needed. ``done`` gets what happened.

        The answer is ``{"applied": True, "id": ...}``, or ``{"applied": False, "reason": ...}``
        with "denied" or "postponed".
        """
        if source == "automatic":
            if not self._grants.allowed(change.permission):
                failed(NotAllowed(f"{change.permission} is not allowed."))
                return
            if self._host.is_reviewing():
                done({"applied": False, "reason": "postponed"})
                return

        def decide(preview: Any) -> None:
            language = self._language()
            if self._grants.allowed(change.permission) and source != "ai":
                self._write(change, source, preview, language, done, failed)
                return

            def answered(answer: str | None) -> None:
                if answer is None:
                    done({"applied": False, "reason": "denied"})
                else:
                    self._write(change, source, preview, language, done, failed)

            self._permissions.ask(
                change.permission,
                answered,
                modes=("once",) if source == "ai" else ("once", "always"),
                details=change.describe(preview, language),
                pause_after_no=source == "ai",
            )

        self._router.run_background(change.preview, decide, failed)

    def _write(
        self,
        change: Change,
        source: Source,
        preview: Any,
        language: str,
        done: Done,
        failed: Fail,
    ) -> None:
        values: dict[str, Any] = {}

        def work(collection: Any) -> Any:
            if source == "automatic" and collection.undo_status().redo:
                raise Postponed
            values["before"] = change.current(collection)
            values["after"] = change.target(collection)
            position = collection.add_custom_undo_entry(change.step_name(language))
            change.write(collection, values["after"])
            return collection.merge_undo_entries(position)

        def written(_changes: Any) -> None:
            if self._grants.allowed(change.permission):
                self._grants.used(change.permission)
            identifier = self._log.add(
                change, source, change.details(preview), values["before"], values["after"]
            )
            if source == "automatic":
                # Statly did this by itself, so it says so where the person is: in Anki.
                self._host.show_tooltip(change.notice(preview, language))
            self._host.emit("changes.applied", {"id": identifier})
            done({"applied": True, "id": identifier})

        def broke(error: Exception) -> None:
            if isinstance(error, Postponed):
                done({"applied": False, "reason": "postponed"})
            else:
                failed(error)

        self._host.run_collection_op(work, written, broke)

    def undo(self, params: Any, finish: Done, fail: Fail) -> None:
        """Put back what a change replaced, as a new step that Anki's undo can take back too."""
        identifier = params["id"]
        entry = self._log.get(identifier)
        if entry is None or not self._log.undoable(identifier):
            fail(NotAllowed("This change can no longer be undone here."))
            return
        change = _rebuilt(entry)
        language = self._language()

        def work(collection: Any) -> Any:
            if change.current(collection) != entry["applied"]:
                raise NotAllowed("This was changed again since, so Statly leaves it as it is.")
            position = collection.add_custom_undo_entry(change.step_name(language, undo=True))
            change.write(collection, entry["restore"])
            return collection.merge_undo_entries(position)

        def undone(_changes: Any) -> None:
            self._log.mark_undone(identifier)
            finish(self._log.public())

        self._host.run_collection_op(work, undone, fail)


class ChangesModule:
    def register(self, context: Context) -> None:
        permissions: PermissionService = context.services["permissions"]

        def language() -> str:
            chosen = context.settings.get()["language"]
            return context.host.info()["language"] if chosen == "auto" else chosen

        log = ChangeLog(
            JsonStore(context.host.data_folder),
            context.contract.permissions["maxChanges"],
            datetime.now,
        )
        gate = ChangeGate(context.host, context.router, permissions, log, language)
        context.services["changes"] = gate
        context.router.local("changes.list", lambda _params: log.public())
        context.router.deferred("changes.undo", gate.undo)
