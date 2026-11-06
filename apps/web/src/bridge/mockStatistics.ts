import type {
  AnkiView,
  AnkiViewResult,
  Measure,
  MethodName,
  Params,
  Result,
} from "@statly/contract";

const DAY_MS = 86_400_000;

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** A repeatable, plausible number of reviews for a day. */
function reviewsOn(date: string): number {
  const seed = [...date].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 7);
  return Math.abs(seed) % 180;
}

type StatisticsMethod = Extract<MethodName, `statistics.${string}`>;

function mockAnkiView(view: AnkiView, option: boolean): AnkiViewResult {
  const dates = Array.from({ length: 30 }, (_, index) => isoDate(index - 29));
  const facts = [{ name: "total", value: 1240, unit: "reviews" as const }];
  const counts = Array.from({ length: 12 }, (_, index) => ({
    start: index * 5,
    end: index * 5 + 4,
    value: 120 - index * 9,
    running: (index + 1) / 12,
  }));
  switch (view) {
    case "today":
      return {
        kind: "today",
        answers: 128,
        millis: 960_000,
        correct: 112,
        matureCorrect: 80,
        matureCount: 90,
        learn: 20,
        review: 96,
        relearn: 12,
        filtered: 0,
      };
    case "calendar":
      return {
        kind: "calendar",
        days: dates.map((date, index) => ({ date, reviews: index * 3 })),
        firstYear: 2025,
        lastYear: 2026,
      };
    case "card-counts":
      return {
        kind: "counts",
        items: [
          { name: "new", value: 420 },
          { name: "learning", value: 30 },
          { name: "relearning", value: 12 },
          { name: "young", value: 310 },
          { name: "mature", value: 880 },
          { name: "suspended", value: option ? 22 : 0 },
          { name: "buried", value: option ? 4 : 0 },
        ],
        total: option ? 1678 : 1652,
      };
    case "hours":
      return {
        kind: "hours",
        points: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          total: hour * 4,
          correct: hour * 3,
        })),
      };
    case "buttons":
      return {
        kind: "buttons",
        groups: [
          { name: "learning", counts: [20, 8, 90, 12], correct: 110, total: 130 },
          { name: "young", counts: [14, 22, 180, 30], correct: 232, total: 246 },
          { name: "mature", counts: [9, 18, 320, 44], correct: 382, total: 391 },
        ],
      };
    case "true-retention":
      return {
        kind: "retention",
        rows: (["today", "yesterday", "week", "month", "year", "all"] as const).map(
          (name, index) => ({
            name,
            youngPassed: 40 * (index + 1),
            youngFailed: 5 * (index + 1),
            maturePassed: 70 * (index + 1),
            matureFailed: 6 * (index + 1),
          }),
        ),
      };
    case "stability":
    case "retrievability":
      return { kind: "histogram", available: false, mode: "days", points: [], facts: [] };
    case "intervals":
    case "difficulty":
      return {
        kind: "histogram",
        available: true,
        mode: view === "difficulty" ? "ease" : "days",
        points: counts,
        facts: [{ name: "averageInterval", value: 41, unit: "days" }],
      };
    default:
      return {
        kind: "timeline",
        series: view === "reviews" ? ["mature", "young", "relearn", "learn", "filtered"] : ["due"],
        unit: "reviews",
        hasBacklog: view === "future-due",
        points: dates.map((date, index) => ({
          start: date,
          end: date,
          values: view === "reviews" ? [index, 5, 2, 3, 0] : [index],
          running: index * 11 + 1,
        })),
        facts,
      };
  }
}

/** Most cards take more than one answer: ratings run about a third above reviews. */
function scaled(value: number, measure: Measure | undefined): number {
  return measure === "ratings" ? Math.round(value * 1.35) : value;
}

export const statisticsMocks: { [M in StatisticsMethod]: (params: Params<M>) => Result<M> } = {
  "statistics.ankiView": ({ view, option }) => mockAnkiView(view, option),
  "statistics.today": () => ({ date: isoDate(0), firstReview: isoDate(-900) }),
  "statistics.decks": () => [
    { id: 1, name: "Sprachen" },
    { id: 2, name: "Sprachen::Spanisch" },
    { id: 3, name: "Medizin" },
  ],
  "statistics.summary": () => ({
    reviews: 412,
    ratings: scaled(412, "ratings"),
    studyTimeMs: 3_912_000,
    successRate: 0.91,
    retention: 0.88,
    activeDays: 6,
  }),
  "statistics.categories": () => ({
    total: 318,
    failed: 41,
    new: 37,
    reviewed: 244,
    relearned: 21,
    longInterval: 180,
    suspended: 3,
    buried: 5,
  }),
  "statistics.deckActivity": ({ measure }) => [
    { deckId: 2, name: "Sprachen::Spanisch", count: scaled(240, measure) },
    { deckId: 3, name: "Medizin", count: scaled(172, measure) },
  ],
  "statistics.timeline": ({ measure }) => {
    const items = Array.from({ length: 30 }, (_, index) => {
      const date = isoDate(index - 29);
      return { date, count: scaled(reviewsOn(date), measure), runningAverage: scaled(90, measure) };
    });
    return { granularity: "day", items };
  },
  "statistics.answerButtons": () => ({ again: 41, hard: 58, good: 271, easy: 42 }),
  "statistics.rhythm": ({ measure }) => ({
    weekdays: [80, 75, 90, 62, 44, 30, 31].map((value) => scaled(value, measure)),
    hours: Array.from({ length: 24 }, (_, hour) =>
      hour > 7 && hour < 23 ? scaled(hour * 4, measure) : 0,
    ),
  }),
  "statistics.heatmap": ({ year, measure }) => {
    const days = Array.from({ length: 365 }, (_, index) => {
      const date = isoDate(index - 364);
      return { date, count: scaled(reviewsOn(date), measure) };
    });
    return {
      year: year ?? new Date().getFullYear(),
      firstYear: 2023,
      lastYear: new Date().getFullYear(),
      today: isoDate(0),
      days,
      total: days.reduce((sum, day) => sum + day.count, 0),
      dailyAverage: scaled(90, measure),
      daysLearned: 0.97,
      longestStreak: 41,
      currentStreak: 12,
    };
  },
  "statistics.due": () => ({ cards: 4294 }),
  "statistics.forecast": () =>
    Array.from({ length: 7 }, (_, index) => ({ date: isoDate(index), cards: 300 - index * 20 })),
  "statistics.cardStates": () => ({
    new: 2100,
    learning: 84,
    review: 9800,
    suspended: 410,
    buried: 12,
    other: 0,
  }),
};
