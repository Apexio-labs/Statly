"""Read-only statistics about the user's reviews and cards."""

from __future__ import annotations

from typing import Any

from ...core.module import Context
from ...core.reader import CollectionReader
from . import anki_stats, metrics
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
}


class StatisticsModule:
    def __init__(self) -> None:
        self.cache = ResultCache()

    def register(self, context: Context) -> None:
        for name, handler in _METRICS.items():
            context.router.query(name, self.cache.wrap(name, handler))
        graphs = self.cache.wrap("anki.graphs", anki_stats.load)

        def anki_view(params: Any, reader: CollectionReader) -> Any:
            return anki_stats.view(params, graphs({"deckId": params["deckId"]}, reader), reader)

        context.router.query("statistics.ankiView", anki_view)
        context.host.on_data_replaced(self.cache.clear)
