"""Decides when to ask for a rating. All numbers stay on this device.

People rate a tool they already like, so the request waits for signs of that. While Statly has few
users, ``EARLY_PHASE`` asks much sooner, because every rating helps most at that point. Set it to
False once AnkiWeb shows enough ratings.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, cast

from ...contract.types import FeedbackAnswerParams, FeedbackVisitResult
from ...core.module import Context
from ...core.storage import JsonStore

EARLY_PHASE = True
EARLY_ACTIVE_DAYS = 2
USUAL_ACTIVE_DAYS = 10
ASK_AGAIN_AFTER_DAYS = 30
MAX_REQUESTS = 3

_FILE = "usage"


def should_ask(usage: dict[str, Any], today: date, *, early_phase: bool = EARLY_PHASE) -> bool:
    if usage.get("answer") in ("rate", "never") or usage.get("requests", 0) >= MAX_REQUESTS:
        return False
    last_request = usage.get("lastRequest")
    if last_request and today - date.fromisoformat(last_request) < timedelta(
        days=ASK_AGAIN_AFTER_DAYS
    ):
        return False
    active_days = usage.get("activeDays", 0)
    if early_phase:
        return active_days >= EARLY_ACTIVE_DAYS
    return active_days >= USUAL_ACTIVE_DAYS and bool(usage.get("customized"))


class Usage:
    def __init__(self, store: JsonStore) -> None:
        self._store = store

    def _read(self) -> dict[str, Any]:
        stored: Any = self._store.read(_FILE)
        return cast(dict[str, Any], stored) if isinstance(stored, dict) else {}

    def visit(self, today: date) -> FeedbackVisitResult:
        usage = self._read()
        if usage.get("lastDay") != today.isoformat():
            usage["lastDay"] = today.isoformat()
            usage["activeDays"] = usage.get("activeDays", 0) + 1
        ask = should_ask(usage, today)
        if ask:
            usage["lastRequest"] = today.isoformat()
            usage["requests"] = usage.get("requests", 0) + 1
        self._store.write(_FILE, usage)
        return {"askRating": ask}

    def answer(self, params: FeedbackAnswerParams) -> None:
        self._store.write(_FILE, {**self._read(), "answer": params["choice"]})

    def mark_customized(self) -> None:
        """Arranging a dashboard is the clearest sign that someone likes Statly."""
        self._store.write(_FILE, {**self._read(), "customized": True})


class FeedbackModule:
    def register(self, context: Context) -> None:
        usage = Usage(JsonStore(context.host.data_folder))

        def visit(_params: Any) -> FeedbackVisitResult:
            return usage.visit(date.today())

        def layout_saved(_layout: Any) -> None:
            usage.mark_customized()

        context.router.local("feedback.visit", visit)
        context.router.local("feedback.answer", usage.answer)
        context.events.subscribe("dashboard.saved", layout_saved)
