"""Decides when to ask for a rating or a recommendation. All numbers stay on this device.

People rate a tool they already like, so the request waits for signs of that. While Statly has few
users, ``EARLY_PHASE`` asks much sooner, because every rating helps most at that point. Set it to
False once AnkiWeb shows enough ratings.

Recommending asks for more than a rating does, so that request waits for weeks of real use and
keeps its distance from the other one.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, cast

from ...contract.types import (
    FeedbackAnswerParams,
    FeedbackAnswerShareParams,
    FeedbackVisitResult,
)
from ...core.module import Context
from ...core.storage import JsonStore

EARLY_PHASE = True
EARLY_ACTIVE_DAYS = 2
USUAL_ACTIVE_DAYS = 10
ASK_AGAIN_AFTER_DAYS = 30
MAX_REQUESTS = 3
SHARE_AFTER_DAYS = 30
SHARE_ACTIVE_DAYS = 14
SHARE_ASK_AGAIN_AFTER_DAYS = 60
SHARE_MAX_REQUESTS = 2
DAYS_BETWEEN_REQUESTS = 7

_FILE = "usage"


def _within(usage: dict[str, Any], key: str, today: date, days: int) -> bool:
    earlier = usage.get(key)
    return bool(earlier) and today - date.fromisoformat(earlier) < timedelta(days=days)


def should_ask(usage: dict[str, Any], today: date, *, early_phase: bool = EARLY_PHASE) -> bool:
    if usage.get("answer") in ("rate", "never") or usage.get("requests", 0) >= MAX_REQUESTS:
        return False
    if _within(usage, "lastRequest", today, ASK_AGAIN_AFTER_DAYS):
        return False
    if _within(usage, "lastShareRequest", today, DAYS_BETWEEN_REQUESTS):
        return False
    active_days = usage.get("activeDays", 0)
    if early_phase:
        return active_days >= EARLY_ACTIVE_DAYS
    return active_days >= USUAL_ACTIVE_DAYS and bool(usage.get("customized"))


def should_ask_to_share(usage: dict[str, Any], today: date) -> bool:
    if usage.get("shareAnswer") in ("share", "never"):
        return False
    if usage.get("shareRequests", 0) >= SHARE_MAX_REQUESTS:
        return False
    if usage.get("activeDays", 0) < SHARE_ACTIVE_DAYS:
        return False
    if _within(usage, "firstDay", today, SHARE_AFTER_DAYS):
        return False
    if _within(usage, "lastShareRequest", today, SHARE_ASK_AGAIN_AFTER_DAYS):
        return False
    return not _within(usage, "lastRequest", today, DAYS_BETWEEN_REQUESTS)


class Usage:
    def __init__(self, store: JsonStore) -> None:
        self._store = store

    def _read(self) -> dict[str, Any]:
        stored: Any = self._store.read(_FILE)
        return cast(dict[str, Any], stored) if isinstance(stored, dict) else {}

    def visit(self, today: date) -> FeedbackVisitResult:
        usage = self._read()
        usage.setdefault("firstDay", today.isoformat())
        if usage.get("lastDay") != today.isoformat():
            usage["lastDay"] = today.isoformat()
            usage["activeDays"] = usage.get("activeDays", 0) + 1
        ask = should_ask(usage, today)
        if ask:
            usage["lastRequest"] = today.isoformat()
            usage["requests"] = usage.get("requests", 0) + 1
        share = should_ask_to_share(usage, today)
        if share:
            usage["lastShareRequest"] = today.isoformat()
            usage["shareRequests"] = usage.get("shareRequests", 0) + 1
        self._store.write(_FILE, usage)
        return {"askRating": ask, "askShare": share}

    def answer(self, params: FeedbackAnswerParams) -> None:
        self._store.write(_FILE, {**self._read(), "answer": params["choice"]})

    def answer_share(self, params: FeedbackAnswerShareParams) -> None:
        self._store.write(_FILE, {**self._read(), "shareAnswer": params["choice"]})

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
        context.router.local("feedback.answerShare", usage.answer_share)
        context.events.subscribe("dashboard.saved", layout_saved)
