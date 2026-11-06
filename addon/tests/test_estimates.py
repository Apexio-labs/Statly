"""The study time model: it finds known values again, reads Anki's gaps right and falls back."""

from __future__ import annotations

import math
import random
from collections.abc import Iterator
from pathlib import Path

import pytest
from anki.collection import Collection

from statly.modules.estimates.censored import LogNormal, Observation, fit
from statly.modules.estimates.returns import (
    ECHO_DAYS,
    echo,
    echo_with_fallback,
    first_gap,
    first_gaps,
)
from statly.modules.estimates.sessions import DAY_MS, LEARN, REVIEW, Answer, read_history
from statly.modules.estimates.study_time import DEFAULT_PACE, MODEL, Profile, build
from test_goals import Setup

TODAY_MS = 1_800_000_000_000


def limit_60(_deck: int | None) -> float:
    return 60.0


def answers_at(*moments: tuple[float, float], kind: int = 1) -> list[Answer]:
    """Answers at (seconds after the start, seconds Anki recorded), one card each."""
    start = TODAY_MS + 3_600_000
    return [
        Answer(start + round(at * 1000), index, 1, kind, round(taken * 1000))
        for index, (at, taken) in enumerate(moments)
    ]


# Fitting -----------------------------------------------------------------------------------------


def test_the_fit_finds_a_known_pace_although_anki_cut_long_answers_off() -> None:
    generator = random.Random(3)
    truth = LogNormal(math.log(20), 0.8)
    times = [generator.lognormvariate(truth.mu, truth.sigma) for _ in range(4000)]
    cut = [Observation(60, math.inf) if t >= 60 else Observation(t, t) for t in times]
    found = fit(cut)
    naive = sum(min(t, 60) for t in times) / len(times)

    assert found is not None
    assert abs(found.mean - truth.mean) / truth.mean < 0.05
    assert abs(naive - truth.mean) / truth.mean > 0.1
    assert abs(found.sigma - truth.sigma) < 0.05


def test_a_known_upper_bound_narrows_a_cut_off_time() -> None:
    exact = [Observation(10, 10)] * 50
    only_cut = fit([*exact, Observation(60, math.inf)])
    bounded = fit([*exact, Observation(60, 62)])
    assert only_cut is not None and bounded is not None
    assert bounded.mean <= only_cut.mean


def test_few_answers_lean_on_the_overall_pace() -> None:
    overall = LogNormal(math.log(10), 0.5)
    found = fit([Observation(40, 40)], overall, prior_weight=30)
    assert found is not None
    assert math.exp(found.mu) < 12


def test_the_average_above_a_limit_lies_above_it() -> None:
    pace = LogNormal(math.log(20), 0.8)
    assert pace.mean_above(60) > 60
    assert pace.mean_above(0) == pace.mean


# Reading Anki's history --------------------------------------------------------------------------


def test_an_answer_below_the_limit_is_exact() -> None:
    history = read_history(answers_at((0, 5), (7, 5), (14, 5)), limit_60, TODAY_MS)
    assert history.between == 2
    assert [entry.observation.low for entry in history.observed] == [5, 5, 5]


def test_a_cut_off_answer_lies_between_the_limit_and_the_gap() -> None:
    moments = [(0, 5), (7, 5), (14, 5), (100, 60)]
    observation = read_history(answers_at(*moments), limit_60, TODAY_MS).observed[-1].observation
    assert (observation.low, observation.high) == (60, 84)


def test_a_cut_off_answer_after_a_break_is_only_known_to_be_long() -> None:
    moments = [(0, 5), (7, 5), (14, 5), (3600, 60)]
    observation = read_history(answers_at(*moments), limit_60, TODAY_MS).observed[-1].observation
    assert (observation.low, observation.high) == (60, math.inf)


def test_the_time_of_an_undone_look_goes_to_its_card() -> None:
    """The owner's example: 40 seconds, undo, 1 second. Anki keeps 1, the gap shows the rest."""
    moments = [(0, 5), (7, 5), (14, 5), (14 + 2 + 40 + 1, 1)]
    observation = read_history(answers_at(*moments), limit_60, TODAY_MS).observed[-1].observation
    assert observation.low == observation.high == 41


def test_a_break_is_not_counted_as_study_time() -> None:
    moments = [(0, 5), (7, 5), (14, 5), (900, 5)]
    observation = read_history(answers_at(*moments), limit_60, TODAY_MS).observed[-1].observation
    assert observation.low == 5


def test_the_stopwatch_replaces_what_anki_kept() -> None:
    moments = answers_at((0, 5), (100, 60))
    measured = {(moments[1].card_id, moments[1].at_ms // 1000): 97.0}
    observation = read_history(moments, limit_60, TODAY_MS, measured).observed[-1].observation
    assert observation.low == observation.high == 97


def test_answers_count_by_the_day_they_were_given() -> None:
    old = Answer(TODAY_MS - 1, 1, 1, 1, 5000)
    older = Answer(TODAY_MS - DAY_MS - 1, 2, 1, 1, 5000)
    today = Answer(TODAY_MS + 5, 3, 1, 1, 5000)
    history = read_history([older, old, today], limit_60, TODAY_MS)
    assert [entry.day for entry in history.observed] == [2, 1, 0]


# Forecasts ---------------------------------------------------------------------------------------


def test_without_history_the_forecast_uses_typical_times_and_a_wide_range() -> None:
    profile = build(read_history([], limit_60, TODAY_MS), {})
    estimate = profile.predict([(None, 10, 0)])
    per_card = DEFAULT_PACE.answers_per_new * (DEFAULT_PACE.seconds[LEARN] + profile.between)
    assert estimate.seconds == pytest.approx(10 * per_card)
    assert estimate.low < estimate.seconds < estimate.high
    assert estimate.model == MODEL


def test_past_days_calibrate_the_forecast() -> None:
    """Each day took 30 reviews of 10 seconds. The forecast learns that, and the range is narrow."""
    answers: list[Answer] = []
    for day in range(1, 15):
        start = TODAY_MS - day * DAY_MS + 3_600_000
        answers.extend(
            Answer(start + index * 12_000, day * 100 + index, 1, 1, 10_000) for index in range(30)
        )
    profile = build(read_history(answers, limit_60, TODAY_MS), {1: (5, 60)})
    estimate = profile.predict([(1, 0, 30)])
    assert estimate.seconds == pytest.approx(30 * 12, rel=0.1)
    assert estimate.high - estimate.low < 0.2 * estimate.seconds


def test_each_preset_keeps_its_own_pace() -> None:
    quick = [Answer(TODAY_MS - DAY_MS + i * 7_000, i, 1, 1, 5_000) for i in range(200)]
    slow = [
        Answer(TODAY_MS - DAY_MS + 2_000_000 + i * 32_000, 500 + i, 2, 1, 30_000)
        for i in range(200)
    ]
    profile: Profile = build(
        read_history(quick + slow, limit_60, TODAY_MS), {1: (10, 60), 2: (20, 60)}
    )
    assert profile.pace(1).seconds[REVIEW] < 7 < 25 < profile.pace(2).seconds[REVIEW]


# In a goal ---------------------------------------------------------------------------------------


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "estimates.anki2"))
    yield Setup(collection)
    collection.close()


def test_a_goal_says_how_long_today_takes_and_how_much_is_left(setup: Setup) -> None:
    goal = setup.save()
    before = setup.status(goal)["time"]
    assert before["model"] == MODEL
    assert before["day"]["seconds"] > 0
    assert before["left"] == before["day"]

    setup.learn(setup.anatomy[0])
    after = setup.status(goal)["time"]
    assert after["left"]["seconds"] < before["left"]["seconds"]
    assert after["left"]["low"] <= after["left"]["seconds"] <= after["left"]["high"]


# When learned cards come back --------------------------------------------------------------------


def learned_on(card: int, days_ago: int, interval: int, deck: int = 1) -> Answer:
    return Answer(TODAY_MS - days_ago * DAY_MS + 3_600_000, card, deck, 0, 5000, interval)


def test_the_first_gap_has_room_and_leans_on_the_overall_gap() -> None:
    answers = [learned_on(card, 30, 1 if card < 75 else 4) for card in range(100)]
    assert first_gap(first_gaps(answers), [1], fallback=7) == 2
    few = [learned_on(1000 + card, 30, 10, deck=2) for card in range(3)]
    gaps = first_gaps(answers + few)
    assert 2 < first_gap(gaps, [2], fallback=7) < 10


def test_without_history_the_first_gap_is_the_decks_graduating_interval() -> None:
    assert first_gap({}, [1], fallback=3) == 3
    assert first_gap({}, [1], fallback=0) == 1


def test_the_echo_counts_reviews_on_each_day_after_learning() -> None:
    answers: list[Answer] = []
    for card in range(40):
        answers.append(learned_on(card, 30, 2))
        answers.append(Answer(TODAY_MS - 28 * DAY_MS + 3_600_000, card, 1, 1, 5000, 6))
    measured = echo(answers, TODAY_MS)
    assert measured[2] == 1.0
    assert measured[1] == 0.0
    # Cards learned 30 days ago cannot tell anything about day 45 yet.
    assert measured[45] is None


def test_an_unknown_echo_assumes_reviews_at_growing_intervals() -> None:
    filled = echo_with_fallback((None,) * (ECHO_DAYS + 1), 2)
    # The gaps grow by about two and a half times: 5, 12 and 30 days.
    assert [day for day, value in enumerate(filled) if value] == [2, 7, 19, 49]
