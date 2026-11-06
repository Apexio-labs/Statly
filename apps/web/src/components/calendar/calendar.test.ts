import { describe, expect, it } from "vitest";
import {
  addMonths,
  clickDay,
  formatDay,
  monthGrid,
  parseDay,
  selectBetween,
  typedDay,
} from "./calendar.ts";

describe("monthGrid", () => {
  it("starts on a Monday and marks days of other months", () => {
    const grid = monthGrid(2026, 9);
    expect(grid[0]).toEqual({ date: "2026-09-28", outside: true });
    expect(grid[3]).toEqual({ date: "2026-10-01", outside: false });
    expect(grid).toHaveLength(42);
  });
});

describe("choosing days", () => {
  const range = { start: "2026-01-01", end: "2026-01-02", anchor: null };

  it("makes one click a whole, usable day", () => {
    expect(clickDay(range, "2026-03-05")).toEqual({
      start: "2026-03-05",
      end: "2026-03-05",
      anchor: "2026-03-05",
    });
  });

  it("stretches the range with the second click, in either direction", () => {
    const first = clickDay(range, "2026-03-05");
    expect(clickDay(first, "2026-03-09")).toEqual({
      start: "2026-03-05",
      end: "2026-03-09",
      anchor: null,
    });
    expect(clickDay(first, "2026-03-01")).toEqual({
      start: "2026-03-01",
      end: "2026-03-05",
      anchor: null,
    });
  });

  it("starts anew after a finished range", () => {
    const finished = clickDay(clickDay(range, "2026-03-05"), "2026-03-09");
    expect(clickDay(finished, "2026-04-01").start).toBe("2026-04-01");
  });

  it("sorts a dragged range whichever way it went", () => {
    expect(selectBetween("2026-03-09", "2026-03-05").start).toBe("2026-03-05");
  });
});

describe("typing a date", () => {
  it("adds the dots by itself", () => {
    expect(typedDay("31102026")).toBe("31.10.2026");
    expect(typedDay("311")).toBe("31.1");
    expect(typedDay("31.10.2026")).toBe("31.10.2026");
    expect(typedDay("abc")).toBe("");
  });
});

describe("day text", () => {
  it("round-trips", () => {
    expect(parseDay(formatDay("2026-10-31"))).toBe("2026-10-31");
  });

  it("refuses dates that do not exist", () => {
    expect(parseDay("31.02.2026")).toBeNull();
    expect(parseDay("nonsense")).toBeNull();
  });
});

describe("addMonths", () => {
  it("crosses years", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  });
});
