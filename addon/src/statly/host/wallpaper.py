"""Reads a user's image and stores a resized copy."""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from aqt.qt import QFileDialog, QImage, QImageReader, QImageWriter, QSize, Qt, QWidget
from aqt.utils import showWarning

logger = logging.getLogger(__name__)

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_SIZE = QSize(1920, 1280)
_JPEG_QUALITY = 88


def _load(source: Path) -> QImage:
    if source.stat().st_size > MAX_BYTES:
        raise ValueError("The image is larger than 20 MB.")
    reader = QImageReader(str(source))
    reader.setAutoTransform(True)
    size = reader.size()
    if not size.isValid() or size.width() * size.height() > MAX_PIXELS:
        raise ValueError("The image is larger than 40 megapixels or cannot be read.")
    if size.width() > MAX_SIZE.width() or size.height() > MAX_SIZE.height():
        reader.setScaledSize(size.scaled(MAX_SIZE, Qt.AspectRatioMode.KeepAspectRatio))
    image = reader.read()
    if image.isNull():
        raise ValueError(f"The image cannot be read: {reader.errorString()}")
    return image.convertToFormat(QImage.Format.Format_RGB32)


def choose_wallpaper(parent: QWidget | None, destination: Path) -> bool:
    """Ask for an image and store it. Returns whether a new image was stored."""
    filename, _ = QFileDialog.getOpenFileName(
        parent, "Statly", str(Path.home()), "Images (*.png *.jpg *.jpeg *.webp)"
    )
    if not filename:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=destination.parent, suffix=".jpg")
    os.close(descriptor)
    try:
        writer = QImageWriter(temporary, b"jpeg")
        writer.setQuality(_JPEG_QUALITY)
        if not writer.write(_load(Path(filename))):
            raise OSError(f"The image could not be saved: {writer.errorString()}")
        os.replace(temporary, destination)
    except (OSError, ValueError) as error:
        logger.exception("Statly could not store a wallpaper")
        Path(temporary).unlink(missing_ok=True)
        showWarning(str(error), parent=parent)
        return False
    return True
