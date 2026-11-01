"""Remembers results until the collection changes."""

from __future__ import annotations

import json
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from ...core.reader import CollectionReader

_MAX_ENTRIES = 256

type Handler = Callable[[Any, CollectionReader], Any]


class ResultCache:
    """Used only from Anki's single worker, except for ``clear``, which is atomic."""

    def __init__(self) -> None:
        self._entries: OrderedDict[tuple[Any, ...], Any] = OrderedDict()

    def clear(self) -> None:
        self._entries = OrderedDict()

    def wrap(self, name: str, handler: Handler) -> Handler:
        def cached(params: Any, reader: CollectionReader) -> Any:
            # col.mod alone misses day changes and writes that bypass it, and undo can
            # bring back an older value. Together these describe the state exactly enough.
            key = (
                name,
                json.dumps(params, sort_keys=True),
                reader.modified,
                reader.scalar("SELECT MAX(id) FROM revlog"),
                reader.today,
                reader.day_cutoff,
            )
            entries = self._entries
            if key in entries:
                entries.move_to_end(key)
                return entries[key]
            result = handler(params, reader)
            entries[key] = result
            if len(entries) > _MAX_ENTRIES:
                entries.popitem(last=False)
            return result

        return cached
