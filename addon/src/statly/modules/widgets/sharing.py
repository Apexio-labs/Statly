"""Widget packages: a ZIP with the definition and its media. Packages can come from strangers."""

from __future__ import annotations

import json
import stat
import zlib
from io import BytesIO
from typing import Any, cast
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile, ZipInfo

from ...core.contract import Contract
from ...core.errors import InvalidParams
from .media import (
    MAX_WIDGET_MEDIA_ASSETS,
    MAX_WIDGET_MEDIA_FILE_BYTES,
    MAX_WIDGET_MEDIA_TOTAL_BYTES,
    MEDIA_TYPES,
    inspect_widget_media,
)
from .storage import media_references

PACKAGE_FORMAT = "statly-widget"
PACKAGE_VERSION = 2
PACKAGE_EXTENSION = "statlywidget"
MAX_MANIFEST_BYTES = 1_000_000
MAX_PACKAGE_BYTES = MAX_WIDGET_MEDIA_TOTAL_BYTES + 2_000_000
_MANIFEST = "manifest.json"


def export_package(widget: Any, media: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        manifest = {"format": PACKAGE_FORMAT, "version": PACKAGE_VERSION, "widget": widget}
        archive.writestr(_MANIFEST, json.dumps(manifest), compress_type=ZIP_DEFLATED)
        for asset_id, media_type in media_references(widget).items():
            name = f"media/{asset_id}.{MEDIA_TYPES[media_type]}"
            archive.writestr(name, media[asset_id], compress_type=ZIP_STORED)
    return buffer.getvalue()


def _read_entry(archive: ZipFile, entry: ZipInfo, limit: int) -> bytes:
    """Read no more than ``limit`` bytes, whatever size the archive claims."""
    with archive.open(entry, "r") as stream:
        content = stream.read(limit + 1)
    if len(content) > limit or len(content) != entry.file_size:
        raise InvalidParams("A file in this package is too large.")
    return content


def _checked_entries(archive: ZipFile) -> tuple[ZipInfo, dict[str, ZipInfo]]:
    entries = archive.infolist()
    if not 1 <= len(entries) <= MAX_WIDGET_MEDIA_ASSETS + 1:
        raise InvalidParams("This package has too many files.")
    if len({entry.filename for entry in entries}) != len(entries):
        raise InvalidParams("This package has duplicate files.")
    for entry in entries:
        if entry.is_dir() or entry.flag_bits & 0x1 or stat.S_ISLNK(entry.external_attr >> 16):
            raise InvalidParams("This package contains unsafe files.")
    manifests = [entry for entry in entries if entry.filename == _MANIFEST]
    if len(manifests) != 1 or manifests[0].file_size > MAX_MANIFEST_BYTES:
        raise InvalidParams("This package has no usable manifest.")
    media: dict[str, ZipInfo] = {}
    total = 0
    for entry in entries:
        if entry is manifests[0]:
            continue
        name = entry.filename.removeprefix("media/")
        if (
            name == entry.filename
            or "/" in name
            or "\\" in name
            or entry.compress_type != ZIP_STORED
            or entry.file_size > MAX_WIDGET_MEDIA_FILE_BYTES
        ):
            raise InvalidParams("This package contains invalid media.")
        media[name] = entry
        total += entry.file_size
    if total > MAX_WIDGET_MEDIA_TOTAL_BYTES:
        raise InvalidParams("This package is too large.")
    return manifests[0], media


def read_package(package: bytes, contract: Contract) -> tuple[Any, dict[str, bytes]]:
    """Return a checked widget and its media, or raise ``InvalidParams``."""
    if not package or len(package) > MAX_PACKAGE_BYTES:
        raise InvalidParams("This package is empty or too large.")
    try:
        with ZipFile(BytesIO(package), "r") as archive:
            manifest_entry, media_entries = _checked_entries(archive)
            manifest_bytes = _read_entry(archive, manifest_entry, MAX_MANIFEST_BYTES)
            raw_media = {
                name: _read_entry(archive, entry, MAX_WIDGET_MEDIA_FILE_BYTES)
                for name, entry in media_entries.items()
            }
    except (BadZipFile, EOFError, NotImplementedError, OSError, RuntimeError, zlib.error):
        raise InvalidParams("This is not a Statly widget package.") from None
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise InvalidParams("This package has an unreadable manifest.") from None
    document: Any = manifest
    if (
        not isinstance(document, dict)
        or document.get("format") != PACKAGE_FORMAT
        or document.get("version") != PACKAGE_VERSION
        or "widget" not in document
    ):
        raise InvalidParams("This package format is not supported.")

    widget = cast(Any, document)["widget"]
    try:
        contract.check_result("widgets.save", widget)
    except ValueError:
        raise InvalidParams("This package contains an invalid widget.") from None

    references = media_references(widget)
    expected = {f"{asset}.{MEDIA_TYPES[kind]}" for asset, kind in references.items()}
    if set(raw_media) != expected:
        raise InvalidParams("The media in this package does not match the widget.")
    assets: dict[str, bytes] = {}
    for asset_id, media_type in references.items():
        data = raw_media[f"{asset_id}.{MEDIA_TYPES[media_type]}"]
        try:
            actual_id, actual_type, _extension = inspect_widget_media(data)
        except ValueError:
            raise InvalidParams("This package contains an invalid media file.") from None
        if actual_id != asset_id or actual_type != media_type:
            raise InvalidParams("A media file in this package does not match the widget.")
        assets[asset_id] = data
    return widget, assets
