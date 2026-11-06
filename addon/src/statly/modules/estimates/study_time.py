"""Study time, version 1: how long a day's cards take, from the person's own history. Pure.

Per options preset and card state (learning, review, relearning), a log-normal fit gives the
average time per answer. Small presets lean on the person's overall pace. Added to that are the
seconds between two cards, how many answers a new card needs until it is learned, and how often a
review fails and needs relearning. The last 30 days then say how far such a forecast was off on
real days, which calibrates it and gives an honest range.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from .censored import LogNormal, fit
from .returns import echo, first_gaps
from .sessions import LEARN, RELEARN, REVIEW, History, Observed

MODEL = "study-time/1"

# A preset with few answers counts the person's overall pace as this many answers.
_LEAN = 30.0
# Before there is any history: rough times of a typical Anki user.
_DEFAULT_SECONDS = {LEARN: 8.0, REVIEW: 8.0, RELEARN: 10.0}
_DEFAULT_ANSWERS_PER_NEW = 3.0
_DEFAULT_RELEARN_SHARE = 0.15
_ENOUGH_CARDS = 10
_DEFAULT_SPREAD = (0.75, 1.0, 1.35)
_SPREAD_DAYS = 30
_ENOUGH_ANSWERS_A_DAY = 10
_ENOUGH_DAYS = 7
_LOW, _HIGH = 0.2, 0.8


@dataclass(frozen=True)
class Estimate:
    """Seconds, with the range the forecast fell into on most past days."""

    seconds: float
    low: float
    high: float
    model: str = MODEL

    def __add__(self, other: Estimate) -> Estimate:
        return Estimate(self.seconds + other.seconds, self.low + other.low, self.high + other.high)

    def as_json(self) -> dict[str, int]:
        return {"seconds": round(self.seconds), "low": round(self.low), "high": round(self.high)}


NOTHING = Estimate(0.0, 0.0, 0.0)


@dataclass(frozen=True)
class Pace:
    """How long answers take in one options preset, or for the person overall."""

    seconds: Mapping[str, float]
    answers_per_new: float
    relearn_share: float

    def new_card(self, between: float) -> float:
        return self.answers_per_new * (self.seconds[LEARN] + between)

    def review(self, between: float) -> float:
        return (
            self.seconds[REVIEW] + between + self.relearn_share * (self.seconds[RELEARN] + between)
        )


DEFAULT_PACE = Pace(_DEFAULT_SECONDS, _DEFAULT_ANSWERS_PER_NEW, _DEFAULT_RELEARN_SHARE)


@dataclass(frozen=True)
class Profile:
    overall: Pace
    between: float
    spread: tuple[float, float, float] = _DEFAULT_SPREAD
    """Real time divided by forecast on past days: low, middle and high."""
    presets: Mapping[int, Pace] = field(default_factory=dict[int, Pace])
    preset_of: Mapping[int, int] = field(default_factory=dict[int, int])
    fits: Mapping[tuple[int | None, str], LogNormal] = field(
        default_factory=dict[tuple[int | None, str], LogNormal]
    )
    gaps: Mapping[int | None, Sequence[int]] = field(
        default_factory=dict[int | None, Sequence[int]]
    )
    """First intervals of learned cards by home deck, see ``returns.py``."""
    echo: Sequence[float | None] = ()

    def pace(self, deck_id: int | None) -> Pace:
        preset = self.preset_of.get(deck_id) if deck_id is not None else None
        return self.presets.get(preset, self.overall) if preset is not None else self.overall

    def raw(self, work: Iterable[tuple[int | None, float, float]]) -> float:
        """Seconds for (deck, new cards, reviews), before calibration."""
        total = 0.0
        for deck_id, new_cards, reviews in work:
            pace = self.pace(deck_id)
            total += new_cards * pace.new_card(self.between) + reviews * pace.review(self.between)
        return total

    def predict(self, work: Iterable[tuple[int | None, float, float]]) -> Estimate:
        seconds = self.raw(work)
        low, middle, high = self.spread
        return Estimate(seconds * middle, seconds * low, seconds * high)


def build(
    history: History, presets: Mapping[int, tuple[int, int]], today_start_ms: int = 0
) -> Profile:
    """A profile from the observations. ``presets`` maps a deck to (preset, time limit)."""
    preset_of = {deck: preset for deck, (preset, _limit) in presets.items()}

    def preset(entry: Observed) -> int | None:
        deck = entry.answer.deck_id
        return preset_of.get(deck) if deck is not None else None

    by_state: dict[str, list[Observed]] = defaultdict(list)
    by_group: dict[tuple[int, str], list[Observed]] = defaultdict(list)
    by_preset: dict[int, list[Observed]] = defaultdict(list)
    for entry in history.observed:
        by_state[entry.state].append(entry)
        group = preset(entry)
        if group is not None:
            by_group[(group, entry.state)].append(entry)
            by_preset[group].append(entry)

    fits: dict[tuple[int | None, str], LogNormal] = {}
    for state, entries in by_state.items():
        found = fit(entry.observation for entry in entries)
        if found is not None:
            fits[(None, state)] = found
    for (group, state), entries in by_group.items():
        found = fit((entry.observation for entry in entries), fits.get((None, state)), _LEAN)
        if found is not None:
            fits[(group, state)] = found

    overall = _pace(fits, None, history.observed, DEFAULT_PACE)
    paces = {group: _pace(fits, group, entries, overall) for group, entries in by_preset.items()}
    profile = Profile(overall, history.between, presets=paces, preset_of=preset_of, fits=fits)
    spread = _spread(history.observed, profile)
    answers = [entry.answer for entry in history.observed]
    return Profile(
        overall,
        history.between,
        spread,
        presets=paces,
        preset_of=preset_of,
        fits=fits,
        gaps=first_gaps(answers),
        echo=echo(answers, today_start_ms),
    )


def _pace(
    fits: Mapping[tuple[int | None, str], LogNormal],
    group: int | None,
    entries: Sequence[Observed],
    fallback: Pace,
) -> Pace:
    seconds = {
        state: fits[(group, state)].mean if (group, state) in fits else fallback.seconds[state]
        for state in (LEARN, REVIEW, RELEARN)
    }
    learning = [entry for entry in entries if entry.state == LEARN]
    cards = {entry.answer.card_id for entry in learning}
    reviews = sum(1 for entry in entries if entry.state == REVIEW)
    relearning = sum(1 for entry in entries if entry.state == RELEARN)
    return Pace(
        seconds,
        len(learning) / len(cards) if len(cards) >= _ENOUGH_CARDS else fallback.answers_per_new,
        relearning / reviews if reviews >= _ENOUGH_CARDS else fallback.relearn_share,
    )


def actual_seconds(entry: Observed, model: LogNormal | None) -> float:
    """The best guess of one answer's real time, its rough values filled in."""
    low, high = entry.observation.low, entry.observation.high
    if low == high:
        return low
    if high != float("inf"):
        return (low + high) / 2
    return model.mean_above(low) if model is not None else low


def _spread(observed: Sequence[Observed], profile: Profile) -> tuple[float, float, float]:
    """How far a forecast from each past day's work was off from that day's real time."""
    days: dict[int, list[Observed]] = defaultdict(list)
    for entry in observed:
        if 1 <= entry.day <= _SPREAD_DAYS:
            days[entry.day].append(entry)
    ratios: list[float] = []
    for entries in days.values():
        if len(entries) < _ENOUGH_ANSWERS_A_DAY:
            continue
        real, forecast = day_seconds(entries, profile)
        if forecast > 0:
            ratios.append(real / forecast)
    if len(ratios) < _ENOUGH_DAYS:
        return _DEFAULT_SPREAD
    middle = min(max(percentile(ratios, 0.5), 0.5), 2.0)
    return (
        min(percentile(ratios, _LOW), middle),
        middle,
        max(percentile(ratios, _HIGH), middle),
    )


def day_seconds(entries: Sequence[Observed], profile: Profile) -> tuple[float, float]:
    """One day's real seconds and the uncalibrated forecast for the work it held."""
    real = 0.0
    new_cards: dict[int | None, set[int]] = defaultdict(set)
    reviews: dict[int | None, int] = defaultdict(int)
    for entry in entries:
        deck = entry.answer.deck_id
        group = profile.preset_of.get(deck) if deck is not None else None
        real += actual_seconds(entry, profile.fits.get((group, entry.state))) + profile.between
        if entry.state == LEARN:
            new_cards[deck].add(entry.answer.card_id)
        elif entry.state == REVIEW:
            reviews[deck] += 1
    decks = set(new_cards) | set(reviews)
    forecast = profile.raw((deck, len(new_cards[deck]), reviews[deck]) for deck in decks)
    return real, forecast


def percentile(values: Sequence[float], share: float) -> float:
    ordered = sorted(values)
    position = share * (len(ordered) - 1)
    below = int(position)
    above = min(below + 1, len(ordered) - 1)
    return ordered[below] + (ordered[above] - ordered[below]) * (position - below)
