import type { ExamStatus, Goal, GoalDraft, MethodName, Params, Result } from "@statly/contract";

/**
 * Goals for `pnpm dev` and the browser tests. The numbers follow the same even split as Python,
 * simplified, so the setup's live preview reacts to every change the way the real one does.
 */

const DAY_MS = 86_400_000;

declare global {
  /** Lets browser tests say how much of the day's goal is done, from 0 to 1. */
  var __mockGoalShare: number | undefined;
}

const shareDone = () => globalThis.__mockGoalShare ?? 0.45;

const MOCK_DECKS = [
  { id: 1, name: "Sprachen", cards: 60, open: 20 },
  { id: 2, name: "Sprachen::Spanisch", cards: 240, open: 80 },
  { id: 3, name: "Medizin", cards: 90, open: 30 },
  { id: 4, name: "Medizin::Anatomie", cards: 420, open: 210 },
  { id: 5, name: "Medizin::Physiologie", cards: 300, open: 160 },
];

let mockGoals: Goal[] = [];
const celebrated = new Set<string>();
/** Goals whose limits were raised today, by the change that did it. */
const raised = new Map<string, string>();

type RaisedDeck = { deckId: number; deckName: string; before: number; after: number };

/** The dashboard mock keeps the change log, so it fills these in. */
export const mockRaise = {
  record: (_decks: RaisedDeck[]): string => "c0ffee0000000009",
  forget(changeId: string) {
    for (const [goalId, id] of raised) {
      if (id === changeId) {
        raised.delete(goalId);
      }
    }
  },
};

function isoDate(offsetDays: number, from = Date.now()): string {
  return new Date(from + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`);
}

/** 0 for Monday to 6 for Sunday, as in the contract. */
function weekday(iso: string): number {
  return (new Date(dayOf(iso)).getUTCDay() + 6) % 7;
}

function familyOf(id: number) {
  const root = MOCK_DECKS.find((deck) => deck.id === id);
  return root
    ? MOCK_DECKS.filter((deck) => deck.id === id || deck.name.startsWith(`${root.name}::`))
    : [];
}

function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    return weights.map(() => 0);
  }
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left === 0) {
      break;
    }
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

function mockStatus(goal: GoalDraft & { id: string }): ExamStatus {
  const { config } = goal;
  const today = isoDate(0);
  const exam = config.examDate;
  const deadline = isoDate(-(config.bufferDays + 1), dayOf(exam));
  const studies = (iso: string) =>
    config.studyWeekdays.includes(weekday(iso)) && !config.freeDates.includes(iso);
  const span = (from: string, to: string) => {
    const days: string[] = [];
    for (let at = dayOf(from); at <= dayOf(to); at += DAY_MS) {
      days.push(isoDate(0, at));
    }
    return days;
  };
  // A "reviewed" goal learns until three days before the deadline, so cards come back in time.
  const seenAgain = config.mode === "reviewed";
  const firstGap = 3;
  const learnBy = seenAgain ? isoDate(-firstGap, dayOf(deadline)) : deadline;
  const left = span(today, learnBy).filter(studies).length;
  const decks = config.decks.flatMap((chosen) =>
    familyOf(chosen.id).map((deck) => ({
      ...deck,
      parentId: deck.id === chosen.id ? null : chosen.id,
    })),
  );
  const open = decks.reduce((sum, deck) => sum + deck.open, 0);
  const studiesToday = studies(today) && today < exam;
  const target = studiesToday ? (left > 0 ? Math.ceil(open / left) : open) : 0;
  const done = Math.round(target * shareDone());
  const roots = decks.filter((deck) => deck.parentId === null);
  const subtree = (id: number) =>
    decks.filter((deck) => deck.id === id || deck.parentId === id).reduce((s, d) => s + d.open, 0);
  const rootTargets = share(
    target,
    roots.map((deck) => subtree(deck.id)),
  );
  const rootDone = share(
    done,
    roots.map((deck) => subtree(deck.id)),
  );
  const nodes = decks.map((deck) => {
    const rootIndex = roots.findIndex((root) => root.id === (deck.parentId ?? deck.id));
    const rootTarget = rootTargets[rootIndex] ?? 0;
    const rootOpen = subtree(roots[rootIndex]?.id ?? deck.id);
    const own = deck.parentId === null ? subtree(deck.id) : deck.open;
    const portion = (value: number) => (rootOpen ? Math.round((value * own) / rootOpen) : 0);
    return {
      deckId: deck.id,
      parentId: deck.parentId,
      name: deck.name,
      open: own,
      inProgress: Math.round(own * 0.03),
      target: deck.parentId === null ? rootTarget : portion(rootTarget),
      done: deck.parentId === null ? (rootDone[rootIndex] ?? 0) : portion(rootDone[rootIndex] ?? 0),
    };
  });
  const counted = config.counts === "newAndDue";
  const reviews = { target: 35, done: Math.round(35 * shareDone()), counted };
  const reviewsToday = reviews;
  const fullTarget = target + (counted ? reviews.target : 0);
  const fullDone = done + (counted ? reviews.done : 0);
  let remaining = Math.max(0, open - target);
  const plan = span(today, exam).map((day, index) => {
    const base = day >= exam ? "exam" : day > deadline ? "buffer" : studies(day) ? "study" : "rest";
    const kind = seenAgain && base === "study" && day > learnBy ? "review" : base;
    // Reviews: the mock's due cards thin out, and earlier new cards come back.
    const reviews = kind === "exam" ? 0 : index === 0 ? reviewsToday.target : 20 + (index % 5) * 3;
    if (index === 0) {
      return { date: day, target, reviews, kind } as const;
    }
    const daysLeft = span(day, learnBy).filter(studies).length;
    const planned = kind === "study" && daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
    remaining -= planned;
    return { date: day, target: planned, reviews, kind } as const;
  });
  const history = Array.from({ length: 14 }, (_, index) => {
    const date = isoDate(index - 13);
    if (index === 13) {
      return { date, target: fullTarget, done: fullDone, result: "pending" as const };
    }
    const result: "rest" | "missed" | "met" = !studies(date)
      ? "rest"
      : index === 6
        ? "missed"
        : "met";
    return { date, target: fullTarget, done: result === "met" ? fullTarget : 3, result };
  });
  const limited = raised.has(goal.id)
    ? []
    : nodes.filter((node) => node.parentId === null && node.target > 20);
  const learnedCards = decks.reduce((sum, deck) => sum + deck.cards - deck.open, 0);
  return {
    kind: "exam",
    goalId: goal.id,
    state:
      today >= exam ? "over" : today > deadline ? "buffer" : open === 0 ? "finished" : "active",
    tone:
      fullTarget === 0
        ? "rest"
        : fullDone >= fullTarget
          ? "done"
          : fullDone * 5 >= fullTarget * 2
            ? "progress"
            : "behind",
    today,
    deadline,
    examDate: exam,
    studyDaysLeft: left,
    target: fullTarget,
    done: fullDone,
    newCards: { target, done },
    reviews,
    tomorrow: {
      ifMet: Math.ceil(Math.max(0, open - target) / Math.max(1, left - 1)),
      ifStopped: Math.ceil(Math.max(0, open - done) / Math.max(1, left - 1)),
      inBuffer: left <= 1,
    },
    totals: {
      cards: decks.reduce((sum, deck) => sum + deck.cards, 0),
      learned: decks.reduce((sum, deck) => sum + deck.cards - deck.open, 0),
      open,
      inProgress: nodes.reduce(
        (sum, node) => sum + (node.parentId === null ? node.inProgress : 0),
        0,
      ),
      finished: seenAgain ? Math.round(learnedCards * 0.8) : null,
      waiting: seenAgain ? learnedCards - Math.round(learnedCards * 0.8) : null,
    },
    learnBy: seenAgain ? learnBy : null,
    firstGapDays: seenAgain ? firstGap : null,
    decks: nodes,
    streak:
      fullTarget > 0 && fullDone >= fullTarget
        ? { current: 7, best: 9, atRisk: false, milestone: 7 }
        : { current: 6, best: 9, atRisk: true, milestone: null },
    history,
    plan,
    warnings: [
      ...limited.map((node) => ({
        kind: "newLimit" as const,
        deckId: node.deckId,
        name: node.name,
        limit: 20,
        target: node.target,
      })),
      ...(seenAgain ? [{ kind: "lateCards" as const, cards: 4 }] : []),
    ],
    celebrate: fullTarget > 0 && fullDone >= fullTarget && !celebrated.has(goal.id),
    refreshAt: Math.floor((Date.now() + DAY_MS) / 1000),
    time: mockTime(target, done, reviews),
    algorithm: "exam.even-split/1",
  };
}

function span(seconds: number) {
  return {
    seconds: Math.round(seconds),
    low: Math.round(seconds * 0.85),
    high: Math.round(seconds * 1.2),
  };
}

/** The mock's pace: 45 seconds a new card, 12 a review. */
function mockTime(
  target: number,
  done: number,
  reviews: { target: number; done: number; counted: boolean },
) {
  const newCards = target * 45;
  const reviewTime = reviews.target * 12;
  const left =
    Math.max(0, target - done) * 45 +
    (reviews.counted ? Math.max(0, reviews.target - reviews.done) * 12 : 0);
  return {
    left: span(left),
    day: span(newCards + (reviews.counted ? reviewTime : 0)),
    newCards: span(newCards),
    reviews: span(reviewTime),
    model: "study-time/1",
  };
}

type GoalMethod = Extract<MethodName, `goals.${string}`>;

export const goalMocks: { [M in GoalMethod]: (params: Params<M>) => Result<M> } = {
  "goals.list": () => mockGoals,
  "goals.save": ({ goal }) => {
    const existing = mockGoals.find((item) => item.id === goal.id);
    const saved: Goal = {
      id: existing?.id ?? `exam-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`,
      version: 1,
      name: goal.name || goal.config.decks[0]?.name.split("::").at(-1) || "Exam",
      createdDay: existing?.createdDay ?? isoDate(0),
      updatedAt: Math.floor(Date.now() / 1000),
      archived: goal.archived,
      config: goal.config,
    };
    mockGoals = [...mockGoals.filter((item) => item.id !== saved.id), saved];
    return saved;
  },
  "goals.delete": ({ id }) => {
    mockGoals = mockGoals.filter((goal) => goal.id !== id);
    return null;
  },
  "goals.status": ({ id }) => {
    const goal = mockGoals.find((item) => item.id === id);
    if (!goal) {
      throw new Error("This goal no longer exists.");
    }
    return mockStatus(goal);
  },
  "goals.preview": ({ goal }) => mockStatus({ ...goal, id: goal.id ?? "exam-00000000" }),
  "goals.decks": () => MOCK_DECKS,
  "goals.acknowledge": ({ id }) => {
    celebrated.add(id);
    return null;
  },
  "goals.raiseLimit": ({ id }) => {
    const goal = mockGoals.find((item) => item.id === id);
    const limited = goal
      ? mockStatus(goal).warnings.flatMap((warning) =>
          warning.kind === "newLimit" ? [warning] : [],
        )
      : [];
    if (!goal || limited.length === 0) {
      return { applied: false, reason: "notNeeded" };
    }
    if (globalThis.__mockDenyPermissions) {
      return { applied: false, reason: "denied" };
    }
    const changeId = mockRaise.record(
      limited.map((warning) => ({
        deckId: warning.deckId,
        deckName: warning.name,
        before: warning.limit,
        after: warning.target,
      })),
    );
    raised.set(goal.id, changeId);
    return { applied: true, id: changeId };
  },
  "goals.openDeckOptions": () => null,
  "goals.overview": () =>
    mockGoals.map((goal) => {
      const status = mockStatus(goal);
      return {
        id: goal.id,
        name: goal.name,
        archived: goal.archived,
        decks: goal.config.decks.map((deck) => deck.name),
        examDate: goal.config.examDate,
        bufferDays: goal.config.bufferDays,
        mode: goal.config.mode,
        counts: goal.config.counts,
        state: status.state,
        today: { target: status.target, done: status.done },
        studyDaysLeft: status.studyDaysLeft,
        streak: { current: status.streak.current, best: status.streak.best },
        minutesLeft: status.time ? Math.round(status.time.left.seconds / 60) : null,
        warnings: status.warnings.map((warning) => warning.kind),
      };
    }),
};

/** Goals whose widgets the dashboard mock may keep. */
export function mockGoalIds(): string[] {
  return mockGoals.map((goal) => goal.id);
}
