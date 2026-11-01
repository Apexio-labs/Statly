"""Widgets the user made in the editor."""

from __future__ import annotations

import secrets
from collections.abc import Callable
from typing import Any, cast

from ...contract.types import (
    WidgetsDeleteParams,
    WidgetsExportParams,
    WidgetsExportResult,
    WidgetsImportResult,
    WidgetsMediaParams,
    WidgetsMediaResult,
    WidgetsSaveParams,
    WidgetsSaveResult,
    WidgetsSetGifLoopParams,
)
from ...core.errors import InvalidParams
from ...core.module import Context
from .sharing import MAX_PACKAGE_BYTES, PACKAGE_EXTENSION, export_package, read_package
from .storage import WidgetStore, media_references

_MEDIA_FILTER = "Images and videos (*.png *.jpg *.jpeg *.gif *.webp *.mp4 *.m4v *.mov *.webm)"
_PACKAGE_FILTER = f"Statly widget (*.{PACKAGE_EXTENSION})"


class WidgetsModule:
    def __init__(self) -> None:
        self.store: WidgetStore | None = None

    def register(self, context: Context) -> None:
        host, router, events = context.host, context.router, context.events

        def backgrounds() -> set[str]:
            chosen: dict[str, Any] = cast(Any, context.settings.get()["dashboardBackgrounds"])
            return {asset["id"] for asset in chosen.values() if asset is not None}

        store = WidgetStore(
            host.data_folder, context.contract, host.media_folder, host.media_url, backgrounds
        )
        self.store = store
        context.services["widgets"] = store

        def list_widgets(_params: Any) -> list[WidgetsSaveResult]:
            return store.list()

        def save(params: WidgetsSaveParams) -> WidgetsSaveResult:
            return store.put(params["widget"])

        def delete(params: WidgetsDeleteParams) -> None:
            store.delete(params["id"])
            events.publish("widgets.deleted", params["id"])

        def add_media(
            _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
        ) -> None:
            source = host.pick_path(_MEDIA_FILTER)
            if source is None:
                finish({"asset": None})
                return
            host.run_task(
                lambda: {"asset": store.add_file(source, host.convert_video)}, finish, fail
            )

        def set_gif_loop(params: WidgetsSetGifLoopParams) -> Any:
            return store.set_gif_loop(params["id"], params["loop"])

        def media(params: WidgetsMediaParams) -> WidgetsMediaResult:
            return {"url": store.media_url(params["id"])}

        def export(
            params: WidgetsExportParams,
            finish: Callable[[WidgetsExportResult], None],
            fail: Callable[[Exception], None],
        ) -> None:
            widget = store.get(params["id"])
            if widget is None:
                raise InvalidParams("This widget no longer exists.")

            def build() -> bytes:
                files: dict[str, bytes] = {}
                for asset_id in media_references(widget):
                    stored = store.read_media(asset_id)
                    if stored is None:
                        raise InvalidParams("A media file of this widget is missing.")
                    files[asset_id] = stored[1]
                return export_package(widget, files)

            def save_package(package: bytes) -> None:
                name = f"{widget['id']}.{PACKAGE_EXTENSION}"
                finish({"saved": host.save_binary(name, package, _PACKAGE_FILTER)})

            host.run_task(build, save_package, fail)

        def import_widget(
            _params: Any,
            finish: Callable[[WidgetsImportResult], None],
            fail: Callable[[Exception], None],
        ) -> None:
            source = host.pick_path(_PACKAGE_FILTER)
            if source is None:
                finish({"widget": None})
                return

            def work() -> WidgetsImportResult:
                if source.stat().st_size > MAX_PACKAGE_BYTES:
                    raise InvalidParams("This package is too large.")
                widget, files = read_package(source.read_bytes(), context.contract)
                for data in files.values():
                    store.add_media(data)
                # An imported widget never replaces one the user already has.
                widget["id"] = f"{widget['id'][:30]}-{secrets.token_hex(4)}"
                return {"widget": store.put(widget)}

            host.run_task(work, finish, fail)

        router.local("widgets.list", list_widgets)
        router.local("widgets.save", save)
        router.local("widgets.delete", delete)
        router.deferred("widgets.addMedia", add_media)
        router.local("widgets.setGifLoop", set_gif_loop)
        router.local("widgets.media", media)
        router.deferred("widgets.export", export)
        router.deferred("widgets.import", import_widget)
