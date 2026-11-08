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
    newCards: 35,
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
  "statistics.forecast": ({ days }) =>
    Array.from({ length: days ?? 7 }, (_, index) => ({
      date: isoDate(index),
      cards: Math.max(20, 300 - index * 20 + (reviewsOn(isoDate(index)) % 60)),
    })),
  "statistics.cardStates": () => ({
    new: 2100,
    learning: 84,
    review: 9800,
    suspended: 410,
    buried: 12,
    other: 0,
    mature: 6200,
  }),
  "statistics.forgotten": ({ limit }) => {
    const cards = [
      ["M. iliocostalis cervicis Ursprung", "Anatomie::Rücken", 9, 13, 1],
      ["Charakteristika seröser Drüsen (5)", "Histologie::Drüsen", 9, 11, 1],
      ["M. longissimus capitis Ursprung", "Anatomie::Rücken", 8, 13, 1],
      [
        "Gesichtspunkte zur Klassifizierung der exokrinen Drüsen (4)",
        "Histologie::Drüsen",
        8,
        11,
        1,
      ],
      ["Beschreibe das Verhalten der Deckzellen bei Füllung der Harnblase", "Histologie", 6, 8, 1],
      ["Topographie der Fascia thoracolumbalis", "Anatomie::Rücken", 5, 10, 3],
      ["Bänder der Wirbelsäule", "Anatomie::Rücken", 5, 9, 1],
      ["Zwerchfell in der Ansicht von kaudal", "Anatomie::Rumpf", 5, 8, 1],
      ["Aufbau u. Merkmale des Stratum parabasale", "Histologie", 5, 6, null],
      ["Merokrine Sekretion", "Histologie::Drüsen", 4, 8, 1],
      ["Nackenmuskulatur", "Anatomie::Rücken", 4, 7, 1],
    ] as const;
    return {
      total: 86,
      cards: cards.slice(0, limit ?? 20).map(([text, deck, forgot, seen, interval], index) => ({
        cardId: 1000 + index,
        text,
        deck,
        forgot,
        seen,
        intervalDays: interval,
      })),
    };
  },
  "statistics.deckTable": ({ measure }) => {
    const buckets = Array.from({ length: 12 }, (_, index) => isoDate(index * 30 - 330));
    const row = (
      deckId: number,
      parentId: number | null,
      name: string,
      path: string,
      count: number,
      hours: number,
      stability: number | null,
      mature: number,
      children = 0,
    ) => ({
      deckId,
      parentId,
      depth: parentId === null ? 0 : 1,
      name,
      path,
      count: scaled(count, measure),
      series: buckets.map((_, index) =>
        Math.round((count / 12) * (0.2 + ((index * 7 + deckId) % 9) / 6)),
      ),
      timeMs: hours * 3_600_000,
      retention: 0.6 + ((deckId * 13) % 30) / 100,
      cards: count * 2,
      matureShare: mature,
      stability,
      stabilityDays: stability === null ? null : 1 + deckId / 3,
      children,
    });
    return {
      buckets,
      stabilityKind: "stability",
      rows: [
        row(11, null, "Anatomie", "01_Vorklinik", 7783, 38, null, 0.01, 2),
        row(12, 11, "Rücken", "", 5120, 25, 1.04, 0.01),
        row(13, 11, "Rumpf", "", 2663, 13, 0.97, 0.02),
        row(14, null, "Terminologie", "01_Vorklinik", 6762, 31, 0.94, 0.17),
        row(15, null, "PhysikKlausur", "01_Vorklinik", 2837, 21, 1.08, 0.11),
        row(16, null, "Chemie", "01_Vorklinik", 2277, 12, 0.96, 0),
        row(17, null, "Anatomie (alt)", "03_Archiv", 1162, 5, 1.12, 0.03),
        row(18, null, "Biologie", "01_Vorklinik", 93, 0.04, null, 0),
      ],
    };
  },
  "statistics.daily": ({ start, end }) => {
    const days = [];
    for (let date = start; date <= end; date = nextDay(date)) {
      const reviews = reviewsOn(date);
      const ratings = scaled(reviews, "ratings");
      days.push({
        date,
        reviews,
        ratings,
        timeMs: ratings * (7000 + (reviews % 7) * 900),
        newCards: reviews % 40,
        checked: Math.round(reviews * 0.7),
        passed: Math.round(reviews * 0.7 * (0.78 + (reviews % 15) / 100)),
      });
    }
    return { days };
  },
  "statistics.answerMix": () => ({
    again: 105,
    hard: 47,
    good: 749,
    easy: 0,
    new: 35,
    learning: 149,
    review: 642,
    relearning: 75,
  }),
  "statistics.topics": () => ({
    retention: 0.89,
    weakest: [
      { deckId: 21, name: "Dickdarm", path: "Innere::Gastro", checked: 18, passed: 14 },
      { deckId: 22, name: "Sexualmedizin", path: "Gynäkologie", checked: 46, passed: 36 },
      { deckId: 23, name: "HPV und Zervixkarzinom", path: "Gynäkologie", checked: 35, passed: 28 },
      { deckId: 24, name: "Nephrotisches Syndrom", path: "Innere::Niere", checked: 13, passed: 11 },
      { deckId: 25, name: "Speicheldrüsen", path: "Innere::Gastro", checked: 23, passed: 20 },
    ],
    newFrom: [
      { deckId: 31, name: "Sexuell übertragbare Infektionen", path: "Gynäkologie", cards: 17 },
      { deckId: 32, name: "Ovar und Tube", path: "Gynäkologie", cards: 12 },
      { deckId: 33, name: "Koronarkreislauf", path: "Innere::Herz", cards: 1 },
    ],
    newCards: 35,
  }),
  "statistics.speed": () => {
    const shape = (center: number, width: number, total: number) =>
      Array.from({ length: 32 }, (_, index) => {
        const z = -3 + index * 0.25;
        return Math.round(total * Math.exp(-((z - center) ** 2) / (2 * width ** 2)) * 0.1);
      });
    const distribution = (center: number, focus: number, total: number) => ({
      answers: total,
      focus,
      medianMs: Math.round(6200 * Math.exp(center * 0.5)),
      quantiles: [center - 1.3, center - 0.55, center, center + 0.6, center + 1.9],
      histogram: shape(center, 0.8, total),
    });
    return {
      zLow: -3,
      zStep: 0.25,
      slowAt: 1,
      usualMs: { new: 14_000, review: 6200 },
      current: distribution(0.05, 0.87, 901),
      previous: distribution(0, 0.84, 757),
    };
  },
  "statistics.creation": ({ start, end, deckId }) => {
    const items = [];
    let date = end;
    while (items.length < 31 && date >= start) {
      const seed = reviewsOn(date);
      // Some days without new cards, the others with a pace around the usual 48 seconds.
      const cards = seed % 5 === 0 ? 0 : Math.round((seed % 17) + (deckId === null ? 4 : 1));
      const seconds = cards * (34 + (seed % 30));
      items.unshift({ date, seconds, cards, notes: Math.ceil(cards / 1.4) });
      date = previousDay(date);
    }
    const total = items.reduce(
      (sum, item) => ({
        seconds: sum.seconds + item.seconds,
        cards: sum.cards + item.cards,
        notes: sum.notes + item.notes,
      }),
      { seconds: 0, cards: 0, notes: 0 },
    );
    return {
      granularity: "day" as const,
      items,
      total,
      usualSecondsPerCard: 48,
      measuredSince: isoDate(-90),
    };
  },
  "statistics.sessions": ({ start, end }) => {
    const days = [];
    let date = end;
    while (days.length < 14 && date >= start) {
      const seed = reviewsOn(date);
      days.unshift({
        date,
        sessions: [
          { start: 8 * 3600 + seed * 20, end: 8.4 * 3600 + seed * 20, ratings: 48, focus: 0.9 },
          { start: 12 * 3600, end: 12.2 * 3600, ratings: 21, focus: 0.62 },
          { start: 15.5 * 3600, end: 16 * 3600 + seed * 9, ratings: 60, focus: 0.78 },
          { start: 20 * 3600, end: 21.1 * 3600, ratings: 310, focus: 0.71 },
          { start: 23.4 * 3600, end: 24.6 * 3600, ratings: 380, focus: 0.93 },
        ]
          .slice(0, 2 + (seed % 4))
          .map((session) => ({
            ...session,
            start: Math.round(session.start),
            end: Math.round(session.end),
            timeMs: session.ratings * 7800,
            retention: 0.86,
          })),
      });
      date = previousDay(date);
    }
    return {
      dayStartHour: 4,
      days,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        ratings: hour > 6 && hour < 24 ? (hour * 37) % 160 : 0,
        focus: hour > 6 ? 0.55 + ((hour * 7) % 40) / 100 : null,
      })),
    };
  },
};

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}
