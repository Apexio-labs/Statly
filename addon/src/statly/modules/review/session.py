"""What happens in Anki's reviewer, kept in memory while the person studies.

Nothing here reads or writes a database. Each answer is announced only once the next card is on
screen, so whoever listens can never delay it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ...core.module import Events, ShownCard

# Undo can only reach back so far in a session, so older answers need not stay around.
_KEEP_ANSWERED = 200

ANSWERED = "review.answered"
UNDONE = "review.undone"
FINISHED = "review.finished"


@dataclass
class Attempt:
    """One look at a card that ended with a button. Undone attempts are kept: they took time too."""

    key: int
    card_id: int
    deck_id: int
    card_type: int
    queue: int
    shown_at: float
    """When the question appeared, in seconds since 1970."""
    seconds: float
    """From question to answer."""
    inactive: float
    """The part of ``seconds`` with Anki in the background."""
    ease: int
    undone: bool = False


@dataclass
class _Showing:
    card: ShownCard
    shown_at: float
    started: float
    inactive: float = 0.0
    away_since: float | None = None


@dataclass
class ReviewSession:
    """Turns the reviewer's moments into attempts and tells other modules about them."""

    events: Events
    wall_clock: Callable[[], float]
    monotonic: Callable[[], float]
    later: Callable[[Callable[[], None]], None]
    _showing: _Showing | None = None
    _waiting: list[Attempt] = field(default_factory=list[Attempt])
    _answered: list[Attempt] = field(default_factory=list[Attempt])
    _undo_seen: bool = False
    _active: bool = True
    _next_key: int = 0

    def question_shown(self, card: ShownCard) -> None:
        if self._undo_seen:
            self._undo_seen = False
            self._take_back(card.card_id)
        now = self.monotonic()
        self._showing = _Showing(
            card, self.wall_clock(), now, away_since=None if self._active else now
        )
        if self._waiting:
            # The next card is on screen now, so the last answer can be counted without delaying it.
            self.later(self._announce)

    def will_answer(self, card_id: int, ease: int) -> None:
        showing = self._showing
        if showing is None or showing.card.card_id != card_id:
            return
        now = self.monotonic()
        away = showing.inactive + (
            now - showing.away_since if showing.away_since is not None else 0.0
        )
        self._next_key += 1
        card = showing.card
        self._waiting.append(
            Attempt(
                key=self._next_key,
                card_id=card.card_id,
                deck_id=card.deck_id,
                card_type=card.card_type,
                queue=card.queue,
                shown_at=showing.shown_at,
                seconds=max(0.0, now - showing.started),
                inactive=min(away, max(0.0, now - showing.started)),
                ease=ease,
            )
        )
        self._showing = None

    def answer_undone(self) -> None:
        """Anki took an answer back. The card it brings back again tells which one.

        Anki's reviewer may show that card before or after it reports the undo, so both orders
        work: a card already back on screen is matched now, otherwise the next one is.
        """
        showing = self._showing
        if showing is not None and self._newest_card() == showing.card.card_id:
            self._take_back(showing.card.card_id)
        else:
            self._undo_seen = True

    def _newest_card(self) -> int | None:
        for attempt in reversed(self._answered + self._waiting):
            if not attempt.undone:
                return attempt.card_id
        return None

    def app_active(self, active: bool) -> None:
        self._active = active
        showing = self._showing
        if showing is None:
            return
        now = self.monotonic()
        if not active and showing.away_since is None:
            showing.away_since = now
        elif active and showing.away_since is not None:
            showing.inactive += now - showing.away_since
            showing.away_since = None

    def state_changed(self, new_state: str, old_state: str) -> None:
        if old_state == "review" and new_state != "review":
            self._showing = None
            self._announce()
            self.events.publish(FINISHED)

    def _announce(self) -> None:
        waiting, self._waiting = self._waiting, []
        for attempt in waiting:
            self._answered.append(attempt)
            self.events.publish(ANSWERED, attempt)
        del self._answered[:-_KEEP_ANSWERED]

    def _take_back(self, card_id: int) -> None:
        """Undo brought ``card_id`` back, so its newest answer no longer stands."""
        for attempt in reversed(self._answered + self._waiting):
            if attempt.undone:
                continue
            if attempt.card_id == card_id:
                attempt.undone = True
                if attempt not in self._waiting:
                    self.events.publish(UNDONE, attempt)
            return
