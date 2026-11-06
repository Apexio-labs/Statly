"""How well the study time model would have predicted past days, on a copy of a collection.

For each of the last days, the model learns only from the days before it, forecasts that day's
work (the new cards it started and the reviews it held), and is compared with the time the day
really took. Run it before replacing the model, with the old and the new one, on the same
collection:

    uv run python scripts/backtest_goals.py --collection path/to/collection.anki2

Without --collection it uses the benchmark collection of scripts/bench_statistics.py, whose times
are random. The collection is copied first, so Anki may keep it open.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

from anki.collection import Collection

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "addon" / "src"))

from statly.core.reader import CollectionReader  # noqa: E402
from statly.modules.estimates.history import DAYS, MOST_ANSWERS  # noqa: E402
from statly.modules.estimates.sessions import DAY_MS, Answer, read_history  # noqa: E402
from statly.modules.estimates.study_time import MODEL, build, day_seconds, percentile  # noqa: E402

BENCH = ROOT / ".dev" / "bench" / "collection.anki2"
ENOUGH_ANSWERS = 10


def all_answers(reader: CollectionReader, since_ms: int) -> list[Answer]:
    return [
        Answer(int(at), int(card), int(deck) if deck is not None else None, int(kind), int(taken))
        for at, card, deck, kind, taken in reader.rows(
            """SELECT r.id, r.cid, CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END, r.type,
                r.time
            FROM revlog AS r LEFT JOIN cards AS c ON c.id = r.cid
            WHERE r.id >= ? AND r.ease > 0 AND r.type IN (0, 1, 2, 3)
            ORDER BY r.id""",
            since_ms,
        )
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection", type=Path, default=BENCH)
    parser.add_argument("--days", type=int, default=30, help="how many past days to forecast")
    options = parser.parse_args()
    if not options.collection.exists():
        print(f"No collection at {options.collection}. Run scripts/bench_statistics.py first.")
        return 1

    with tempfile.TemporaryDirectory() as folder:
        copy = Path(folder) / "collection.anki2"
        shutil.copy(options.collection, copy)
        collection = Collection(str(copy))
        try:
            reader = CollectionReader(collection)
            today_start = reader.day_cutoff * 1000 - DAY_MS
            presets = reader.deck_presets()
            answers = all_answers(reader, today_start - (options.days + DAYS) * DAY_MS)
        finally:
            collection.close()

    def limit_of(deck: int | None) -> float:
        found = presets.get(deck) if deck is not None else None
        return float(found[1]) if found else 60.0

    # What each day really took is read with everything known, the forecasts without the future.
    everything = read_history(answers, limit_of, today_start)
    hindsight = build(everything, presets)
    rows: list[tuple[int, int, float, float, float, float]] = []
    for day in range(options.days, 0, -1):
        entries = [entry for entry in everything.observed if entry.day == day]
        if len(entries) < ENOUGH_ANSWERS:
            continue
        start = today_start - (day - 1) * DAY_MS
        before = [answer for answer in answers if start - DAYS * DAY_MS <= answer.at_ms < start]
        profile = build(read_history(before[-MOST_ANSWERS:], limit_of, start), presets)
        real, _ = day_seconds(entries, hindsight)
        _, raw = day_seconds(entries, profile)
        low, middle, high = profile.spread
        rows.append((day, len(entries), raw * middle, raw * low, raw * high, real))

    if not rows:
        print("Not enough history to test.")
        return 1
    print(f"Model {MODEL}, {len(rows)} days with at least {ENOUGH_ANSWERS} answers\n")
    print(f"{'days ago':>8} {'answers':>8} {'forecast':>9} {'range':>15} {'real':>7}  inside")
    for day, count, expected, low, high, real in rows:
        inside = low <= real <= high
        span = f"{low / 60:.0f}\u2013{high / 60:.0f} min"
        print(
            f"{day:>8} {count:>8} {expected / 60:>5.0f} min {span:>15} {real / 60:>3.0f} min"
            f"  {'yes' if inside else 'no'}"
        )
    errors = [abs(expected - real) for _, _, expected, _, _, real in rows]
    ratios = [real / expected for _, _, expected, _, _, real in rows if expected > 0]
    inside = sum(1 for _, _, _, low, high, real in rows if low <= real <= high)
    print()
    print(f"Mean absolute error   {sum(errors) / len(errors) / 60:.1f} min")
    print(f"Mean relative error   {sum(abs(1 - r) for r in ratios) / len(ratios) * 100:.0f} %")
    print(f"Real / forecast       {percentile(ratios, 0.5):.2f} (middle day)")
    print(f"Inside the range      {inside} of {len(rows)} days ({inside / len(rows) * 100:.0f} %)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
