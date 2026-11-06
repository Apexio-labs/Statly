"""Opens the share sheet of the system.

Only macOS is covered. Its sheet can be reached with a few plain calls into the Objective-C runtime.
Windows would need a hand-written COM object, and a mistake there would take all of Anki down, so
callers fall back to the clipboard everywhere else.
"""

from __future__ import annotations

import ctypes
import logging
import sys
from collections.abc import Mapping
from ctypes import c_char_p, c_double, c_ulong, c_void_p
from typing import Any

from aqt.qt import QPoint, QWidget

logger = logging.getLogger(__name__)

_LIBRARY = "/usr/lib/libobjc.A.dylib"
_APPKIT = "/System/Library/Frameworks/AppKit.framework/AppKit"
_EDGE_BELOW = 3


class _Rect(ctypes.Structure):
    _fields_ = (
        ("x", c_double),
        ("y", c_double),
        ("width", c_double),
        ("height", c_double),
    )


def _open_mac_sheet(view: int, text: str, url: str, rect: _Rect) -> None:
    runtime = ctypes.CDLL(_LIBRARY)
    ctypes.CDLL(_APPKIT)
    runtime.objc_getClass.restype = c_void_p
    runtime.objc_getClass.argtypes = (c_char_p,)
    runtime.sel_registerName.restype = c_void_p
    runtime.sel_registerName.argtypes = (c_char_p,)

    def send(
        target: Any, selector: bytes, *arguments: Any, kinds: Any = (), result: Any = c_void_p
    ) -> Any:
        message = ctypes.CFUNCTYPE(result, c_void_p, c_void_p, *kinds)(("objc_msgSend", runtime))
        return message(target, runtime.sel_registerName(selector), *arguments)

    def text_object(value: str) -> Any:
        return send(
            runtime.objc_getClass(b"NSString"),
            b"stringWithUTF8String:",
            value.encode(),
            kinds=(c_char_p,),
        )

    link = send(
        runtime.objc_getClass(b"NSURL"), b"URLWithString:", text_object(url), kinds=(c_void_p,)
    )
    if not link:
        raise ValueError("This link cannot be shared.")
    items = (c_void_p * 2)(text_object(text), link)
    array = send(
        runtime.objc_getClass(b"NSArray"),
        b"arrayWithObjects:count:",
        items,
        2,
        kinds=(c_void_p, c_ulong),
    )
    allocated = send(runtime.objc_getClass(b"NSSharingServicePicker"), b"alloc")
    picker = send(allocated, b"initWithItems:", array, kinds=(c_void_p,))
    # It stays alive on purpose: the sheet is still open long after this call has returned.
    send(
        picker,
        b"showRelativeToRect:ofView:preferredEdge:",
        rect,
        view,
        _EDGE_BELOW,
        kinds=(_Rect, c_void_p, c_ulong),
        result=None,
    )


def show_share_sheet(window: QWidget, text: str, url: str, anchor: Mapping[str, float]) -> bool:
    """``anchor`` is the button in page pixels, which window coordinates match on a Mac."""
    if sys.platform != "darwin":
        return False
    web: Any = getattr(window, "web", None)
    zoom = web.zoomFactor() if web is not None else 1
    corner = QPoint(int(anchor["x"] * zoom), int(anchor["y"] * zoom))
    if web is not None:
        corner = web.mapTo(window, corner)
    rect = _Rect(corner.x(), corner.y(), anchor["width"] * zoom, anchor["height"] * zoom)
    try:
        _open_mac_sheet(int(window.winId()), text, url, rect)
    except (OSError, AttributeError, ValueError):
        logger.exception("Statly could not open the share sheet")
        return False
    return True
