"""Statly's own files in the profile folder. They never touch the collection."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .errors import NotAllowed

logger = logging.getLogger(__name__)


class JsonStore:
    """Reads and writes JSON files. A write either fully happens or not at all."""

    def __init__(self, folder: Callable[[], Path]) -> None:
        self._folder = folder

    def read(self, name: str) -> Any | None:
        """Return the stored value, or None if it is missing or damaged."""
        path = self._path(name)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            logger.exception("Statly could not read %s", path)
            self._set_aside(path)
            return None

    def write(self, name: str, value: Any) -> None:
        path = self._path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
        try:
            content = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
            with os.fdopen(descriptor, "wb", buffering=0) as file:
                file.write(content)
                os.fsync(file.fileno())
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def remove(self, name: str) -> None:
        self._path(name).unlink(missing_ok=True)

    def _path(self, name: str) -> Path:
        path = self._folder() / f"{name}.json"
        if path.is_symlink():
            raise NotAllowed(f"{path.name} must not be a link.")
        return path

    def _set_aside(self, path: Path) -> None:
        """Keep a damaged file for inspection, so the next write cannot destroy it."""
        try:
            os.replace(path, path.with_suffix(".damaged"))
        except OSError:
            logger.exception("Statly could not set aside %s", path)
