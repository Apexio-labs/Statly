from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from statly.core.storage import JsonStore
from statly.modules.feedback import MAX_REQUESTS, Usage, should_ask

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
    assert usage.visit(DAY) == {"askRating": False}
    assert usage.visit(DAY) == {"askRating": False}
    assert usage.visit(DAY + timedelta(days=1)) == {"askRating": True}
    assert usage.visit(DAY + timedelta(days=1)) == {"askRating": False}
