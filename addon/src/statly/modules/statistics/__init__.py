"""Read-only statistics about the user's reviews and cards."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ...core.module import Context, Events
from ...core.reader import CollectionReader
from ..review import ANSWERED, UNDONE
from . import anki_stats, insights, metrics
from .cache import ResultCache

_METRICS = {
    "statistics.today": metrics.today,
    "statistics.decks": metrics.decks,
    "statistics.summary": metrics.summary,
    "statistics.categories": metrics.categories,
    "statistics.deckActivity": metrics.deck_activity,
    "statistics.timeline": metrics.timeline,
    "statistics.answerButtons": metrics.answer_buttons,
    "statistics.rhythm": metrics.rhythm,
    "statistics.heatmap": metrics.heatmap,
    "statistics.due": metrics.due,
    "statistics.forecast": metrics.forecast,
    "statistics.cardStates": metrics.card_states,
    "statistics.forgotten": insights.forgotten,
    "statistics.deckTable": insights.deck_table,
    "statistics.daily": insights.daily,
    "statistics.answerMix": insights.answer_mix,
    "statistics.topics": insights.topics,
    "statistics.speed": insights.speed,
    "statistics.sessions": insights.sessions,
}


class StatisticsModule:
    def __init__(self) -> None:
        self.cache = ResultCache()

    def register(self, context: Context) -> None:
        # Other modules cache their reads here too, so one sync clears everything at once.
        context.services["cache"] = self.cache
        for name, handler in _METRICS.items():
            context.router.query(name, self.cache.wrap(name, handler))
        graphs = self.cache.wrap("anki.graphs", anki_stats.load)

        def anki_view(params: Any, reader: CollectionReader) -> Any:
            return anki_stats.view(params, graphs({"deckId": params["deckId"]}, reader), reader)

        context.router.query("statistics.ankiView", anki_view)
        context.host.on_data_replaced(self.cache.clear)
        tell_after_answers(context.events, lambda: context.host.emit("statistics.changed", {}))


def tell_after_answers(events: Events, changed: Callable[[], None]) -> None:
    """The window counts again after every answer and undo while someone studies.

    The review module announces an answer only once the next card is on screen, so the new
    numbers are read while the person looks at that card. The window bundles what arrives
    while it is still counting, so at most one round of queries is ever queued.
    """
    events.subscribe(ANSWERED, lambda _attempt: changed())
    events.subscribe(UNDONE, lambda _attempt: changed())
