import { describe, expect, it } from "vitest";
import { addDays, durationParts, shortDate, weekdayName } from "./format.ts";

describe("format", () => {
  it("splits durations", () => {
    expect(durationParts(3_725_000)).toEqual({ hours: 1, minutes: 2, seconds: 5 });
  });

  it("does not shift dates across time zones", () => {
    expect(shortDate("2026-01-01", "en-US")).toBe("Jan 1");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("names weekdays from Monday", () => {
    expect(weekdayName(0, "en-US")).toBe("Mon");
    expect(weekdayName(6, "en-US")).toBe("Sun");
  });
});
