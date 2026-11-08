import { describe, expect, it } from "vitest";
import { paceOf } from "./creationWidget.tsx";

describe("time spent making cards", () => {
  it("compares the time per card with the usual pace", () => {
    expect(paceOf(600, 10, 48)).toBe("above");
    expect(paceOf(400, 10, 48)).toBe("below");
    expect(paceOf(490, 10, 48)).toBe("usual");
  });

  it("says nothing without cards or without a usual pace", () => {
    expect(paceOf(0, 0, 48)).toBeNull();
    expect(paceOf(300, 5, null)).toBeNull();
  });
});
