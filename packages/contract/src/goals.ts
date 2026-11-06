import { z } from "zod";

/**
 * Study goals. A goal is the main thing: it has a history, a streak and warnings of its own, and a
 * dashboard widget is only a window onto it. Its type is `goal:<id>:<view>`, so one goal can be on
 * the dashboard as a ring and as a timeline at once.
 *
 * Every kind of goal is one entry in `goalConfig` and `goalStatus`, told apart by `kind`.
 */
export const goalKinds = ["exam"] as const;
export type GoalKind = (typeof goalKinds)[number];

export const goalViews = ["ring", "timeline"] as const;
export type GoalView = (typeof goalViews)[number];

export const goalWidgetPrefix = "goal:";
export const goalWidgetSizes = {
  ring: { minW: 3, maxW: 8, minH: 4, maxH: 12, w: 4, h: 6 },
  timeline: { minW: 6, maxW: 12, minH: 3, maxH: 10, w: 8, h: 5 },
} as const satisfies Record<GoalView, Record<string, number>>;

export const maxGoals = 50;

/** Streak lengths that earn a badge. Python celebrates the same ones. */
export const streakMilestones = [3, 7, 14, 30, 50, 100] as const;

/**
 * "learned": every card goes through its learning steps once.
 * "reviewed": every card is learned early enough that Anki shows it once more on a later day,
 * before the deadline.
 */
export const goalModes = ["learned", "reviewed"] as const;
/** What a day's goal counts: the planned new cards and the due reviews, or new cards only. */
export const goalCounts = ["newAndDue", "newOnly"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();

export const goalId = z.string().regex(/^[a-z]+-[a-f0-9]{8}$/);

/** A chosen deck. The name is kept so a deleted deck can still be named in a warning. */
const deckRef = z.object({ id: z.number().int(), name: z.string().max(400) }).strict();

export const examConfig = z
  .object({
    kind: z.literal("exam"),
    /** A chosen parent deck covers its subdecks, including ones added later. */
    decks: z.array(deckRef).min(1).max(50),
    examDate: isoDate,
    /** Days before the exam that stay free for revision. */
    bufferDays: z.number().int().min(0).max(60),
    mode: z.enum(goalModes),
    counts: z.enum(goalCounts),
    /** Days of the week with studying, 0 for Monday to 6 for Sunday. */
    studyWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Single days off, such as a birthday. */
    freeDates: z.array(isoDate).max(366),
  })
  .strict();
export type ExamConfig = z.output<typeof examConfig>;

export const goalConfig = z.discriminatedUnion("kind", [examConfig]);
export type GoalConfig = z.output<typeof goalConfig>;

export const goal = z
  .object({
    id: goalId,
    version: z.literal(1),
    name: z.string().min(1).max(80),
    createdDay: isoDate,
    updatedAt: z.number().int(),
    archived: z.boolean(),
    config: goalConfig,
  })
  .strict();
export type Goal = z.output<typeof goal>;

/**
 * What the setup page sends. Python gives a new goal its id and its first day, and an empty name
 * becomes the name of the first deck.
 */
export const goalDraft = z
  .object({
    id: goalId.nullable(),
    name: z.string().max(80),
    archived: z.boolean(),
    config: goalConfig,
  })
  .strict();
export type GoalDraft = z.output<typeof goalDraft>;

/** One deck of a goal. Chosen decks have no parent, their subdecks follow below them. */
const goalDeck = z
  .object({
    deckId: z.number().int(),
    parentId: z.number().int().nullable(),
    name: z.string().max(400),
    /** Cards still to learn when the day began. */
    open: count,
    /** Started and still in the learning steps. */
    inProgress: count,
    /** New cards for today, and how many of them are learned. */
    target: count,
    done: count,
  })
  .strict();

const goalWarning = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deckMissing"), name: z.string().max(400) }).strict(),
  z.object({ kind: z.literal("suspended"), cards: count }).strict(),
  /** Learned cards Anki would show again only after the deadline. */
  z.object({ kind: z.literal("lateCards"), cards: count }).strict(),
  /** Too late for cards learned from now on to come back before the deadline. */
  z.object({ kind: z.literal("noTimeToReview"), days: count }).strict(),
  z
    .object({
      kind: z.literal("newLimit"),
      deckId: z.number().int(),
      name: z.string().max(400),
      limit: count,
      target: count,
    })
    .strict(),
]);

const goalDay = z
  .object({
    date: isoDate,
    target: count,
    done: count,
    result: z.enum(["met", "missed", "rest", "pending"]),
  })
  .strict();

const goalPlanDay = z
  .object({
    date: isoDate,
    /** New cards planned for that day, assuming each day before it is met. */
    target: count,
    /** Reviews expected that day: cards already due then, and the planned ones coming back. */
    reviews: count,
    /** "review": a study day after the last day for new cards, to see learned cards again. */
    kind: z.enum(["study", "review", "rest", "buffer", "exam"]),
  })
  .strict();

/** Seconds, with the range the forecast fell into on most of the person's past days. */
export const studyTime = z
  .object({
    seconds: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
  })
  .strict();
export type StudyTime = z.output<typeof studyTime>;

export const examStatus = z
  .object({
    kind: z.literal("exam"),
    goalId,
    state: z.enum(["active", "buffer", "finished", "over", "noDecks"]),
    /** Red below 40 percent, yellow from 40, green once the day's goal is met. */
    tone: z.enum(["done", "progress", "behind", "rest"]),
    today: isoDate,
    deadline: isoDate,
    examDate: isoDate,
    studyDaysLeft: count,
    /** What counts for today by the chosen rule, and how much of it is done. */
    target: count,
    done: count,
    newCards: z.object({ target: count, done: count }).strict(),
    /** Due reviews. `counted` says whether they are part of the day's goal. */
    reviews: z.object({ target: count, done: count, counted: z.boolean() }).strict(),
    tomorrow: z.object({ ifMet: count, ifStopped: count, inBuffer: z.boolean() }).strict(),
    totals: z
      .object({
        cards: count,
        learned: count,
        open: count,
        inProgress: count,
        /** Learned and seen again on a later day. Only counted for "reviewed" goals. */
        finished: count.nullable(),
        /** Learned, but not seen again yet. Only counted for "reviewed" goals. */
        waiting: count.nullable(),
      })
      .strict(),
    /** "reviewed" goals: the last day for new cards, and how many days a card needs to return. */
    learnBy: isoDate.nullable(),
    firstGapDays: count.nullable(),
    decks: z.array(goalDeck).max(2000),
    streak: z
      .object({ current: count, best: count, atRisk: z.boolean(), milestone: count.nullable() })
      .strict(),
    history: z.array(goalDay).max(400),
    plan: z.array(goalPlanDay).max(400),
    warnings: z.array(goalWarning).max(60),
    /** Today's goal was just met and the celebration has not been shown yet. */
    celebrate: z.boolean(),
    /** When the next Anki day begins, as Unix seconds, so an open page can count again. */
    refreshAt: z.number().int(),
    /** How long today takes by the person's own pace. Null when there is nothing to study. */
    time: z
      .object({
        /** What is left of today's goal. */
        left: studyTime,
        /** All of today's goal, done or not. */
        day: studyTime,
        /** Today's new cards, and today's reviews, also when they are not part of the goal. */
        newCards: studyTime,
        reviews: studyTime,
        /** Which model in which version made the estimate. */
        model: z.string().max(40),
      })
      .strict()
      .nullable(),
    /** Which algorithm in which version worked out these numbers. */
    algorithm: z.string().max(60),
  })
  .strict();
export type ExamStatus = z.output<typeof examStatus>;

export const goalStatus = z.discriminatedUnion("kind", [examStatus]);
export type GoalStatus = z.output<typeof goalStatus>;

/**
 * A goal as the assistant reads it with get_goals: short, so it fits a small model's context.
 * Without permission for deck names, goal and deck names are replaced by numbers.
 */
export const goalOverview = z
  .object({
    id: goalId,
    name: z.string().max(400),
    archived: z.boolean(),
    decks: z.array(z.string().max(400)).max(50),
    examDate: isoDate,
    bufferDays: count,
    mode: z.enum(goalModes),
    counts: z.enum(goalCounts),
    state: z.enum(["active", "buffer", "finished", "over", "noDecks"]),
    today: z.object({ target: count, done: count }).strict(),
    studyDaysLeft: count,
    streak: z.object({ current: count, best: count }).strict(),
    /** Minutes left for today by the person's own pace, if known. */
    minutesLeft: count.nullable(),
    warnings: z.array(z.string().max(40)).max(60),
  })
  .strict();
export type GoalOverview = z.output<typeof goalOverview>;

/** Decks a goal can use: no filtered decks, with how many cards are still to learn. */
export const goalDeckChoice = z
  .object({ id: z.number().int(), name: z.string().max(400), cards: count, open: count })
  .strict();
export type GoalDeckChoice = z.output<typeof goalDeckChoice>;
