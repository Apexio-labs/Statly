import { describe, expect, it } from "vitest";
import { clamp, SIDEBAR_MAX, SIDEBAR_MIN, snapped } from "./sidebar.ts";

describe("sidebar", () => {
  it("snaps to an edge within 14 pixels", () => {
    expect(snapped(78, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(64);
    expect(snapped(246, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(260);
  });

  it("stays where it was dropped otherwise", () => {
    expect(snapped(79, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(79);
    expect(snapped(180, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(180);
  });

  it("cannot leave its range", () => {
    expect(clamp(10, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(64);
    expect(clamp(900, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(260);
  });
});
