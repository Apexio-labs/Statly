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
from . import writer
from .snapshot import build_snapshot, content_hash, encode_snapshot, filled

logger = logging.getLogger(__name__)

_FILE = "mobile"
_PICTURE_SIDE = 480
_BACKGROUND_SIDE = 900
_MIN_SECONDS_BETWEEN_WRITES = 60


class MobileSync:
    def __init__(self, context: Context) -> None:
        self._host = context.host
        self._settings = context.settings
        self._dashboard: Any = context.services["dashboard"]
        self._widgets: Any = context.services["widgets"]
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

    def status(self) -> MobileStatusResult:
        return {
            "enabled": self._settings.get()["mobileSync"],
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
        return build_snapshot(
            reader,
            devices,
            self._language(),
            self._custom_widgets(),
            lambda asset: self._shrunk(asset, _PICTURE_SIDE),
            self._backgrounds(),
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
        if not force and state.get("hash") == digest and not writer.needs_repair(collection):
            return False
        now = datetime.now()
        payload = encode_snapshot(snapshot, now, language)
        if not writer.write_snapshot(collection, payload):
            return False
        updated = now.isoformat(timespec="minutes")
        self._store.write(_FILE, {**state, "hash": digest, "updated": updated})
        return True

    def _ready(self) -> bool:
        """Before the first sync of a session the collection may be behind another device."""
        return self._settings.get()["mobileSync"] and (
            self._saw_first_sync or not self._host.syncs_on_start()
        )

    def enable(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        def work(collection: Any) -> None:
            self._host.create_backup()
            snapshot = self._snapshot(CollectionReader(collection), self._devices())
            writer.set_up(collection, encode_snapshot(snapshot, datetime.now(), self._language()))
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

        self._host.run_collection_write(work, done, fail)

    def disable(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        def work(collection: Any) -> None:
            self._host.create_backup()
            writer.remove(collection)

        def done(_result: Any) -> None:
            self._settings.update({"mobileSync": False})
            self._store.write(_FILE, {})
            finish(self.status())

        self._host.run_collection_write(work, done, fail)

    def refresh_now(
        self, _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
    ) -> None:
        self._host.run_collection_write(
            lambda collection: self._write(collection, True),
            lambda _result: finish(self.status()),
            fail,
        )

    def on_deck_overview(self) -> None:
        now = self._host.monotonic()
        if self._ready() and now - self._last_attempt >= _MIN_SECONDS_BETWEEN_WRITES:
            self._last_attempt = now
            self._host.run_collection_write(
                lambda collection: self._write(collection, False), lambda _result: None, _log
            )

    def on_dashboard_saved(self, _layout: Any) -> None:
        """A new arrangement should reach the card at the next chance, not a minute later."""
        self._last_attempt = 0.0

    def on_sync_starting(self) -> None:
        if self._ready():
            self._host.write_before_sync(lambda collection: self._write(collection, False))

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
        router.local("mobile.status", lambda _params: sync.status())
        router.deferred("mobile.enable", sync.enable)
        router.deferred("mobile.disable", sync.disable)
        router.deferred("mobile.refresh", sync.refresh_now)
        router.query("mobile.preview", sync.preview)
        context.events.subscribe("dashboard.saved", sync.on_dashboard_saved)
        host.on_deck_overview(sync.on_deck_overview)
        host.on_sync(sync.on_sync_starting, sync.on_sync_finished)
