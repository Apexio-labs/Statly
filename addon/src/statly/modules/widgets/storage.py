"""Custom widgets and their media files, kept in the profile folder."""

from __future__ import annotations

import logging
import os
import re
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ...contract.types import WidgetsSaveResult
from ...core.contract import Contract
from ...core.errors import InvalidParams, NotAllowed
from ...core.storage import JsonStore
from .media import (
    MAX_PROFILE_WIDGET_MEDIA_BYTES,
    MEDIA_TYPES,
    inspect_widget_media,
    set_gif_loop,
)

logger = logging.getLogger(__name__)

MAX_WIDGETS = 100
MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024
VIDEO_SUFFIXES = frozenset({".mov", ".mp4", ".m4v", ".webm", ".avi", ".mkv"})
_FOLDER = "custom_widgets"
_ID = re.compile(r"^[a-z0-9-]{1,40}$")
_ASSET_ID = re.compile(r"^[0-9a-f]{64}$")


def check_size(size: Any) -> None:
    """Minimum, default and maximum must make sense together."""
    minimum_w, maximum_w = size.get("minW", 2), size.get("maxW", 12)
    minimum_h, maximum_h = size.get("minH", 2), size.get("maxH", 16)
    if not minimum_w <= size["w"] <= maximum_w or not minimum_h <= size["h"] <= maximum_h:
        raise InvalidParams("The size must lie between the minimum and the maximum.")


def size_rules(widget: Any) -> dict[str, int]:
    size = widget["size"]
    return {
        "minW": size.get("minW", 2),
        "maxW": size.get("maxW", 12),
        "minH": size.get("minH", 2),
        "maxH": size.get("maxH", 16),
    }


def media_references(widget: Any) -> dict[str, str]:
    """Every media file a widget uses, as asset id and media type."""
    assets: list[Any] = [element["asset"] for element in widget["elements"] if "asset" in element]
    if "asset" in widget["background"]:
        assets.append(widget["background"]["asset"])
    return {asset["id"]: asset["type"] for asset in assets}


class WidgetStore:
    def __init__(
        self,
        data_folder: Callable[[], Path],
        contract: Contract,
        media_folder: Callable[[], Path],
        media_url: Callable[[str], str],
        media_in_use: Callable[[], set[str]] = set,
    ) -> None:
        self._media_in_use = media_in_use
        self._data_folder = data_folder
        self._contract = contract
        self._media_folder = media_folder
        self._media_url = media_url
        self._json = JsonStore(self._folder)

    def _folder(self) -> Path:
        return self._data_folder() / _FOLDER

    def list(self) -> list[WidgetsSaveResult]:
        """Return every readable widget. One damaged file must not hide all the others."""
        folder = self._folder()
        if not folder.is_dir():
            return []
        widgets: list[WidgetsSaveResult] = []
        for path in sorted(folder.glob("*.json")):
            stored: Any = self._json.read(path.stem)
            try:
                self._contract.check_result("widgets.save", stored)
            except ValueError:
                continue
            widgets.append(stored)
        return sorted(widgets, key=lambda widget: widget["name"].lower())

    def get(self, widget_id: str) -> WidgetsSaveResult | None:
        return next((widget for widget in self.list() if widget["id"] == widget_id), None)

    def put(self, widget: WidgetsSaveResult) -> WidgetsSaveResult:
        if self.get(widget["id"]) is None and len(self.list()) >= MAX_WIDGETS:
            raise NotAllowed("You have reached the limit of 100 widgets.")
        check_size(widget["size"])
        ids = [element["id"] for element in widget["elements"]]
        if len(set(ids)) != len(ids):
            raise InvalidParams("Element ids must be unique.")
        for asset_id, media_type in media_references(widget).items():
            if not self.has_media(asset_id, media_type):
                raise InvalidParams("A media file of this widget is missing.")
        self._json.write(widget["id"], widget)
        return widget

    def delete(self, widget_id: str) -> None:
        if _ID.fullmatch(widget_id) is None:
            raise InvalidParams("This is not a widget id.")
        (self._folder() / f"{widget_id}.json").unlink(missing_ok=True)
        self.remove_unused_media()

    def _media_path(self, asset_id: str, media_type: str) -> Path:
        return self._media_folder() / f"{asset_id}.{MEDIA_TYPES[media_type]}"

    def has_media(self, asset_id: str, media_type: str) -> bool:
        path = self._media_path(asset_id, media_type)
        return path.is_file() and not path.is_symlink()

    def add_file(self, source: Path, convert: Callable[[Path, Path], None]) -> dict[str, str]:
        """Store an image or video the user chose. Runs in the background: this can take long."""
        if source.stat().st_size > MAX_SOURCE_BYTES:
            raise NotAllowed("This file is too large.")
        data: bytes
        if source.suffix.lower() in VIDEO_SUFFIXES:
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "video.webm"
                convert(source, target)
                data = target.read_bytes()
        else:
            data = source.read_bytes()
            if data.startswith((b"GIF87a", b"GIF89a")):
                data = set_gif_loop(data, True)
        try:
            return self.add_media(data)
        except ValueError as error:
            raise InvalidParams(str(error)) from None

    def set_gif_loop(self, asset_id: str, loop: bool) -> dict[str, str]:
        media = self.read_media(asset_id)
        if media is None or media[0] != "image/gif":
            raise InvalidParams("This is not a GIF.")
        return self.add_media(set_gif_loop(media[1], loop))

    def add_media(self, data: bytes) -> dict[str, str]:
        """Check a file by its actual content and store it under its own hash."""
        asset_id, media_type, _extension = inspect_widget_media(data)
        target = self._media_path(asset_id, media_type)
        if target.exists():
            return {"id": asset_id, "type": media_type}
        folder = self._media_folder()
        folder.mkdir(parents=True, exist_ok=True)
        used = sum(path.stat().st_size for path in folder.iterdir() if path.is_file())
        if used + len(data) > MAX_PROFILE_WIDGET_MEDIA_BYTES:
            raise NotAllowed("Your widgets may use 2 GB of media in total.")
        descriptor, temporary = tempfile.mkstemp(dir=folder)
        try:
            with os.fdopen(descriptor, "wb", buffering=0) as file:
                file.write(data)
                os.fsync(file.fileno())
            os.replace(temporary, target)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return {"id": asset_id, "type": media_type}

    def read_media(self, asset_id: str) -> tuple[str, bytes] | None:
        if _ASSET_ID.fullmatch(asset_id) is None:
            return None
        for media_type in MEDIA_TYPES:
            path = self._media_path(asset_id, media_type)
            if path.is_file() and not path.is_symlink():
                return media_type, path.read_bytes()
        return None

    def media_url(self, asset_id: str) -> str | None:
        """Files are served directly, so large videos load at once and stream."""
        if _ASSET_ID.fullmatch(asset_id) is None:
            return None
        for media_type in MEDIA_TYPES:
            path = self._media_path(asset_id, media_type)
            if path.is_file() and not path.is_symlink():
                return self._media_url(path.name)
        return None

    def remove_unused_media(self) -> None:
        folder = self._media_folder()
        if not folder.is_dir():
            return
        used = self._media_in_use()
        for widget in self.list():
            used.update(media_references(widget))
        for path in folder.iterdir():
            if path.is_file() and not path.is_symlink() and path.stem not in used:
                try:
                    path.unlink()
                except OSError:
                    # Windows keeps a file that is still shown, such as the old wallpaper on
                    # Anki's deck overview. It goes the next time something is cleaned up.
                    logger.info("Statly will remove %s later", path.name)
