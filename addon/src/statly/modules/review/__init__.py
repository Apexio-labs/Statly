"""Anki's reviewer as other modules see it: attempts, undo and the end of a session.

The stopwatch and the goals both listen here, so Statly hooks into the reviewer only once. See
``session.py`` for why nothing here may touch a database.
"""

from __future__ import annotations

from ...core.module import Context
from .session import ANSWERED, FINISHED, UNDONE, Attempt, ReviewSession

__all__ = ["ANSWERED", "FINISHED", "UNDONE", "Attempt", "ReviewModule", "ReviewSession"]


class ReviewModule:
    def register(self, context: Context) -> None:
        host = context.host
        session = ReviewSession(context.events, host.wall_clock, host.monotonic, host.later)
        context.services["review"] = session
        host.on_question_shown(session.question_shown)
        host.on_will_answer(session.will_answer)
        host.on_answer_undone(session.answer_undone)
        host.on_app_active(session.app_active)
        host.on_state_changed(session.state_changed)
