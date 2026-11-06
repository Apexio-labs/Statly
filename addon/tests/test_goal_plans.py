"""The exam goal's rules with exact numbers, without Anki."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest

from statly.modules.goals.allocate import largest_remainder
from statly.modules.goals.days import StudyCalendar, deadline
from statly.modules.goals.exam.plan import (
    DayCounts,
    DeckCounts,
    ExamInputs,
    FrozenDay,
    day_result,
    plan,
    replay,
    tone,
)
from statly.modules.goals.streaks import DayResult, streak

# A Wednesday, so weekday rules are easy to follow.
TODAY = date(2026, 11, 4)


def config(**changes: Any) -> dict[str, Any]:
    return {
        "kind": "exam",
        "decks": [{"id": 1, "name": "Anatomy"}],
        # Ten study days: today and the nine after it, then the exam on the eleventh.
        "examDate": (TODAY + timedelta(days=10)).isoformat(),
        "bufferDays": 0,
        "mode": "learned",
        "counts": "newOnly",
        "studyWeekdays": [0, 1, 2, 3, 4, 5, 6],
        "freeDates": [],
        **changes,
    }


def deck(
    deck_id: int = 1, parent: int | None = None, name: str = "Anatomy", **counts: int
) -> DeckCounts:
    values = {
        "cards": 0,
        "suspended": 0,
        "learned": 0,
        "in_progress": 0,
        "due_reviews": 0,
        **counts,
    }
    return DeckCounts(deck_id, parent, name, **values)  # type: ignore[arg-type]


def inputs(
    *decks: DeckCounts,
    today: dict[int, DayCounts],
    days: dict[date, dict[int, DayCounts]] | None = None,
) -> ExamInputs:
    return ExamInputs(TODAY, decks or (deck(),), {**(days or {}), TODAY: today})


def opened(open_cards: int, learned: int = 0, reviewed: int = 0) -> DayCounts:
    return DayCounts(open_cards, learned, reviewed)


def test_open_cards_spread_evenly_over_the_days_left() -> None:
    result = plan(
        config(examDate=(TODAY + timedelta(days=7)).isoformat()),
        inputs(today={1: opened(100)}),
        None,
    )
    assert result.study_days_left == 7
    assert result.new_target == 15
    assert result.state == "active"


def test_deleted_cards_leave_at_once_and_tomorrow_follows() -> None:
    """The owner's example: 110 cards in 10 days, 6 learned, then 10 deleted."""
    morning = FrozenDay(open_at_start=110, reviews_at_start=0)
    before = plan(config(), inputs(today={1: opened(110, learned=6)}), morning)
    assert before.new_target == 11

    after = plan(config(), inputs(today={1: opened(100, learned=6)}), morning)
    assert after.new_target == 10
    assert after.new_target - after.new_done == 4
    assert after.tomorrow_if_met == 10


def test_cards_added_during_the_day_count_from_tomorrow() -> None:
    morning = FrozenDay(open_at_start=100, reviews_at_start=0, newest_card=1_000)
    later = ExamInputs(
        TODAY, (deck(),), {TODAY: {1: opened(120)}}, added_today=tuple(range(2_000, 2_020))
    )
    result = plan(config(), later, morning)
    assert result.new_target == 10
    # 100 open, 10 learned today if met, 20 new ones: 110 over the 9 days left.
    assert result.tomorrow_if_met == 13
    assert result.tomorrow_if_stopped == 14


def test_deleting_counts_at_once_even_when_cards_were_added_too() -> None:
    morning = FrozenDay(open_at_start=100, reviews_at_start=0, newest_card=1_000)
    # 30 cards came after the morning count and 10 of the morning's cards were deleted.
    later = ExamInputs(
        TODAY, (deck(),), {TODAY: {1: opened(120)}}, added_today=tuple(range(2_000, 2_030))
    )
    result = plan(config(), later, morning)
    assert result.open_at_start == 90
    assert result.new_target == 9


def test_learning_less_raises_tomorrow_and_more_lowers_it() -> None:
    result = plan(config(), inputs(today={1: opened(100, learned=4)}), None)
    assert (result.tomorrow_if_met, result.tomorrow_if_stopped) == (10, 11)
    ahead = plan(config(), inputs(today={1: opened(100, learned=28)}), None)
    assert ahead.tomorrow_if_met == 8


def test_free_weekdays_and_single_days_leave_fewer_study_days() -> None:
    # Saturday and Sunday off, and next Thursday too: the 10 days up to the deadline hold 7.
    free = [(TODAY + timedelta(days=8)).isoformat()]
    result = plan(
        config(studyWeekdays=[0, 1, 2, 3, 4], freeDates=free), inputs(today={1: opened(70)}), None
    )
    assert result.study_days_left == 7
    assert result.new_target == 10


def test_a_day_off_has_no_goal_and_does_not_count() -> None:
    result = plan(
        config(studyWeekdays=[0, 1, 3, 4, 5, 6]), inputs(today={1: opened(100, learned=3)}), None
    )
    assert result.new_target == 0
    assert result.new_done == 3
    assert tone(result.new_target, result.new_done, 0, 0) == "rest"


def test_reviews_count_when_chosen_and_both_parts_must_be_met() -> None:
    reviews = (deck(due_reviews=30),)
    result = plan(
        config(counts="newAndDue"),
        inputs(*reviews, today={1: opened(100, learned=10, reviewed=50)}),
        None,
    )
    assert (result.new_target, result.review_target) == (10, 80)
    assert result.target == 90
    assert day_result(10, 10, 80, 50, True) == "pending"
    assert day_result(10, 4, 80, 200, True) == "pending"
    assert day_result(10, 10, 80, 80, True) == "met"

    only_new = plan(config(), inputs(*reviews, today={1: opened(100, reviewed=50)}), None)
    assert only_new.target == 10
    assert only_new.review_target == 0


def test_the_morning_review_count_stays_for_the_day() -> None:
    frozen = FrozenDay(open_at_start=100, reviews_at_start=40)
    later = (deck(due_reviews=55),)
    result = plan(
        config(counts="newAndDue"), inputs(*later, today={1: opened(100, reviewed=5)}), frozen
    )
    assert result.review_target == 40


def test_after_the_deadline_the_rest_goes_into_the_buffer() -> None:
    exam = TODAY + timedelta(days=4)
    result = plan(
        config(examDate=exam.isoformat(), bufferDays=6), inputs(today={1: opened(30)}), None
    )
    assert result.state == "buffer"
    assert result.deadline == exam - timedelta(days=7)
    assert result.new_target == 8


def test_the_buffer_stays_free_before_the_deadline() -> None:
    exam = TODAY + timedelta(days=10)
    result = plan(
        config(examDate=exam.isoformat(), bufferDays=3), inputs(today={1: opened(60)}), None
    )
    assert result.deadline == exam - timedelta(days=4)
    assert result.study_days_left == 7
    assert result.new_target == 9
    assert [day.kind for day in result.plan[-4:]] == ["buffer", "buffer", "buffer", "exam"]
    assert sum(day.target for day in result.plan) == 60


def test_on_and_after_the_exam_nothing_is_planned() -> None:
    result = plan(config(examDate=TODAY.isoformat()), inputs(today={1: opened(30)}), None)
    assert result.state == "over"
    assert result.target == 0


def test_with_everything_learned_due_reviews_still_count() -> None:
    reviews = (deck(due_reviews=12),)
    result = plan(config(counts="newAndDue"), inputs(*reviews, today={1: opened(0)}), None)
    assert result.state == "finished"
    assert (result.new_target, result.review_target) == (0, 12)


def test_without_decks_the_goal_says_so() -> None:
    empty = ExamInputs(TODAY, (), {TODAY: {}}, missing=("Anatomy",))
    result = plan(config(), empty, None)
    assert result.state == "noDecks"
    assert result.warnings == ({"kind": "deckMissing", "name": "Anatomy"},)


def test_decks_and_subdecks_share_the_goal_exactly() -> None:
    decks = (
        deck(1, None, "Medicine"),
        deck(2, 1, "Medicine::Anatomy"),
        deck(3, 1, "Medicine::Physiology"),
        deck(4, None, "Chemistry"),
    )
    today = {1: opened(10), 2: opened(30), 3: opened(30), 4: opened(30)}
    result = plan(
        config(examDate=(TODAY + timedelta(days=7)).isoformat()), inputs(*decks, today=today), None
    )
    targets = {entry.deck_id: entry.target for entry in result.decks}
    assert result.new_target == 15
    assert targets[1] + targets[4] == 15
    assert targets[2] + targets[3] <= targets[1]
    assert {entry.deck_id: entry.open for entry in result.decks}[1] == 70


def test_a_limit_below_the_goal_is_pointed_out() -> None:
    limited = (deck(new_limit=5),)
    result = plan(config(), inputs(*limited, today={1: opened(100)}), None)
    assert {
        "kind": "newLimit",
        "deckId": 1,
        "name": "Anatomy",
        "limit": 5,
        "target": 10,
    } in result.warnings


def test_suspended_cards_are_named() -> None:
    held = (deck(suspended=7),)
    assert {"kind": "suspended", "cards": 7} in plan(
        config(), inputs(*held, today={1: opened(10)}), None
    ).warnings


def test_a_replayed_day_counts_its_own_reviews_as_due() -> None:
    yesterday = TODAY - timedelta(days=1)
    days = {yesterday: {1: opened(110, learned=12, reviewed=30)}}
    data = inputs(today={1: opened(98)}, days=days)
    assert replay(config(counts="newAndDue"), data, yesterday) == (10, 30, 12, 30)
    assert replay(config(), data, yesterday) == (10, 0, 12, 30)


def test_tones_follow_the_owner_s_thresholds() -> None:
    assert tone(10, 3, 0, 0) == "behind"
    assert tone(10, 4, 0, 0) == "progress"
    assert tone(10, 10, 0, 0) == "done"
    assert tone(10, 3, 20, 30) == "progress"


@pytest.mark.parametrize(
    ("total", "weights", "caps", "expected"),
    [
        (10, [1, 1, 1], None, [4, 3, 3]),
        (15, [10, 30, 30, 30], None, [2, 5, 4, 4]),
        (10, [5, 50], [5, 50], [1, 9]),
        (10, [1, 9], [1, 100], [1, 9]),
        (10, [3, 0, 7], None, [3, 0, 7]),
        (10, [1, 1], [2, 3], [2, 3]),
        (0, [1, 2], None, [0, 0]),
    ],
)
def test_shares_add_up_and_respect_caps(
    total: int, weights: list[int], caps: list[int] | None, expected: list[int]
) -> None:
    assert largest_remainder(total, weights, caps) == expected


def test_the_buffer_sits_right_before_the_exam() -> None:
    assert deadline(date(2027, 1, 20), 7) == date(2027, 1, 12)
    assert deadline(date(2027, 1, 20), 0) == date(2027, 1, 19)


def test_study_days_leave_out_weekdays_and_single_days() -> None:
    calendar = StudyCalendar.of([0, 1, 2, 3, 4], ["2026-11-06"])
    assert calendar.count(date(2026, 11, 2), date(2026, 11, 8)) == 4


def results(*entries: tuple[int, str]) -> list[DayResult]:
    return [DayResult(TODAY - timedelta(days=back), result) for back, result in entries]


def test_a_streak_counts_met_days_and_skips_days_off() -> None:
    found = streak(results((3, "met"), (2, "rest"), (1, "met"), (0, "pending")), TODAY)
    assert (found.current, found.best, found.at_risk) == (2, 2, True)


def test_a_missed_day_ends_the_streak_but_not_the_best() -> None:
    found = streak(results((4, "met"), (3, "met"), (2, "met"), (1, "missed"), (0, "met")), TODAY, 2)
    assert (found.current, found.best) == (1, 3)


def test_reaching_a_milestone_today_is_reported() -> None:
    found = streak(results((2, "met"), (1, "met"), (0, "met")), TODAY)
    assert found.milestone == 3
    assert streak(results((2, "met"), (1, "met"), (0, "pending")), TODAY).milestone is None


def test_python_celebrates_the_same_milestones_the_app_shows() -> None:
    from statly.core.contract import Contract
    from statly.modules.goals.streaks import MILESTONES

    assert list(MILESTONES) == Contract().goals["milestones"]


# "Reviewed": every card learned early enough to come back once before the deadline ----------


def reviewed_inputs(gap: int, **counts: int) -> ExamInputs:
    found = inputs(deck(1, None, "Anatomy", **counts), today={1: opened(100)})
    return ExamInputs(found.today, found.decks, found.days, first_gap_days=gap, echo=(0.0,) * 61)


def test_cards_are_learned_a_first_gap_before_the_deadline() -> None:
    """Ten study days and cards that come back after three: learn in seven, see them in three."""
    result = plan(config(mode="reviewed"), reviewed_inputs(gap=3), None)
    assert result.learn_by == TODAY + timedelta(days=6)
    assert result.first_gap == 3
    assert result.study_days_left == 7
    assert result.new_target == 15
    kinds = [day.kind for day in result.plan]
    assert kinds[:7] == ["study"] * 7
    assert kinds[7:10] == ["review"] * 3
    assert kinds[10] == "exam"
    assert sum(day.target for day in result.plan) == 100


def test_without_a_day_left_to_learn_in_time_the_goal_falls_back_with_a_warning() -> None:
    """The first gap is longer than the time left: learning goes on until the deadline anyway."""
    result = plan(config(mode="reviewed"), reviewed_inputs(gap=12), None)
    learned = plan(config(), reviewed_inputs(gap=12), None)
    assert result.new_target == learned.new_target == 10
    assert {"kind": "noTimeToReview", "days": 12} in result.warnings
    assert "review" not in [day.kind for day in result.plan]


def test_cards_that_would_come_back_too_late_are_named() -> None:
    result = plan(config(mode="reviewed"), reviewed_inputs(gap=2, learned=40, late=12), None)
    assert {"kind": "lateCards", "cards": 12} in result.warnings


def test_a_reviewed_goal_is_finished_once_every_card_was_seen_again() -> None:
    waiting = ExamInputs(
        TODAY, (deck(cards=50, learned=50, finished=45),), {TODAY: {1: opened(0)}}, first_gap_days=2
    )
    result = plan(config(mode="reviewed"), waiting, None)
    assert result.state == "active"
    assert result.new_target == 0
    assert (result.totals["finished"], result.totals["waiting"]) == (45, 5)

    done = ExamInputs(
        TODAY, (deck(cards=50, learned=50, finished=50),), {TODAY: {1: opened(0)}}, first_gap_days=2
    )
    assert plan(config(mode="reviewed"), done, None).state == "finished"


def test_a_learned_goal_counts_no_finished_cards() -> None:
    result = plan(config(), reviewed_inputs(gap=3), None)
    assert result.learn_by is None
    assert (result.totals["finished"], result.totals["waiting"]) == (None, None)


def test_coming_days_expect_due_cards_and_planned_cards_coming_back() -> None:
    """Every planned card comes back once after two days, and three cards are due on day 2."""
    echo = (0.0, 0.0, 1.0) + (0.0,) * 58
    found = inputs(today={1: opened(100)})
    result = plan(
        config(),
        ExamInputs(found.today, found.decks, found.days, due_by_day={2: 3}, echo=echo),
        FrozenDay(100, 7),
    )
    targets = [day.target for day in result.plan]
    reviews = [day.reviews for day in result.plan]
    assert reviews[0] == 0
    assert reviews[1] == 0
    assert reviews[2] == 3 + targets[0]
    assert reviews[3] == targets[1]
