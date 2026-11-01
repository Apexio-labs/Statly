"""Keeps a Statly failure from ever breaking Anki itself."""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps

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
