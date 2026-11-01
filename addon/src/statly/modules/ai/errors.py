"""Failures the chat can explain to the user."""

from __future__ import annotations

import re

_KEY_LIKE = re.compile(r"\b(?:sk|pk|rk|key|or)-[A-Za-z0-9_\-]{8,}")
_MAX_DETAIL = 300
_NO_CREDIT = ("credit", "quota", "billing", "insufficient")
_CONTEXT_FULL = ("context length", "context_length", "maximum context", "n_ctx", "too many tokens")


class AiError(Exception):
    """``code`` picks the explanation. ``detail`` is scrubbed text from the service."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def is_out_of_credit(detail: str) -> bool:
    text = detail.lower()
    return any(word in text for word in _NO_CREDIT)


def is_context_full(detail: str) -> bool:
    text = detail.lower()
    return any(phrase in text for phrase in _CONTEXT_FULL)


class Stopped(Exception):
    """The user stopped the answer."""


def scrub(text: str, key: str | None) -> str:
    """A service may repeat what it was sent, and that must never surface anywhere."""
    cleaned = text.replace(key, "[key]") if key else text
    return _KEY_LIKE.sub("[key]", cleaned)[:_MAX_DETAIL]
