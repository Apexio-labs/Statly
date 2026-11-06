"""The picture or video behind Statly and, if wanted, behind Anki's deck overview."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from ...contract.types import SettingsGetResult, SettingsUpdateParams
from ...core.errors import InvalidParams, NotAllowed
from ...core.module import Context, Host
from ...core.settings import SettingsService

logger = logging.getLogger(__name__)

_OLD_FILE = "wallpaper.jpg"
# The contract's WALLPAPER_HISTORY. A longer list would fail its check.
HISTORY_LIMIT = 8
_MEDIA_FILTER = "Images and videos (*.png *.jpg *.jpeg *.gif *.webp *.mp4 *.m4v *.mov *.webm)"


class WallpaperService:
    def __init__(self, host: Host, settings: SettingsService, store: Any) -> None:
        self._host = host
        self._settings = settings
        self._store = store

    def media(self) -> tuple[str, str] | None:
        """Address and type of the user's file, as Anki's own pages reach it."""
        asset = self._settings.get()["wallpaper"]["asset"]
        address = None if asset is None else self._store.media_url(asset["id"])
        if asset is None or address is None:
            return None
        return self._host.shared_media_url(Path(address).name), asset["type"]

    def choose(self, finish: Callable[[Any], None], fail: Callable[[Exception], None]) -> None:
        self._take(self._host.pick_path(_MEDIA_FILTER), finish, fail)

    def dropped(self, finish: Callable[[Any], None], fail: Callable[[Exception], None]) -> None:
        self._take(self._host.take_dropped_file(), finish, fail)

    def _take(
        self,
        source: Path | None,
        finish: Callable[[Any], None],
        fail: Callable[[Exception], None],
    ) -> None:
        if source is None:
            finish(self._settings.get())
            return
        self._host.run_task(
            lambda: self._store.add_file(source, self._host.convert_video),
            lambda asset: finish(self._use(asset)),
            fail,
        )

    def _use(self, asset: Any) -> SettingsGetResult:
        updated = self._set(
            source="image", asset=asset, enabled=True, history=self._remembered(asset)
        )
        # Whatever fell out of the history is deleted, unless a widget still shows it.
        self._store.remove_unused_media()
        # A new file can leave every setting unchanged, so no listener would notice it.
        self._host.refresh_deck_browser()
        return updated

    def _remembered(self, asset: Any) -> list[Any]:
        history = self._settings.get()["wallpaper"]["history"]
        others = [entry for entry in history if entry["id"] != asset["id"]]
        return [asset, *others][:HISTORY_LIMIT]

    def use(self, asset_id: str) -> SettingsGetResult:
        history = self._settings.get()["wallpaper"]["history"]
        asset = next((entry for entry in history if entry["id"] == asset_id), None)
        if asset is None:
            raise InvalidParams("This wallpaper is no longer stored.")
        return self._use(asset)

    def forget(self, asset_id: str) -> SettingsGetResult:
        wallpaper = self._settings.get()["wallpaper"]
        history = [entry for entry in wallpaper["history"] if entry["id"] != asset_id]
        current = wallpaper["asset"] is not None and wallpaper["asset"]["id"] == asset_id
        if current:
            updated = self._set(source="none", asset=None, enabled=False, history=history)
            self._host.refresh_deck_browser()
        else:
            updated = self._set(history=history)
        self._store.remove_unused_media()
        return updated

    def remove(self) -> SettingsGetResult:
        """No wallpaper anymore. Its file stays in the history, so it can come back."""
        updated = self._set(source="none", asset=None, enabled=False)
        path = self._host.data_folder() / _OLD_FILE
        if not path.is_symlink():
            path.unlink(missing_ok=True)
        return updated

    def adopt_old_image(self) -> None:
        """Images used to lie next to the settings. One from back then moves over, once."""
        path = self._host.data_folder() / _OLD_FILE
        wallpaper = self._settings.get()["wallpaper"]
        waiting = wallpaper["source"] == "image" and wallpaper["asset"] is None
        if not waiting or path.is_symlink() or not path.is_file():
            return
        try:
            asset = self._store.add_media(path.read_bytes())
        except (OSError, ValueError, NotAllowed):
            logger.exception("Statly could not take over an earlier wallpaper")
            return
        self._set(asset=asset, history=self._remembered(asset))
        path.unlink()

    def _set(self, **changes: Any) -> SettingsGetResult:
        wallpaper = {**self._settings.get()["wallpaper"], **changes}
        return self._settings.update(cast(SettingsUpdateParams, {"wallpaper": wallpaper}))


class WallpaperModule:
    def register(self, context: Context) -> None:
        service = WallpaperService(context.host, context.settings, context.services["widgets"])
        context.services["wallpaper"] = service

        def choose(
            _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
        ) -> None:
            service.choose(finish, fail)

        def dropped(
            _params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
        ) -> None:
            service.dropped(finish, fail)

        context.router.deferred("wallpaper.choose", choose)
        context.router.deferred("wallpaper.dropped", dropped)
        context.router.local("wallpaper.remove", lambda _params: service.remove())
        context.router.local("wallpaper.use", lambda params: service.use(params["id"]))
        context.router.local("wallpaper.forget", lambda params: service.forget(params["id"]))
        context.host.on_profile_opened(service.adopt_old_image)
