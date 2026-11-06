"""Brings study goals to the person's other computers through Anki's normal sync.

Each computer keeps one entry of its own in the collection's settings, ``statly.goals.<device>``,
and only ever writes that one, so two computers never overwrite each other. Anki syncs such
settings like any other change, without a full sync, and writing them leaves the undo history as
it is (measured on Anki 25.09.4 and 26.09.3). Nothing else is touched: no card, note, deck or
option.

Anki does not pass the removal of a setting on to other computers, so switching off writes an
"off" entry instead of removing it.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ...core.errors import InvalidParams

PERMISSION = "goals.sync"
KEY_PREFIX = "statly.goals."
# Anki asks add-ons to keep their settings small, so one computer's entry stays below this.
MAX_BYTES = 8_000


def key_of(device: str) -> str:
    return f"{KEY_PREFIX}{device}"


def size_of(state: Mapping[str, Any]) -> int:
    return len(json.dumps(state, separators=(",", ":"), ensure_ascii=False).encode())


def write_state(collection: Any, device: str, state: Mapping[str, Any]) -> bool:
    """Write this computer's entry if it changed. Returns whether it wrote."""
    if size_of(state) > MAX_BYTES:
        raise InvalidParams("The goals are too large to sync.")
    key = key_of(device)
    if collection.get_config(key, None) == state:
        return False
    collection.set_config(key, dict(state))
    return True


def switch_off(collection: Any, device: str) -> None:
    """Tell the other computers that this one shares nothing any more."""
    collection.set_config(key_of(device), {"v": 1, "device": device, "off": True})
