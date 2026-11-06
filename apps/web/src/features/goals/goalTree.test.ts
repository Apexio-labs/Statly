import { describe, expect, it } from "vitest";
import { motivation } from "./examText.ts";
import { parentFocus, ringParts, toneOfShare } from "./goalTree.ts";
import { timelineDays } from "./timelineLayout.ts";

const deck = (
  deckId: number,
  parentId: number | null,
  name: string,
  open: number,
  target: number,
  done = 0,
) => ({
  deckId,
  parentId,
  name,
  open,
  inProgress: 0,
  target,
  done,
});

const decks = [
  deck(1, null, "Medizin", 300, 30, 10),
  deck(2, 1, "Medizin::Anatomie", 200, 20, 8),
  deck(3, 1, "Medizin::Physiologie", 60, 6),
  deck(4, null, "Sprachen", 100, 10, 10),
];

describe("the goal's ring", () => {
  it("shows the chosen decks and the day's reviews at the top", () => {
    const parts = ringParts(
      { decks, reviews: { target: 40, done: 50, counted: true } },
      null,
      "Reviews",
    );
    expect(parts.map((part) => [part.key, part.weight, part.opens])).toEqual([
      ["deck-1", 30, true],
      ["deck-4", 10, false],
      ["reviews", 40, false],
    ]);
    expect(parts[2]?.done).toBe(40);
  });

  it("opens a deck into its subdecks and keeps room for its own cards", () => {
    const parts = ringParts(
      { decks, reviews: { target: 0, done: 0, counted: false } },
      1,
      "Reviews",
    );
    expect(parts.map((part) => [part.key, part.weight, part.blank ?? false])).toEqual([
      ["own", 4, true],
      ["deck-2", 20, false],
      ["deck-3", 6, false],
    ]);
    expect(parentFocus(decks, 2)).toBe(1);
    expect(parentFocus(decks, 1)).toBeNull();
  });

  it("follows what is still open on a day without a goal", () => {
    const resting = decks.map((item) => ({ ...item, target: 0, done: 0 }));
    const parts = ringParts(
      { decks: resting, reviews: { target: 0, done: 0, counted: false } },
      null,
      "Reviews",
    );
    expect(parts.map((part) => part.weight)).toEqual([300, 100]);
  });

  it("colors each slice by its own share", () => {
    expect(toneOfShare(10, 10)).toBe("done");
    expect(toneOfShare(4, 10)).toBe("progress");
    expect(toneOfShare(3, 10)).toBe("behind");
    expect(toneOfShare(0, 0)).toBe("rest");
  });
});

describe("the line in the middle", () => {
  const base = {
    state: "active" as const,
    streak: { current: 0, best: 0, atRisk: false, milestone: null },
    totals: { cards: 100, learned: 40, open: 60, inProgress: 0, finished: null, waiting: null },
  };

  it("starts, keeps going and cheers near the end", () => {
    expect(motivation({ ...base, tone: "behind", target: 40, done: 0 })).toEqual({
      key: "goals.motivation.start",
      values: { count: 40 },
    });
    expect(motivation({ ...base, tone: "behind", target: 40, done: 10 }).key).toBe(
      "goals.motivation.going",
    );
    expect(motivation({ ...base, tone: "progress", target: 40, done: 20 }).key).toBe(
      "goals.motivation.halfway",
    );
    expect(motivation({ ...base, tone: "progress", target: 40, done: 35 })).toEqual({
      key: "goals.motivation.almost",
      values: { count: 5 },
    });
  });

  it("speaks of the streak when it is at stake or just grew", () => {
    const streak = { current: 6, best: 9, atRisk: true, milestone: null };
    expect(motivation({ ...base, streak, tone: "behind", target: 40, done: 0 })).toEqual({
      key: "goals.motivation.keepStreak",
      values: { count: 6, left: 40 },
    });
    expect(motivation({ ...base, streak, tone: "done", target: 40, done: 40 }).key).toBe(
      "goals.motivation.doneStreak",
    );
  });

  it("rests on a day off", () => {
    expect(motivation({ ...base, tone: "rest", target: 0, done: 0 }).key).toBe(
      "goals.motivation.rest",
    );
  });

  it("says when everything is learned and only waits to come back", () => {
    const totals = { ...base.totals, learned: 100, open: 0, finished: 92, waiting: 8 };
    expect(motivation({ ...base, totals, tone: "rest", target: 0, done: 0 })).toEqual({
      key: "goals.motivation.waiting",
      values: { count: 8 },
    });
  });
});

describe("the way to the exam", () => {
  it("shows the last days as they went, today, and the plan until the exam", () => {
    const days = timelineDays({
      today: "2026-11-05",
      target: 20,
      done: 5,
      reviews: { target: 0, done: 0, counted: false },
      history: [
        { date: "2026-11-03", target: 20, done: 20, result: "met" },
        { date: "2026-11-04", target: 20, done: 3, result: "missed" },
        { date: "2026-11-05", target: 20, done: 5, result: "pending" },
      ],
      plan: [
        { date: "2026-11-05", target: 20, reviews: 0, kind: "study" },
        { date: "2026-11-06", target: 40, reviews: 12, kind: "study" },
        { date: "2026-11-07", target: 0, reviews: 0, kind: "rest" },
        { date: "2026-11-08", target: 0, reviews: 0, kind: "buffer" },
        { date: "2026-11-09", target: 0, reviews: 0, kind: "exam" },
      ],
    });
    expect(days.map((day) => day.kind)).toEqual([
      "met",
      "missed",
      "today",
      "study",
      "free",
      "buffer",
      "exam",
    ]);
    expect(days.find((day) => day.kind === "today")?.height).toBe(0.5);
    expect(days.find((day) => day.date === "2026-11-06")?.height).toBe(1);
  });
});

describe("expected reviews on the way", () => {
  it("make part of each coming bar when the goal counts them", () => {
    const days = timelineDays({
      today: "2026-11-05",
      target: 20,
      done: 0,
      reviews: { target: 10, done: 0, counted: true },
      history: [],
      plan: [
        { date: "2026-11-05", target: 10, reviews: 10, kind: "study" },
        { date: "2026-11-06", target: 30, reviews: 10, kind: "study" },
        { date: "2026-11-07", target: 0, reviews: 20, kind: "review" },
      ],
    });
    const coming = days.find((day) => day.date === "2026-11-06");
    expect(coming?.height).toBe(1);
    expect(coming?.reviewShare).toBe(0.25);
    expect(days.at(-1)?.kind).toBe("review");
    expect(days.at(-1)?.height).toBe(0.5);
  });
});
