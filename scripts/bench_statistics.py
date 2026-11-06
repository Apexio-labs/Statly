"""Measure every statistic on a synthetic collection with one million reviews."""

from __future__ import annotations

import random
import sqlite3
import sys
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

from anki.collection import Collection

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "addon" / "src"))

from statly.core.reader import CollectionReader  # noqa: E402
from statly.modules.estimates import StudyTime  # noqa: E402
from statly.modules.goals.exam.inputs import collect  # noqa: E402
from statly.modules.goals.exam.plan import plan  # noqa: E402
from statly.modules.statistics import _METRICS  # noqa: E402
from statly.modules.statistics.cache import ResultCache  # noqa: E402
from statly.modules.statistics.calendar import AnkiCalendar  # noqa: E402

PATH = ROOT / ".dev" / "bench" / "collection.anki2"
NOTES = 100_000
REVIEWS = 1_000_000
DECKS = 20
DAY_MS = 86_400_000
BUDGET_COLD_MS = 1000
BUDGET_CACHED_MS = 300
BUDGET_GOAL_COLD_MS = 150
BUDGET_GOAL_CACHED_MS = 10
BUDGET_STUDY_TIME_MS = 100
BUDGET_REVIEWED_GOAL_MS = 400


def build() -> None:
    random.seed(7)
    PATH.parent.mkdir(parents=True, exist_ok=True)
    collection = Collection(str(PATH))
    deck_ids = [collection.decks.id(f"Bench::Deck {index:02}") for index in range(DECKS)]
    notetype: Any = collection.models.by_name("Basic")
    collection.close()

    now_ms = int(time.time() * 1000)
    now_seconds = now_ms // 1000
    database = sqlite3.connect(PATH)
    notes: list[tuple[Any, ...]] = []
    cards: list[tuple[Any, ...]] = []
    for index in range(NOTES):
        identifier = 1_500_000_000_000 + index
        fields = f"front {index}\x1fback {index}"
        notes.append(
            (identifier, f"g{index}", notetype["id"], now_seconds, -1, "", fields, "", 1, 0, "")
        )
        kind, queue, due = (0, 0, index) if index % 10 == 0 else (2, 2, random.randint(0, 400))
        deck_id, interval = random.choice(deck_ids), random.randint(1, 300)
        scheduling = (kind, queue, due, interval, 2500, 10, 1, 0, 0, 0, 0, "")
        cards.append((identifier, identifier, deck_id, 0, now_seconds, -1, *scheduling))
    database.executemany("insert into notes values (?,?,?,?,?,?,?,?,?,?,?)", notes)
    database.executemany("insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cards)

    start_ms = now_ms - 3 * 365 * DAY_MS
    moments = sorted(random.sample(range(0, now_ms - start_ms, 1000), REVIEWS))
    database.executemany(
        "insert into revlog values (?,?,-1,?,10,5,2500,?,1)",
        (
            (
                start_ms + moment,
                1_500_000_000_000 + random.randrange(NOTES),
                random.choice((1, 2, 3, 3, 3, 3, 4)),
                random.randint(1000, 20000),
            )
            for moment in moments
        ),
    )
    database.commit()
    database.close()


def parameters(name: str, reader: CollectionReader, deck_id: int | None) -> dict[str, Any]:
    if name in ("statistics.today", "statistics.decks"):
        return {}
    if name == "statistics.heatmap":
        return {"year": None, "deckId": deck_id}
    if name in ("statistics.due", "statistics.forecast", "statistics.cardStates"):
        return {"deckId": deck_id}
    today = AnkiCalendar(reader.day_cutoff).today
    start = today - timedelta(days=364)
    return {"start": start.isoformat(), "end": today.isoformat(), "deckId": deck_id}


def run_all(reader: CollectionReader, cache: ResultCache, deck_id: int | None) -> dict[str, float]:
    timings: dict[str, float] = {}
    for name, handler in _METRICS.items():
        started = time.perf_counter()
        cache.wrap(name, handler)(parameters(name, reader, deck_id), reader)
        timings[name] = (time.perf_counter() - started) * 1000
    return timings


def time_anki_page(reader: CollectionReader, deck_id: int | None) -> float:
    """Anki's whole statistics page, which only people with such widgets ever wait for."""
    started = time.perf_counter()
    reader.graphs(deck_id)
    return (time.perf_counter() - started) * 1000


def time_goal(
    reader: CollectionReader, cache: ResultCache, deck_id: int, mode: str = "learned"
) -> tuple[float, float]:
    """One exam goal counted from a week of history, first without and then with the cache."""
    today = AnkiCalendar(reader.day_cutoff).today
    config = {
        "kind": "exam",
        "decks": [{"id": deck_id, "name": reader.deck_names()[deck_id]}],
        "examDate": (today + timedelta(days=30)).isoformat(),
        "bufferDays": 3,
        "mode": mode,
        "counts": "newAndDue",
        "studyWeekdays": [0, 1, 2, 3, 4, 5],
        "freeDates": [],
    }
    read = cache.wrap(
        "goals.inputs",
        lambda params, reader: collect(reader, params["config"], today - timedelta(days=7)),
    )
    timings: list[float] = []
    for _ in range(2):
        started = time.perf_counter()
        plan(config, read({"config": config, "origin": "week"}, reader), None)
        timings.append((time.perf_counter() - started) * 1000)
    return timings[0], timings[1]


def time_study_time(reader: CollectionReader) -> tuple[float, float, int]:
    """The person's pace from 90 days of answers, first without and then with the cache."""
    cache = ResultCache()
    service = StudyTime(cache.wrap, None)
    timings: list[float] = []
    for _ in range(2):
        started = time.perf_counter()
        service.profile(reader)
        timings.append((time.perf_counter() - started) * 1000)
    since = (reader.day_cutoff - 90 * 86_400) * 1000
    answers = int(reader.scalar("SELECT COUNT(*) FROM revlog WHERE id >= ?", since))
    return timings[0], timings[1], answers


def main() -> int:
    if not PATH.exists():
        print("Building the benchmark collection ...")
        build()
    collection = Collection(str(PATH))
    try:
        reader = CollectionReader(collection)
        deck_id = next(iter(k for k, v in reader.deck_names().items() if v == "Bench"))
        cache = ResultCache()
        cold = run_all(reader, cache, None)
        cached = run_all(reader, cache, None)
        one_deck = run_all(reader, cache, deck_id)
        anki_page = time_anki_page(reader, None)
        anki_page_deck = time_anki_page(reader, deck_id)
        one = next(iter(k for k, v in reader.deck_names().items() if v == "Bench::Deck 00"))
        goal_all = time_goal(reader, ResultCache(), deck_id)
        goal_one = time_goal(reader, ResultCache(), one)
        study_time = time_study_time(reader)
        reviewed_all = time_goal(reader, ResultCache(), deck_id, "reviewed")
    finally:
        collection.close()

    print(f"{'metric':<28}{'cold':>10}{'one deck':>10}{'cached':>10}")
    for name, value in cold.items():
        print(f"{name:<28}{value:>9.1f} {one_deck[name]:>9.1f} {cached[name]:>9.1f}")
    cold_total, cached_total = sum(cold.values()), sum(cached.values())
    print(f"{'total ms':<28}{cold_total:>9.1f} {sum(one_deck.values()):>9.1f} {cached_total:>9.1f}")
    print(f"{'anki statistics page':<28}{anki_page:>9.1f} {anki_page_deck:>9.1f}")
    print(f"{'goal over all decks':<28}{goal_all[0]:>9.1f} {'':>9} {goal_all[1]:>9.1f}")
    print(f"{'goal over one deck':<28}{goal_one[0]:>9.1f} {'':>9} {goal_one[1]:>9.1f}")
    print(
        f"{'goal seen again, all decks':<28}{reviewed_all[0]:>9.1f} {'':>9} {reviewed_all[1]:>9.1f}"
    )
    print(f"{'study time profile':<28}{study_time[0]:>9.1f} {'':>9} {study_time[1]:>9.1f}")
    print(f"  ({study_time[2]} answers in the last 90 days, the newest 25,000 read)")
    if (
        cold_total > BUDGET_COLD_MS
        or cached_total > BUDGET_CACHED_MS
        or max(anki_page, anki_page_deck) > BUDGET_COLD_MS
        or max(goal_all[0], goal_one[0]) > BUDGET_GOAL_COLD_MS
        or max(goal_all[1], goal_one[1]) > BUDGET_GOAL_CACHED_MS
        or study_time[0] > BUDGET_STUDY_TIME_MS
        or reviewed_all[0] > BUDGET_REVIEWED_GOAL_MS
    ):
        print("Over budget.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
