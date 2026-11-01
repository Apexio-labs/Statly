"""The custom background image of Anki's deck overview."""

from __future__ import annotations

import base64
from pathlib import Path

from ...contract.types import WallpaperPreviewResult
from ...core.module import Context, Host
from ...core.settings import SettingsService

_FILE = "wallpaper.jpg"
MAX_STORED_BYTES = 20 * 1024 * 1024


def image_path(host: Host) -> Path:
    return host.data_folder() / _FILE


def image_data_url(host: Host) -> str | None:
    path = image_path(host)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_STORED_BYTES:
        return None
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


class WallpaperService:
    def __init__(self, host: Host, settings: SettingsService) -> None:
        self._host = host
        self._settings = settings

    def preview(self) -> WallpaperPreviewResult:
        return {"image": image_data_url(self._host)}

    def choose(self) -> WallpaperPreviewResult:
        if self._host.choose_wallpaper(image_path(self._host)):
            wallpaper = {**self._settings.get()["wallpaper"], "source": "image", "enabled": True}
            self._settings.update({"wallpaper": wallpaper})  # type: ignore[typeddict-item]
            # A new image can leave every setting unchanged, so no listener would notice it.
            self._host.refresh_deck_browser()
        return self.preview()

    def remove(self) -> WallpaperPreviewResult:
        path = image_path(self._host)
        if not path.is_symlink():
            path.unlink(missing_ok=True)
        wallpaper = {**self._settings.get()["wallpaper"], "source": "none", "enabled": False}
        self._settings.update({"wallpaper": wallpaper})  # type: ignore[typeddict-item]
        return self.preview()


class WallpaperModule:
    def register(self, context: Context) -> None:
        service = WallpaperService(context.host, context.settings)
        context.router.local("wallpaper.preview", lambda _params: service.preview())
        context.router.local("wallpaper.choose", lambda _params: service.choose())
        context.router.local("wallpaper.remove", lambda _params: service.remove())
