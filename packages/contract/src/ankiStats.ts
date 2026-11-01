import { z } from "zod";

/** Anki's statistics page, one widget per section. Each widget is named `anki-<view>`. */
export const ankiViews = [
  "today",
  "future-due",
  "calendar",
  "reviews",
  "card-counts",
  "intervals",
  "stability",
  "difficulty",
  "retrievability",
  "hours",
  "buttons",
  "added",
  "true-retention",
] as const;
export type AnkiView = (typeof ankiViews)[number];

/** "half" and "most" keep 50 % and 95 % of the cards, the rest are time ranges. */
export const ankiRanges = ["month", "threeMonths", "year", "all", "half", "most"] as const;

const count = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ankiFact = z
  .object({
    name: z.string(),
    value: z.number(),
    unit: z.enum([
      "reviews",
      "cards",
      "notes",
      "minutes",
      "seconds",
      "days",
      "percent",
      "cardsPerMinute",
    ]),
    /** For "12 of 30". */
    of: z.number().optional(),
  })
  .strict();

const today = z
  .object({
    kind: z.literal("today"),
    answers: count,
    millis: count,
    correct: count,
    matureCorrect: count,
    matureCount: count,
    learn: count,
    review: count,
    relearn: count,
    filtered: count,
  })
  .strict();

const timeline = z
  .object({
    kind: z.literal("timeline"),
    series: z.array(z.string()),
    unit: z.enum(["reviews", "cards", "minutes"]),
    hasBacklog: z.boolean().optional(),
    points: z.array(
      z
        .object({
          start: isoDate,
          end: isoDate,
          values: z.array(z.number()),
          running: z.number(),
        })
        .strict(),
    ),
    facts: z.array(ankiFact),
  })
  .strict();

const histogram = z
  .object({
    kind: z.literal("histogram"),
    /** False when this section needs FSRS and the collection does not use it. */
    available: z.boolean(),
    mode: z.enum(["days", "ease", "difficulty", "retrievability"]),
    points: z.array(
      z
        .object({
          start: z.number().int(),
          end: z.number().int(),
          value: count,
          /** Share of all cards up to here, from 0 to 1. */
          running: z.number(),
        })
        .strict(),
    ),
    facts: z.array(ankiFact),
  })
  .strict();

const hours = z
  .object({
    kind: z.literal("hours"),
    points: z.array(z.object({ hour: z.number().int(), total: count, correct: count }).strict()),
  })
  .strict();

const buttons = z
  .object({
    kind: z.literal("buttons"),
    groups: z.array(
      z
        .object({
          name: z.enum(["learning", "young", "mature"]),
          counts: z.array(count),
          correct: count,
          total: count,
        })
        .strict(),
    ),
  })
  .strict();

const counts = z
  .object({
    kind: z.literal("counts"),
    items: z.array(z.object({ name: z.string(), value: count }).strict()),
    total: count,
  })
  .strict();

const calendar = z
  .object({
    kind: z.literal("calendar"),
    days: z.array(z.object({ date: isoDate, reviews: count }).strict()),
    firstYear: z.number().int(),
    lastYear: z.number().int(),
  })
  .strict();

const retention = z
  .object({
    kind: z.literal("retention"),
    rows: z.array(
      z
        .object({
          name: z.enum(["today", "yesterday", "week", "month", "year", "all"]),
          youngPassed: count,
          youngFailed: count,
          maturePassed: count,
          matureFailed: count,
        })
        .strict(),
    ),
  })
  .strict();

export const ankiViewParams = z
  .object({
    view: z.enum(ankiViews),
    deckId: z.number().int().nullable(),
    range: z.enum(ankiRanges),
    /** Reviews: show time. Future due: include the backlog. Card counts: keep inactive apart. */
    option: z.boolean(),
  })
  .strict();

export const ankiViewResult = z.discriminatedUnion("kind", [
  today,
  timeline,
  histogram,
  hours,
  buttons,
  counts,
  calendar,
  retention,
]);

export type AnkiViewResult = z.output<typeof ankiViewResult>;
export type AnkiFact = z.output<typeof ankiFact>;
