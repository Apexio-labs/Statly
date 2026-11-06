"""The exam goal: how many cards a day to learn every card before the exam.

Pure: settings, counts and a frozen morning go in, numbers come out. No Anki, no clock, no files,
so the same input always gives the same answer and every rule here can be tested with exact
numbers. ``inputs.py`` collects the counts, ``service.py`` keeps the history.

The idea in one sentence: what is still open is spread evenly over the study days left before the
deadline, every morning anew. Whoever learns less today has more open tomorrow and one day less,
so the plan corrects itself.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from ..allocate import largest_remainder
from ..days import StudyCalendar, deadline, every_day

ALGORITHM = "exam.even-split/1"
ONE_DAY = timedelta(days=1)


@dataclass(frozen=True)
class DeckCounts:
    """One deck of the goal, counted on its own, without its subdecks."""

    deck_id: int
    parent_id: int | None
    name: str
    cards: int
    suspended: int
    learned: int
    in_progress: int
    due_reviews: int
    new_limit: int | None = None
    # Only counted for "reviewed" goals: learned and seen again, and learned cards Anki would
    # show again only after the deadline.
    finished: int = 0
    late: int = 0


@dataclass(frozen=True)
class DayCounts:
    """One deck on one day: what was open when the day began, and what was done that day."""

    open_at_start: int
    learned: int
    reviewed: int


@dataclass(frozen=True)
class ExamInputs:
    today: date
    decks: tuple[DeckCounts, ...]
    days: Mapping[date, Mapping[int, DayCounts]]
    missing: tuple[str, ...] = ()
    refresh_at: int = 0
    # The ids of cards added today that are open today. Anki gives every new card a higher id.
    added_today: tuple[int, ...] = ()
    # The highest card id in the collection now, so a day's goal knows what came after it.
    newest_card: int = 0
    # Reviews due on each coming day, 0 being today with everything overdue.
    due_by_day: Mapping[int, int] = field(default_factory=dict[int, int])
    # Filled in by the service from the person's own history, see ``estimates/returns.py``.
    first_gap_days: int = 1
    echo: Sequence[float] = ()


@dataclass(frozen=True)
class FrozenDay:
    """What the day's goal was fixed to when the day was first counted, and the newest card then."""

    open_at_start: int
    reviews_at_start: int
    newest_card: int = 0


@dataclass(frozen=True)
class DeckPlan:
    deck_id: int
    parent_id: int | None
    name: str
    open: int
    in_progress: int
    target: int
    done: int


@dataclass(frozen=True)
class PlanDay:
    day: date
    target: int
    kind: str
    reviews: int = 0


@dataclass(frozen=True)
class ExamPlan:
    state: str
    today: date
    deadline: date
    exam: date
    study_days_left: int
    open_at_start: int
    reviews_at_start: int
    new_target: int
    new_done: int
    review_target: int
    review_done: int
    reviews_counted: bool
    tomorrow_if_met: int
    tomorrow_if_stopped: int
    tomorrow_in_buffer: bool
    totals: Mapping[str, int | None]
    decks: tuple[DeckPlan, ...]
    plan: tuple[PlanDay, ...]
    warnings: tuple[Mapping[str, Any], ...] = field(default=())
    # "reviewed" goals only: the last day for new cards, and the days a card needs to return.
    learn_by: date | None = None
    first_gap: int | None = None

    @property
    def target(self) -> int:
        return self.new_target + (self.review_target if self.reviews_counted else 0)

    @property
    def done(self) -> int:
        return self.new_done + (self.review_done if self.reviews_counted else 0)


def ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def day_result(
    new_target: int, new_done: int, review_target: int, review_done: int, is_today: bool
) -> str:
    """Both parts count on their own, so many reviews cannot hide too few new cards."""
    if new_target + review_target == 0:
        return "rest"
    if new_done >= new_target and review_done >= review_target:
        return "met"
    return "pending" if is_today else "missed"


def tone(new_target: int, new_done: int, review_target: int, review_done: int) -> str:
    """Red below 40 percent, yellow from 40 percent, green when met. Extra work does not count
    twice, so more reviews than needed cannot make up for missing new cards."""
    target = new_target + review_target
    if target == 0:
        return "rest"
    if new_done >= new_target and review_done >= review_target:
        return "done"
    progress = min(new_done, new_target) + min(review_done, review_target)
    return "progress" if progress * 5 >= target * 2 else "behind"


def _sum(counts: Mapping[int, DayCounts], name: str) -> int:
    return sum(getattr(entry, name) for entry in counts.values())


def _days_for_new(today: date, last: date, exam: date, calendar: StudyCalendar) -> tuple[int, bool]:
    """Study days left for new cards. Past the deadline, the buffer days before the exam."""
    if today <= last:
        return calendar.count(today, last), False
    return calendar.count(today, exam - ONE_DAY), True


def learning_until(day: date, learn_by: date, last: date, calendar: StudyCalendar) -> date:
    """The last day for new cards as seen from ``day``.

    A "reviewed" goal learns until ``learn_by``, so each card comes back once before ``last``.
    Once no study day is left until then, it learns until ``last`` like a "learned" goal: late
    is better than never. For a "learned" goal both days are the same.
    """
    return learn_by if calendar.count(day, learn_by) > 0 else last


def new_cards_for(
    open_cards: int, day: date, last: date, exam: date, calendar: StudyCalendar
) -> int:
    """What one day has to learn of what is open, if that day is a study day."""
    if open_cards <= 0 or day >= exam or not calendar.studies_on(day):
        return 0
    left, _in_buffer = _days_for_new(day, last, exam, calendar)
    return open_cards if left == 0 else min(open_cards, ceil_div(open_cards, left))


def plan(config: Mapping[str, Any], inputs: ExamInputs, frozen: FrozenDay | None) -> ExamPlan:
    calendar = StudyCalendar.of(config["studyWeekdays"], config["freeDates"])
    exam = date.fromisoformat(config["examDate"])
    last = deadline(exam, config["bufferDays"])
    today = inputs.today
    counted = config["counts"] == "newAndDue"
    today_counts = inputs.days.get(today, {})
    reviewed = config.get("mode") == "reviewed"
    gap = max(1, inputs.first_gap_days) if reviewed else 0
    learn_by = last - timedelta(days=gap)

    def until(day: date) -> date:
        return learning_until(day, learn_by, last, calendar)

    # What arrives during the day counts from tomorrow, what goes away counts at once.
    open_now = _sum(today_counts, "open_at_start")
    new_done = _sum(today_counts, "learned")
    review_done = _sum(today_counts, "reviewed")
    reviews_now = sum(deck.due_reviews for deck in inputs.decks) + review_done
    if frozen:
        # Cards added after the goal was fixed wait for tomorrow. Deleted ones are gone from
        # ``open_now`` already, so they lower today's goal right away, whatever else arrived.
        arrived = sum(1 for card in inputs.added_today if card > frozen.newest_card)
        open_start = min(frozen.open_at_start, open_now - arrived)
    else:
        open_start = open_now
    reviews_start = min(frozen.reviews_at_start, reviews_now) if frozen else reviews_now

    learned = sum(deck.learned for deck in inputs.decks)
    finished = sum(deck.finished for deck in inputs.decks)
    waiting = max(0, learned - finished) if reviewed else 0
    if not inputs.decks:
        state = "noDecks"
    elif today >= exam:
        state = "over"
    elif today > last:
        state = "buffer"
    elif open_start == 0 and waiting == 0:
        state = "finished"
    else:
        state = "active"

    studies_today = calendar.studies_on(today) and state not in ("over", "noDecks")
    new_target = (
        new_cards_for(open_start, today, until(today), exam, calendar) if studies_today else 0
    )
    review_target = reviews_start if counted and studies_today else 0
    days_left, _ = _days_for_new(today, until(today), exam, calendar)

    # Cards that arrived after the morning count was fixed join from tomorrow on.
    arrived = max(0, open_now - open_start)
    left_if_met = max(0, open_start - max(new_done, new_target)) + arrived
    left_if_stopped = max(0, open_start - new_done) + arrived
    tomorrow = _next_study_day(today, exam, calendar)
    if tomorrow is None:
        if_met = if_stopped = 0
        tomorrow_in_buffer = False
    else:
        if_met = new_cards_for(left_if_met, tomorrow, until(tomorrow), exam, calendar)
        if_stopped = new_cards_for(left_if_stopped, tomorrow, until(tomorrow), exam, calendar)
        tomorrow_in_buffer = tomorrow > last

    decks = _deck_plans(inputs, new_target)
    unlearned = sum(deck.cards - deck.learned for deck in inputs.decks)
    warnings = list(_warnings(inputs, decks))
    if reviewed:
        late = sum(deck.late for deck in inputs.decks)
        if late:
            warnings.append({"kind": "lateCards", "cards": late})
        if open_start > 0 and today <= last and until(today) != learn_by:
            warnings.append({"kind": "noTimeToReview", "days": gap})
    return ExamPlan(
        state=state,
        today=today,
        deadline=last,
        exam=exam,
        study_days_left=days_left,
        open_at_start=open_start,
        reviews_at_start=reviews_start,
        new_target=new_target,
        new_done=new_done,
        review_target=review_target,
        review_done=review_done,
        reviews_counted=counted,
        tomorrow_if_met=if_met,
        tomorrow_if_stopped=if_stopped,
        tomorrow_in_buffer=tomorrow_in_buffer,
        totals={
            "cards": sum(deck.cards for deck in inputs.decks),
            "learned": learned,
            "open": unlearned,
            "inProgress": sum(deck.in_progress for deck in inputs.decks),
            "finished": finished if reviewed else None,
            "waiting": waiting if reviewed else None,
        },
        decks=decks,
        plan=_days_ahead(
            Ahead(
                today,
                last,
                exam,
                calendar,
                until,
                learn_by if reviewed and until(today) == learn_by else None,
            ),
            new_target,
            left_if_met,
            reviews_start,
            inputs,
        ),
        warnings=tuple(warnings),
        learn_by=learn_by if reviewed else None,
        first_gap=gap if reviewed else None,
    )


def replay(config: Mapping[str, Any], inputs: ExamInputs, day: date) -> tuple[int, int, int, int]:
    """A past day nobody counted live, worked out again from Anki's history.

    Returns new target, review target, new done and reviews done. Which reviews were due that
    morning is no longer known, so the reviews done stand in for them and never cause a miss.
    """
    calendar = StudyCalendar.of(config["studyWeekdays"], config["freeDates"])
    exam = date.fromisoformat(config["examDate"])
    last = deadline(exam, config["bufferDays"])
    counts = inputs.days.get(day, {})
    open_start = _sum(counts, "open_at_start")
    learned = _sum(counts, "learned")
    reviewed = _sum(counts, "reviewed")
    gap = max(1, inputs.first_gap_days) if config.get("mode") == "reviewed" else 0
    learn_by = last - timedelta(days=gap)
    until = learning_until(day, learn_by, last, calendar)
    new_target = new_cards_for(open_start, day, until, exam, calendar)
    counted = config["counts"] == "newAndDue" and calendar.studies_on(day) and day < exam
    return new_target, reviewed if counted else 0, learned, reviewed


def _next_study_day(today: date, exam: date, calendar: StudyCalendar) -> date | None:
    for day in every_day(today + ONE_DAY, exam - ONE_DAY):
        if calendar.studies_on(day):
            return day
    return None


@dataclass(frozen=True)
class Ahead:
    """What every coming day is planned against."""

    today: date
    last: date
    exam: date
    calendar: StudyCalendar
    until: Callable[[date], date]
    learn_by: date | None
    """For a "reviewed" goal on time: study days after it are there to see cards again."""


def _days_ahead(
    ahead: Ahead, today_target: int, left: int, reviews_today: int, inputs: ExamInputs
) -> tuple[PlanDay, ...]:
    """Today and every day until the exam, each assuming the days before it were met.

    Reviews of a coming day are the cards already due then, and the cards planned before it
    coming back as the person's own history says they do (``inputs.echo``).
    """
    today, last, exam, calendar = ahead.today, ahead.last, ahead.exam, ahead.calendar
    targets = [today_target]
    kinds = [_kind(today, last, exam, calendar)]
    for day in every_day(today + ONE_DAY, exam):
        target = new_cards_for(left, day, ahead.until(day), exam, calendar)
        left -= target
        targets.append(target)
        kinds.append(_kind(day, last, exam, calendar))
    days: list[PlanDay] = []
    echo = inputs.echo
    for index, (target, kind) in enumerate(zip(targets[:400], kinds[:400], strict=True)):
        day = today + timedelta(days=index)
        if index == 0:
            reviews = reviews_today
        elif kind == "exam":
            reviews = 0
        else:
            back = sum(
                targets[start] * echo[index - start]
                for start in range(max(0, index - len(echo) + 1), index)
            )
            reviews = inputs.due_by_day.get(index, 0) + round(back)
        if ahead.learn_by is not None and kind == "study" and day > ahead.learn_by:
            kind = "review"
        days.append(PlanDay(day, target, kind, reviews))
    return tuple(days)


def _kind(day: date, last: date, exam: date, calendar: StudyCalendar) -> str:
    if day >= exam:
        return "exam"
    if day > last:
        return "buffer"
    return "study" if calendar.studies_on(day) else "rest"


def _deck_plans(inputs: ExamInputs, new_target: int) -> tuple[DeckPlan, ...]:
    """Split today's new cards over the chosen decks, and inside each deck over its subdecks,
    by what each had open in the morning. Each level adds up exactly."""
    today_counts = inputs.days.get(inputs.today, {})
    children: dict[int | None, list[DeckCounts]] = {}
    for deck in inputs.decks:
        children.setdefault(deck.parent_id, []).append(deck)

    def open_of(deck: DeckCounts) -> int:
        entry = today_counts.get(deck.deck_id)
        return entry.open_at_start if entry else 0

    def subtree(deck: DeckCounts, name: str) -> int:
        own = open_of(deck) if name == "open" else _own(deck, name, today_counts)
        return own + sum(subtree(child, name) for child in children.get(deck.deck_id, []))

    plans: list[DeckPlan] = []

    def place(decks: Sequence[DeckCounts], total: int, with_own: int | None) -> None:
        weights = [subtree(deck, "open") for deck in decks]
        if with_own is not None:
            parts = largest_remainder(total, [with_own, *weights], [with_own, *weights])
            parts = parts[1:]
        else:
            parts = largest_remainder(total, weights, weights)
        for deck, part in zip(decks, parts, strict=True):
            plans.append(
                DeckPlan(
                    deck_id=deck.deck_id,
                    parent_id=deck.parent_id,
                    name=deck.name,
                    open=subtree(deck, "open"),
                    in_progress=subtree(deck, "in_progress"),
                    target=part,
                    done=subtree(deck, "learned"),
                )
            )
            below = children.get(deck.deck_id, [])
            if below:
                place(below, part, open_of(deck))

    place(children.get(None, []), new_target, None)
    return tuple(plans)


def _own(deck: DeckCounts, name: str, today_counts: Mapping[int, DayCounts]) -> int:
    if name == "learned":
        entry = today_counts.get(deck.deck_id)
        return entry.learned if entry else 0
    return getattr(deck, name)


def _warnings(inputs: ExamInputs, decks: Sequence[DeckPlan]) -> tuple[Mapping[str, Any], ...]:
    found: list[Mapping[str, Any]] = [
        {"kind": "deckMissing", "name": name} for name in inputs.missing
    ]
    suspended = sum(deck.suspended for deck in inputs.decks)
    if suspended:
        found.append({"kind": "suspended", "cards": suspended})
    # Anki applies the limit of each deck inside the one studied, so subdecks count too.
    limits = {deck.deck_id: deck.new_limit for deck in inputs.decks}
    for deck in decks:
        limit = limits.get(deck.deck_id)
        if limit is not None and limit < deck.target:
            found.append(
                {
                    "kind": "newLimit",
                    "deckId": deck.deck_id,
                    "name": deck.name,
                    "limit": limit,
                    "target": deck.target,
                }
            )
    return tuple(found)
