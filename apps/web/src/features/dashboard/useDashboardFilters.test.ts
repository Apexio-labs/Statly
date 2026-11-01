import { describe, expect, it } from "vitest";
import { ALL_DECKS, deckIdOf, rangeOf } from "./useDashboardFilters.ts";

const base = { today: "2026-10-31", firstReview: "2024-02-01", custom: null };

describe("dashboard filters", () => {
  it("includes today in every rolling range", () => {
    expect(rangeOf({ ...base, preset: "today" })).toEqual({
      start: "2026-10-31",
      end: "2026-10-31",
    });
    expect(rangeOf({ ...base, preset: "last7" })).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
    });
  });

  it("offers yesterday alone", () => {
    expect(rangeOf({ ...base, preset: "yesterday" })).toEqual({
      start: "2026-10-30",
      end: "2026-10-30",
    });
  });

  it("reaches back to the first review", () => {
    expect(rangeOf({ ...base, preset: "all" }).start).toBe("2024-02-01");
    expect(rangeOf({ ...base, firstReview: null, preset: "all" }).start).toBe("2026-10-31");
  });

  it("uses a custom range as given", () => {
    const custom = { start: "2026-01-01", end: "2026-02-01" };
    expect(rangeOf({ ...base, preset: "custom", custom })).toEqual(custom);
  });

  it("uses no deck for all decks", () => {
    expect(deckIdOf(ALL_DECKS)).toBeNull();
    expect(deckIdOf("123")).toBe(123);
  });
});
