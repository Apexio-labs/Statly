"""Shows the dashboard on phones: as a card that travels with the normal Anki sync."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast

from ...contract.types import MobileStatusResult
from ...core.module import Context
from ...core.reader import CollectionReader
from ...core.storage import JsonStore
from ..changes import ChangeGate, phone_card
from ..permissions import PermissionService
from .snapshot import STAND, build_snapshot, content_hash, encode_snapshot, filled

logger = logging.getLogger(__name__)

_FILE = "mobile"
_PICTURE_SIDE = 480
_BACKGROUND_SIDE = 900
_MIN_SECONDS_BETWEEN_WRITES = 60


class MobileSync:
    def __init__(self, context: Context) -> None:
        self._host = context.host
        self._settings = context.settings
        self._permissions: PermissionService = context.services["permissions"]
        self._gate: ChangeGate = context.services["changes"]
        self._dashboard: Any = context.services["dashboard"]
        self._widgets: Any = context.services["widgets"]
        self._goals: Any = context.services.get("goals")
        self._thumbnails: dict[tuple[str, int], str] = {}
        self._store = JsonStore(context.host.data_folder)
        self._saw_first_sync = False
        self._last_attempt = 0.0

    def _language(self) -> str:
        chosen = self._settings.get()["language"]
        return self._host.info()["language"] if chosen == "auto" else chosen

    def _state(self) -> dict[str, Any]:
        stored: Any = self._store.read(_FILE)
        return cast(dict[str, Any], stored) if isinstance(stored, dict) else {}

    def _allowed(self) -> bool:
        return self._permissions.grants.allowed(phone_card.PERMISSION)

    def status(self) -> MobileStatusResult:
        return {
            "enabled": self._settings.get()["mobileSync"] and self._allowed(),
            "updated": self._state().get("updated"),
        }

    def _devices(self) -> dict[str, list[Any]]:
        resolved = self._dashboard.devices(self._dashboard.get())
        return {name: entry["widgets"] for name, entry in resolved.items()}

    def _custom_widgets(self) -> dict[str, Any]:
        return {widget["id"]: widget for widget in self._widgets.list()}

    def _shrunk(self, asset: dict[str, str], side: int) -> str | None:
        """Runs on a worker, and pictures rarely change, so each is shrunk only once."""
        key = (asset["id"], side)
        known = self._thumbnails.get(key)
        if known is None:
            stored = self._widgets.read_media(asset["id"])
            known = self._host.thumbnail(stored[1], side) if stored else None
            if known:
                self._thumbnails[key] = known
        return known

    def _backgrounds(self) -> dict[str, str | None]:
        chosen = self._settings.get()["dashboardBackgrounds"]
        return {
            "tablet": self._background_of(chosen["tablet"]),
            "phone": self._background_of(chosen["phone"]),
        }

    def _background_of(self, asset: Any) -> str | None:
        return self._shrunk(asset, _BACKGROUND_SIDE) if asset else None

    def _snapshot(self, reader: CollectionReader, devices: dict[str, list[Any]]) -> dict[str, Any]:
        language = self._language()
        goals = self._goals

        def goal_block(kind: str) -> dict[str, Any] | None:
            return goals.phone_block(kind, reader, language, STAND) if goals else None

        return build_snapshot(
            reader,
            devices,
            language,
            self._custom_widgets(),
            lambda asset: self._shrunk(asset, _PICTURE_SIDE),
            self._backgrounds(),
            goal_block,
        )

    def preview(self, params: Any, reader: CollectionReader) -> dict[str, Any]:
        devices = {"tablet": params["tablet"], "phone": params["phone"]}
        return filled(self._snapshot(reader, devices), datetime.now(), self._language())

    def _write(self, collection: Any, force: bool) -> bool:
        """Read and write in one step on the worker, so it cannot end up after a sync."""
        language = self._language()
        snapshot = self._snapshot(CollectionReader(collection), self._devices())
        digest = content_hash(snapshot)
        state = self._state()
        if not force and state.get("hash") == digest and not phone_card.needs_repair(collection):
            return False
        now = datetime.now()
        payload = encode_snapshot(snapshot, now, language)
        if not phone_card.write_snapshot(collection, payload):
            return False
        updated = now.isoformat(timespec="minutes")
        self._store.write(_FILE, {**state, "hash": digest, "updated": updated})
        return True

    def _ready(self) -> bool:
        """Before the first sync of a session the collection may be behind another device."""
        return (
            self._settings.get()["mobileSync"]
            and self._allowed()
            and (self._saw_first_sync or not self._host.syncs_on_start())
        )

    def enable(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        """Asks in Statly's own popup first. Without a yes there, nothing is written."""
        if not self._allowed():

            def answered(answer: str | None) -> None:
                if answer is None:
                    finish(self.status())
                else:
                    self.enable(_params, finish, fail)

            self._permissions.ask(phone_card.PERMISSION, answered, modes=("always",))
            return

        def work(collection: Any) -> None:
            self._host.create_backup()
            snapshot = self._snapshot(CollectionReader(collection), self._devices())
            phone_card.set_up(
                collection, encode_snapshot(snapshot, datetime.now(), self._language())
            )
            self._store.write(
                _FILE,
                {
                    "hash": content_hash(snapshot),
                    "updated": datetime.now().isoformat(timespec="minutes"),
                },
            )

        def done(_result: Any) -> None:
            self._settings.update({"mobileSync": True})
            self._saw_first_sync = True
            finish(self.status())

        self._gate.run(phone_card.PERMISSION, work, done, fail)

    def remove_card(self, finished: Callable[[], None], fail: Callable[[Exception], None]) -> None:
        """Takes the card out of the collection, while the permission still covers it."""

        def work(collection: Any) -> None:
            self._host.create_backup()
            phone_card.remove(collection)

        def done(_result: Any) -> None:
            self._settings.update({"mobileSync": False})
            self._store.write(_FILE, {})
            finished()

        if self._allowed():
            self._gate.run(phone_card.PERMISSION, work, done, fail)
        else:
            # Nothing may be written without the permission, so the card stays until it is back.
            self._settings.update({"mobileSync": False})
            finished()

    def disable(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        self._permissions.revoke(
            {"id": phone_card.PERMISSION}, lambda _states: finish(self.status()), fail
        )

    def refresh_now(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        self._gate.run(
            phone_card.PERMISSION,
            lambda collection: self._write(collection, True),
            lambda _result: finish(self.status()),
            fail,
        )

    def on_deck_overview(self) -> None:
        now = self._host.monotonic()
        if self._ready() and now - self._last_attempt >= _MIN_SECONDS_BETWEEN_WRITES:
            self._last_attempt = now
            self._gate.run(
                phone_card.PERMISSION,
                lambda collection: self._write(collection, False),
                lambda _result: None,
                _log,
            )

    def on_dashboard_saved(self, _layout: Any) -> None:
        """A new arrangement should reach the card at the next chance, not a minute later."""
        self._last_attempt = 0.0

    def on_sync_starting(self) -> None:
        if self._ready():
            self._gate.before_sync(
                phone_card.PERMISSION, lambda collection: self._write(collection, False)
            )

    def on_sync_finished(self) -> None:
        """A sync can bring a card damaged on a phone, so the next look does not wait a minute."""
        self._saw_first_sync = True
        self._last_attempt = 0.0


def _log(error: Exception) -> None:
    logger.warning("Statly could not update its card", exc_info=error)


class MobileModule:
    def register(self, context: Context) -> None:
        sync = MobileSync(context)
        router, host = context.router, context.host
        permissions: PermissionService = context.services["permissions"]
        # The phone card was switched on before permissions existed, so it stays allowed.
        permissions.grants.migrate(
            "mobile", [phone_card.PERMISSION] if context.settings.get()["mobileSync"] else []
        )
        permissions.offer(phone_card.PERMISSION, requestable=False, on_revoke=sync.remove_card)
        router.local("mobile.status", lambda _params: sync.status())
        router.deferred("mobile.enable", sync.enable)
        router.deferred("mobile.disable", sync.disable)
        router.deferred("mobile.refresh", sync.refresh_now)
        router.query("mobile.preview", sync.preview)
        context.events.subscribe("dashboard.saved", sync.on_dashboard_saved)
        host.on_deck_overview(sync.on_deck_overview)
        host.on_sync(sync.on_sync_starting, sync.on_sync_finished)
