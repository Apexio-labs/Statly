"""Earlier conversations. Only the short list is read at once, each chat when it is opened."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from ...core.storage import JsonStore

_FOLDER = "ai-chats"
_INDEX = "index"
_MAX_CHATS = 40
_NAME_CHARS = "0123456789abcdef"


class ChatHistory:
    def __init__(self, data_folder: Callable[[], Path]) -> None:
        self._store = JsonStore(lambda: data_folder() / _FOLDER)

    def list(self) -> list[dict[str, str]]:
        stored: Any = self._store.read(_INDEX)
        return cast(list[dict[str, str]], stored) if isinstance(stored, list) else []

    def read(self, chat_id: str) -> dict[str, Any] | None:
        if not chat_id or set(chat_id) - set(_NAME_CHARS):
            return None
        stored: Any = self._store.read(chat_id)
        return cast(dict[str, Any], stored) if isinstance(stored, dict) else None

    def put(self, chat: dict[str, Any]) -> None:
        entry = {key: chat[key] for key in ("id", "title", "updatedAt")}
        others = [item for item in self.list() if item["id"] != chat["id"]]
        kept = [entry, *others]
        self._store.write(chat["id"], chat)
        for old in kept[_MAX_CHATS:]:
            self._store.remove(old["id"])
        self._store.write(_INDEX, kept[:_MAX_CHATS])

    def delete(self, chat_id: str) -> None:
        if self.read(chat_id) is not None:
            self._store.remove(chat_id)
        self._store.write(_INDEX, [item for item in self.list() if item["id"] != chat_id])

    def clear(self) -> None:
        for item in self.list():
            self._store.remove(item["id"])
        self._store.write(_INDEX, [])
