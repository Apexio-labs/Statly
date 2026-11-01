"""Tests run against real Anki collections, not mocks."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer


@pytest.fixture
def collection(tmp_path: Path) -> Iterator[Collection]:
    """A collection in the middle of a review session, with one undoable answer."""
    col = Collection(str(tmp_path / "collection.anki2"))
    notetype: Any = col.models.by_name("Basic")
    deck_id: Any = col.decks.id("Test")
    for index in range(3):
        note = col.new_note(notetype)
        note["Front"] = f"front {index}"
        note["Back"] = f"back {index}"
        col.add_note(note, deck_id)
    col.decks.select(deck_id)

    scheduler: Any = col.sched
    card = scheduler.getCard()
    states = col._backend.get_scheduling_states(card.id)
    scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=CardAnswer.GOOD))

    yield col
    col.close()
