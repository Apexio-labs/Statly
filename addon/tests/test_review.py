"""The reviewer as Statly sees it: attempts, undo, the stopwatch and goals counted along."""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.core.localdb import LocalDatabase, Tables
from statly.core.module import Events, ShownCard
from statly.host.hooks import guarded_filter
from statly.modules.goals.live import NEW, REVIEW, LiveCounter, LiveGoal, kind_of
from statly.modules.review import ANSWERED, FINISHED, UNDONE, Attempt, ReviewSession
from statly.modules.timing import Stopwatch
from statly.modules.timing import store as timing_store
from statly.modules.timing.attempts import Timed, time_at_card
from test_goals import Setup
from test_rpc import drain


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class Recorder:
    """A session with clocks we move by hand, and everything it tells other modules."""

    def __init__(self) -> None:
        self.clock = Clock()
        self.waiting: list[Callable[[], None]] = []
        self.heard: list[tuple[str, Any]] = []
        events = Events()
        for name in (ANSWERED, UNDONE, FINISHED):
            events.subscribe(name, lambda value, name=name: self.heard.append((name, value)))
        self.session = ReviewSession(
            events, lambda: 1_800_000_000 + self.clock.now, self.clock, self.waiting.append
        )

    def show(self, card_id: int, at: float, card_type: int = 0, queue: int = 0) -> None:
        self.clock.now = at
        self.session.question_shown(ShownCard(card_id, 1, card_type, queue))

    def answer(self, card_id: int, ease: int, at: float) -> None:
        self.clock.now = at
        self.session.will_answer(card_id, ease)

    def paint(self) -> None:
        while self.waiting:
            self.waiting.pop(0)()


def card(card_id: int, card_type: int = 0, queue: int = 0) -> ShownCard:
    return ShownCard(card_id, 1, card_type, queue)


# The session -----------------------------------------------------------------------------------


def test_an_answer_is_told_only_once_the_next_card_shows() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 3, at=12)
    assert review.heard == []
    review.show(2, at=12.1)
    assert review.heard == []
    review.paint()
    assert [name for name, _ in review.heard] == [ANSWERED]
    attempt: Attempt = review.heard[0][1]
    assert (attempt.card_id, attempt.ease, attempt.seconds, attempt.undone) == (1, 3, 12, False)


def test_the_last_answer_is_told_when_studying_ends() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 4, at=5)
    review.session.state_changed("overview", "review")
    assert [name for name, _ in review.heard] == [ANSWERED, FINISHED]


def test_undo_takes_back_the_answer_of_the_card_it_brings_back() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 1, at=40)
    review.show(2, at=40.5)
    review.paint()
    review.session.answer_undone()
    review.show(1, at=42)
    review.answer(1, 2, at=43)
    review.show(2, at=43.5)
    review.paint()

    names = [name for name, _ in review.heard]
    assert names == [ANSWERED, UNDONE, ANSWERED]
    first, again = review.heard[0][1], review.heard[2][1]
    assert first.undone is True
    assert (again.card_id, again.ease, again.undone) == (1, 2, False)


def test_undo_also_counts_when_anki_shows_the_card_before_it_reports_the_undo() -> None:
    """Real Anki redraws the reviewer first and tells add-ons about the undo afterwards."""
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 1, at=40)
    review.show(2, at=40.5)
    review.paint()
    review.show(1, at=42)
    review.session.answer_undone()
    review.answer(1, 2, at=43)
    review.show(2, at=43.5)
    review.paint()

    assert [name for name, _ in review.heard] == [ANSWERED, UNDONE, ANSWERED]
    assert review.heard[0][1].undone is True
    assert review.heard[2][1].seconds == 1


def test_an_answer_undone_before_it_was_told_comes_marked() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 1, at=3)
    review.session.answer_undone()
    review.show(1, at=4)
    review.paint()
    assert [name for name, _ in review.heard] == [ANSWERED]
    assert review.heard[0][1].undone is True


def test_an_undo_that_brings_back_another_card_takes_nothing_back() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(1, 3, at=2)
    review.show(2, at=3)
    review.paint()
    review.session.answer_undone()
    review.show(7, at=5)
    review.paint()
    assert [name for name, _ in review.heard] == [ANSWERED]
    assert review.heard[0][1].undone is False


def test_time_with_anki_in_the_background_is_kept_apart() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.clock.now = 10
    review.session.app_active(False)
    review.clock.now = 25
    review.session.app_active(True)
    review.answer(1, 3, at=40)
    review.session.state_changed("overview", "review")
    attempt = review.heard[0][1]
    assert (attempt.seconds, attempt.inactive) == (40, 15)


def test_an_answer_for_a_card_that_was_not_shown_is_ignored() -> None:
    review = Recorder()
    review.show(1, at=0)
    review.answer(9, 3, at=2)
    review.session.state_changed("overview", "review")
    assert [name for name, _ in review.heard] == [FINISHED]


def test_a_failing_watcher_never_changes_or_stops_the_answer() -> None:
    def broken(_value: Any, *_rest: Any) -> None:
        raise RuntimeError("boom")

    watched = guarded_filter(broken)
    assert watched((True, 3), object(), object()) == (True, 3)


# Time at a card --------------------------------------------------------------------------------


def test_undone_looks_count_towards_the_card() -> None:
    """The owner's examples: 40 s, undo, 1 s is 41 s; 40 s, undo, 30 s is 70 s."""
    assert time_at_card([Timed(1, 40, 0, True), Timed(1, 1, 0, False)]) == [(1, 41)]
    assert time_at_card([Timed(1, 40, 0, True), Timed(1, 30, 0, False)]) == [(1, 70)]


def test_time_in_the_background_does_not_count_towards_the_card() -> None:
    assert time_at_card([Timed(1, 100, 60, False), Timed(2, 5, 0, False)]) == [(1, 40), (2, 5)]


# Statly's own database -------------------------------------------------------------------------


def test_the_database_works_on_its_own_thread_and_upgrades_step_by_step(tmp_path: Path) -> None:
    threads: list[str] = []

    def first(tables: Tables) -> None:
        tables.run("CREATE TABLE notes (id INTEGER PRIMARY KEY)")

    def second(tables: Tables) -> None:
        tables.run("ALTER TABLE notes ADD COLUMN text TEXT")

    database = LocalDatabase(lambda: tmp_path)
    database.schema("example", [first])
    database.submit(lambda _tables: threads.append(threading.current_thread().name))
    database.wait()
    database.close()

    database = LocalDatabase(lambda: tmp_path)
    database.schema("example", [first, second])
    found: list[Any] = []
    database.submit(
        lambda tables: tables.rows("SELECT name FROM pragma_table_info('notes')"), found.append
    )
    database.wait()
    database.close()

    assert threads == ["statly-localdb"]
    assert found == [[("id",), ("text",)]]
    assert (tmp_path / "statly.db").exists()


# The stopwatch ---------------------------------------------------------------------------------


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "review.anki2"))
    yield Setup(collection)
    collection.close()


def shown(setup: Setup, card_id: int) -> ShownCard:
    found = setup.collection.get_card(card_id)  # type: ignore[arg-type]
    return ShownCard(card_id, int(found.did), int(found.type), int(found.queue))


def study(setup: Setup, steps: list[tuple[int, int, str | None]]) -> None:
    """Show each card, press its button and, when given, answer it in the collection as well."""
    runtime = setup.runtime
    for card_id, ease, rating in steps:
        runtime.show_question(shown(setup, card_id))
        runtime.run_later()
        runtime.press(card_id, ease)
        if rating == "learn":
            setup.learn(card_id)
        elif rating is not None:
            setup.answer(card_id, rating)


def stored(setup: Setup) -> list[tuple[Any, ...]]:
    database: LocalDatabase = setup.context.services["localdb"]
    found: list[Any] = []
    database.wait()
    if not database.path().exists():
        return []
    database.submit(
        lambda tables: tables.rows("SELECT card_id, ease, undone FROM attempts ORDER BY id"),
        found.append,
    )
    database.wait()
    return found[0]


def test_the_stopwatch_keeps_every_look_with_undo(setup: Setup) -> None:
    first, second = setup.anatomy[0], setup.anatomy[1]
    runtime = setup.runtime
    runtime.change_state("review", "overview")
    study(setup, [(first, 1, None), (second, 3, None)])
    runtime.undo_answer()
    study(setup, [(second, 2, None)])
    runtime.change_state("overview", "review")
    runtime.run_later()

    assert stored(setup) == [(first, 1, 0), (second, 3, 1), (second, 2, 0)]


def test_the_stopwatch_writes_later_and_when_studying_ends(tmp_path: Path) -> None:
    database = LocalDatabase(lambda: tmp_path)
    database.schema("timing", timing_store.SCHEMA)
    clock = Clock()
    stopwatch = Stopwatch(database, clock)
    stopwatch.answered(Attempt(1, 5, 1, 0, 0, 1_800_000_000, 3, 0, 3))
    database.wait()
    assert not (tmp_path / "statly.db").exists()
    clock.now = 6
    stopwatch.answered(Attempt(2, 6, 1, 0, 0, 1_800_000_004, 2, 0, 3))
    stopwatch.answered(Attempt(3, 7, 1, 0, 0, 1_800_000_007, 2, 0, 3))
    stopwatch.write()
    found: list[Any] = []
    database.submit(lambda tables: tables.rows("SELECT card_id FROM attempts"), found.append)
    database.wait()
    assert found == [[(5,), (6,), (7,)]]


# Goals counted along ---------------------------------------------------------------------------


def goal_left(new: int, reviews: int = 0) -> LiveGoal:
    return LiveGoal("g", "Exam", frozenset({1}), new, reviews, 3, valid_until=100)


def test_answers_count_as_learned_or_reviewed_by_the_card_before_and_after() -> None:
    # Arguments: the card's type before, then its type and queue after the answer.
    assert kind_of(0, 2, 2) == NEW
    assert kind_of(1, 2, 2) == NEW
    assert kind_of(0, 1, 1) is None
    # A one-day learning step moves a new card on, but it is not learned yet.
    assert kind_of(1, 1, 3) is None
    assert kind_of(2, 2, 2) == REVIEW
    # Relearning with a step of a day or more: moved to a later day.
    assert kind_of(3, 3, 3) == REVIEW
    # Leaving relearning for the review queue.
    assert kind_of(3, 2, 2) == REVIEW
    # A lapse that is still relearning today is not reviewed yet.
    assert kind_of(2, 3, 1) is None


def test_the_tally_needs_both_parts_and_undo_puts_an_answer_back() -> None:
    live = LiveCounter()
    live.seed([goal_left(new=1, reviews=1)])
    assert live.count(1, 1, NEW, now=0) == []
    live.undo(1)
    assert live.count(2, 1, REVIEW, now=0) == []
    reached = live.count(3, 1, NEW, now=0)
    assert [goal.goal_id for goal in reached] == ["g"]
    assert live.count(4, 1, NEW, now=0) == []


def test_the_tally_ends_with_the_anki_day_and_ignores_other_decks() -> None:
    live = LiveCounter()
    live.seed([goal_left(new=1)])
    assert not live.wants(2, now=0)
    assert not live.wants(1, now=100)
    assert live.count(1, 1, NEW, now=100) == []
    assert live.wants(1, now=99)


def test_the_reviewer_says_once_when_the_days_goal_is_met(setup: Setup) -> None:
    setup.save()
    runtime = setup.runtime
    runtime.change_state("overview", "deckBrowser")
    drain(runtime)
    runtime.change_state("review", "overview")
    first, second, third, fourth = setup.anatomy[:4]
    study(setup, [(first, 3, "learn"), (second, 3, "learn")])
    assert runtime.tooltips == []
    study(setup, [(third, 3, "learn"), (fourth, 3, None)])
    assert runtime.tooltips == ["Statly: Tagesziel geschafft: Anatomy 🎉"]

    runtime.undo_answer()
    study(setup, [(third, 3, None)])
    runtime.show_question(shown(setup, fourth))
    runtime.run_later()
    assert len(runtime.tooltips) == 1


def test_the_note_in_the_reviewer_can_be_switched_off(setup: Setup) -> None:
    setup.save()
    setup.context.settings.update({"goalToast": False})  # type: ignore[typeddict-item]
    runtime = setup.runtime
    runtime.change_state("overview", "deckBrowser")
    drain(runtime)
    runtime.change_state("review", "overview")
    study(setup, [(card_id, 3, "learn") for card_id in setup.anatomy[:3]])
    runtime.show_question(shown(setup, setup.anatomy[3]))
    runtime.run_later()
    assert runtime.tooltips == []


def test_goals_are_not_counted_while_studying(setup: Setup) -> None:
    setup.save()
    runtime = setup.runtime
    runtime.change_state("review", "overview")
    runtime.sync_finished()
    assert runtime.pending == []
    runtime.change_state("overview", "review")
    runtime.run_later()
    assert runtime.pending != []


def test_the_window_counts_again_after_each_answer_and_undo_once_the_next_card_shows() -> None:
    from statly.modules.statistics import tell_after_answers

    review = Recorder()
    told: list[int] = []
    tell_after_answers(review.session.events, lambda: told.append(len(review.heard)))
    review.show(1, at=0)
    review.answer(1, 3, at=5)
    review.show(2, at=5.1)
    assert told == []
    review.paint()
    assert len(told) == 1
    review.session.answer_undone()
    review.show(1, at=7)
    assert len(told) == 2
