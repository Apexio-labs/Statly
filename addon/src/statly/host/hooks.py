"""Keeps a Statly failure from ever breaking Anki itself."""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import Any

logger = logging.getLogger(__name__)


def guarded[**P](handler: Callable[P, None]) -> Callable[P, None]:
    """Wrap a hook handler so its exceptions are logged instead of reaching Anki."""

    @wraps(handler)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> None:
        try:
            handler(*args, **kwargs)
        except Exception:
            logger.exception("Statly hook %s failed", handler.__name__)

    return wrapper


def guarded_filter(handler: Callable[..., object]) -> Callable[..., Any]:
    """Wrap a filter so that it always hands Anki's value back unchanged, even when it fails.

    Statly only watches filters. ``guarded`` would return None from a failing filter, which Anki
    would take as the new value: for the answer filter that would stop the answer.
    """

    @wraps(handler)
    def wrapper(value: Any, *rest: Any) -> Any:
        try:
            handler(value, *rest)
        except Exception:
            logger.exception("Statly filter %s failed", handler.__name__)
        return value

    return wrapper
