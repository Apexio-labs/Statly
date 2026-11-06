from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from statly.contract.types import FeedbackVisitResult
from statly.core.storage import JsonStore
from statly.modules.feedback import (
    DAYS_BETWEEN_REQUESTS,
    MAX_REQUESTS,
    SHARE_ACTIVE_DAYS,
    SHARE_AFTER_DAYS,
    SHARE_ASK_AGAIN_AFTER_DAYS,
    SHARE_MAX_REQUESTS,
    Usage,
    should_ask,
    should_ask_to_share,
)

DAY = date(2026, 11, 1)


def test_early_phase_asks_on_the_second_active_day() -> None:
    assert should_ask({"activeDays": 1}, DAY, early_phase=True) is False
    assert should_ask({"activeDays": 2}, DAY, early_phase=True) is True


def test_later_it_waits_for_real_use_and_a_customized_dashboard() -> None:
    assert should_ask({"activeDays": 10}, DAY, early_phase=False) is False
    assert should_ask({"activeDays": 9, "customized": True}, DAY, early_phase=False) is False
    assert should_ask({"activeDays": 10, "customized": True}, DAY, early_phase=False) is True


def test_a_rating_or_refusal_ends_it_for_good() -> None:
    assert should_ask({"activeDays": 50, "answer": "rate"}, DAY) is False
    assert should_ask({"activeDays": 50, "answer": "never"}, DAY) is False


def test_later_means_a_month_later_and_not_forever() -> None:
    recent = {"activeDays": 50, "answer": "later", "lastRequest": DAY.isoformat(), "requests": 1}
    assert should_ask(recent, DAY + timedelta(days=29)) is False
    assert should_ask(recent, DAY + timedelta(days=30)) is True
    assert should_ask({**recent, "requests": MAX_REQUESTS}, DAY + timedelta(days=90)) is False


def test_each_day_counts_once_and_the_request_comes_once(tmp_path: Path) -> None:
    usage = Usage(JsonStore(lambda: tmp_path))
    assert usage.visit(DAY) == {"askRating": False, "askShare": False}
    assert usage.visit(DAY) == {"askRating": False, "askShare": False}
    assert usage.visit(DAY + timedelta(days=1)) == {"askRating": True, "askShare": False}
    assert usage.visit(DAY + timedelta(days=1)) == {"askRating": False, "askShare": False}


LONG_USE = {"activeDays": SHARE_ACTIVE_DAYS, "firstDay": DAY.isoformat()}
LATER = DAY + timedelta(days=SHARE_AFTER_DAYS)


def test_recommending_waits_for_time_and_for_real_use() -> None:
    assert should_ask_to_share(LONG_USE, LATER) is True
    assert should_ask_to_share(LONG_USE, LATER - timedelta(days=1)) is False
    assert should_ask_to_share({**LONG_USE, "activeDays": SHARE_ACTIVE_DAYS - 1}, LATER) is False
    assert should_ask_to_share({"activeDays": 99}, LATER) is True


def test_recommending_keeps_its_distance_from_the_rating() -> None:
    rated = {**LONG_USE, "lastRequest": LATER.isoformat()}
    assert should_ask_to_share(rated, LATER + timedelta(days=DAYS_BETWEEN_REQUESTS - 1)) is False
    assert should_ask_to_share(rated, LATER + timedelta(days=DAYS_BETWEEN_REQUESTS)) is True
    shared = {"activeDays": 2, "lastShareRequest": LATER.isoformat()}
    assert should_ask(shared, LATER + timedelta(days=DAYS_BETWEEN_REQUESTS - 1)) is False
    assert should_ask(shared, LATER + timedelta(days=DAYS_BETWEEN_REQUESTS)) is True


def test_an_answer_ends_it_and_later_comes_back_rarely() -> None:
    assert should_ask_to_share({**LONG_USE, "shareAnswer": "share"}, LATER) is False
    assert should_ask_to_share({**LONG_USE, "shareAnswer": "never"}, LATER) is False
    asked = {
        **LONG_USE,
        "shareAnswer": "later",
        "lastShareRequest": LATER.isoformat(),
        "shareRequests": 1,
    }
    again = LATER + timedelta(days=SHARE_ASK_AGAIN_AFTER_DAYS)
    assert should_ask_to_share(asked, again - timedelta(days=1)) is False
    assert should_ask_to_share(asked, again) is True
    used_up = {**asked, "shareRequests": SHARE_MAX_REQUESTS}
    assert should_ask_to_share(used_up, LATER + timedelta(days=400)) is False


def test_rating_and_recommending_never_share_a_visit(tmp_path: Path) -> None:
    usage = Usage(JsonStore(lambda: tmp_path))
    usage.visit(DAY)
    day = DAY
    seen: list[FeedbackVisitResult] = []
    for _ in range(90):
        day += timedelta(days=1)
        seen.append(usage.visit(day))
    assert all(not (visit["askRating"] and visit["askShare"]) for visit in seen)
    assert any(visit["askShare"] for visit in seen)
