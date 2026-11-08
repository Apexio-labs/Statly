"""The creation stopwatch and its statistic: time spent making new cards."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.core.module import AddingEvent
from statly.modules.creation import NOTE_LIMIT, PAUSE_LIMIT, CreationClock
from statly.modules.statistics.calendar import AnkiCalendar
from test_rpc import FakeRuntime, call, drain, make_context


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def run(clock: Clock, steps: Sequence[tuple[float, str]], precise: bool = True) -> list[float]:
    """Feed the stopwatch: seconds to wait, then what the Add window reported."""
    stopwatch = CreationClock(clock, lambda: 1_700_000_000.0)
    found: list[float] = []
    for wait, kind in steps:
        clock.now += wait
        event = AddingEvent(kind, note_id=1, deck_id=1, cards=1, precise=precise)
        created = stopwatch.handle(event)
        if created is not None:
            found.append(created.seconds)
    return found


def test_research_in_another_program_counts() -> None:
    steps = [
        (0, "opened"),
        (0, "focused"),
        (20, "typed"),
        (10, "unfocused"),
        # Three minutes in a browser, looking something up.
        (180, "focused"),
        (15, "added"),
    ]
    assert run(Clock(), steps) == [20 + 10 + 180 + 15]


def test_a_long_time_in_another_program_counts_only_up_to_the_pause_limit() -> None:
    steps = [(0, "opened"), (0, "focused"), (10, "unfocused"), (3600, "focused"), (5, "added")]
    assert run(Clock(), steps) == [10 + PAUSE_LIMIT + 5]


def test_time_in_another_anki_window_does_not_count() -> None:
    steps = [
        (0, "opened"),
        (0, "focused"),
        (20, "elsewhere"),
        # Studying in Anki's main window is study time, not creation time.
        (600, "focused"),
        (15, "added"),
    ]
    assert run(Clock(), steps) == [35]


def test_research_then_studying_counts_only_the_research() -> None:
    steps = [
        (0, "opened"),
        (0, "focused"),
        (10, "unfocused"),
        (60, "elsewhere"),
        (900, "unfocused"),
        (30, "focused"),
        (5, "added"),
    ]
    assert run(Clock(), steps) == [10 + 60 + 30 + 5]


def test_a_long_pause_counts_only_up_to_the_pause_limit() -> None:
    steps = [(0, "opened"), (0, "focused"), (10, "typed"), (900, "typed"), (5, "added")]
    assert run(Clock(), steps) == [10 + PAUSE_LIMIT + 5]


def test_a_repeated_report_changes_nothing() -> None:
    steps = [(0, "opened"), (0, "focused"), (10, "focused"), (10, "typed"), (5, "added")]
    assert run(Clock(), steps) == [25]


def test_one_note_counts_at_most_the_note_limit() -> None:
    steps = [(0, "opened"), (0, "focused")]
    steps += [(200, "typed")] * 10
    steps += [(1, "added")]
    assert run(Clock(), steps) == [NOTE_LIMIT]


def test_each_note_starts_from_zero_and_closing_forgets() -> None:
    steps = [
        (0, "opened"),
        (0, "focused"),
        (30, "added"),
        (12, "added"),
        (50, "closed"),
        # Without an open window nothing counts, not even a stray report.
        (5, "added"),
    ]
    assert run(Clock(), steps) == [30, 12]


def test_the_newer_editor_counts_without_typing() -> None:
    steps = [(0, "opened"), (0, "focused"), (400, "added"), (1500, "added")]
    assert run(Clock(), steps, precise=False) == [400, NOTE_LIMIT]


def test_the_newer_editor_still_limits_time_in_another_program() -> None:
    steps = [(0, "opened"), (0, "focused"), (10, "unfocused"), (900, "focused"), (5, "added")]
    assert run(Clock(), steps, precise=False) == [10 + PAUSE_LIMIT + 5]


# The statistic, end to end ---------------------------------------------------------------------


class Setup:
    def __init__(self, collection: Collection) -> None:
        self.collection = collection
        self.clock = Clock()
        self.runtime = FakeRuntime(collection)
        # The stopwatch reads the host's clock, so it has to be in place before registering.
        self.runtime.monotonic = self.clock  # type: ignore[method-assign]
        self.context = make_context(self.runtime)
        self.today = AnkiCalendar(collection.sched.day_cutoff).today.isoformat()

    def deck(self, name: str) -> int:
        deck_id = self.collection.decks.id(name)
        assert deck_id is not None
        return int(deck_id)

    def make(self, deck: str, seconds: float, notetype: str = "Basic") -> int:
        """Write one note in the Add window, taking ``seconds`` of typing."""
        runtime = self.runtime
        runtime.adding("opened")
        runtime.adding("focused")
        self.clock.now += seconds
        model: Any = self.collection.models.by_name(notetype)
        note = self.collection.new_note(model)
        note["Front"] = f"{deck} {self.clock.now}"
        note["Back"] = "answer"
        self.collection.add_note(note, self.deck(deck))  # type: ignore[arg-type]
        runtime.adding("added", note_id=note.id, deck_id=self.deck(deck), cards=len(note.cards()))
        runtime.adding("closed")
        return int(note.id)

    def statistic(self, deck: str | None = None) -> dict[str, Any]:
        self.context.services["localdb"].wait()
        params = {
            "start": self.today,
            "end": self.today,
            "deckId": self.deck(deck) if deck else None,
        }
        responses = call(self.context.router, "statistics.creation", params)
        drain(self.runtime)
        assert responses and responses[0]["ok"], responses
        return responses[0]["result"]


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "creation.anki2"))
    yield Setup(collection)
    collection.close()


def test_nothing_measured_yet(setup: Setup) -> None:
    result = setup.statistic()
    assert result["measuredSince"] is None
    assert result["usualSecondsPerCard"] is None
    assert result["total"] == {"seconds": 0, "cards": 0, "notes": 0}
    assert [item["date"] for item in result["items"]] == [setup.today]


def test_time_cards_and_the_usual_pace(setup: Setup) -> None:
    setup.make("Anatomy", 60)
    setup.make("Anatomy", 90, "Basic (and reversed card)")
    setup.make("Spanish", 30)

    everything = setup.statistic()
    assert everything["total"] == {"seconds": 180, "cards": 4, "notes": 3}
    assert everything["usualSecondsPerCard"] == 45
    assert everything["measuredSince"] == setup.today
    assert ("statistics.changed", {}) in setup.runtime.emitted

    anatomy = setup.statistic("Anatomy")
    assert anatomy["total"] == {"seconds": 150, "cards": 3, "notes": 2}
    # The usual pace is over all decks, so a deck can be compared with it.
    assert anatomy["usualSecondsPerCard"] == 45


def test_a_removed_note_drops_out(setup: Setup) -> None:
    setup.make("Anatomy", 60)
    gone = setup.make("Anatomy", 40)
    setup.collection.remove_notes([gone])  # type: ignore[list-item]
    result = setup.statistic()
    assert result["total"] == {"seconds": 60, "cards": 1, "notes": 1}


def test_a_moved_card_counts_in_its_current_deck(setup: Setup) -> None:
    note = setup.make("Anatomy", 60)
    card = setup.collection.get_note(note).cards()[0]  # type: ignore[arg-type]
    setup.collection.set_deck([card.id], setup.deck("Spanish"))
    assert setup.statistic("Spanish")["total"]["notes"] == 1
    assert setup.statistic("Anatomy")["total"]["notes"] == 0
