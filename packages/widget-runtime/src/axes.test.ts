import { describe, expect, it } from "vitest";
import { planAxes } from "./axes.ts";

describe("planAxes", () => {
  it("puts a count left and a share right", () => {
    const plan = planAxes([
      { axis: "auto", unit: "count" },
      { axis: "auto", unit: "percent" },
    ]);
    expect(plan.axes).toEqual([
      { side: "left", slot: 0, unit: "count" },
      { side: "right", slot: 0, unit: "percent" },
    ]);
    expect(plan.layerAxis).toEqual([0, 1]);
  });

  it("lets layers with the same unit share one scale", () => {
    const plan = planAxes([
      { axis: "auto", unit: "count" },
      { axis: "auto", unit: "count" },
      { axis: "auto", unit: "percent" },
    ]);
    expect(plan.axes).toHaveLength(2);
    expect(plan.layerAxis).toEqual([0, 0, 1]);
  });

  it("fills two scales per side, then hides the rest", () => {
    const units = ["count", "percent", "seconds", "minutes", "days"];
    const plan = planAxes(units.map((unit) => ({ axis: "auto" as const, unit })));
    expect(plan.axes).toEqual([
      { side: "left", slot: 0, unit: "count" },
      { side: "right", slot: 0, unit: "percent" },
      { side: "left", slot: 1, unit: "seconds" },
      { side: "right", slot: 1, unit: "minutes" },
      { side: "hidden", unit: "days" },
    ]);
  });

  it("keeps a chosen side, and auto works around it", () => {
    const plan = planAxes([
      { axis: "auto", unit: "count" },
      { axis: "right", unit: "count" },
      { axis: "auto", unit: "percent" },
    ]);
    // The chosen right side gets the count; the first auto layer shares it.
    expect(plan.axes[0]).toEqual({ side: "right", slot: 0, unit: "count" });
    expect(plan.layerAxis[0]).toBe(0);
    expect(plan.axes[plan.layerAxis[2] ?? -1]).toEqual({ side: "left", slot: 0, unit: "percent" });
  });

  it("gives a full side's extra layer a hidden scale", () => {
    const plan = planAxes([
      { axis: "left", unit: "count" },
      { axis: "left", unit: "percent" },
      { axis: "left", unit: "seconds" },
    ]);
    expect(plan.axes[plan.layerAxis[2] ?? -1]).toEqual({ side: "hidden", unit: "seconds" });
  });

  it("hides a scale on request and shares it within a unit", () => {
    const plan = planAxes([
      { axis: "none", unit: "count" },
      { axis: "none", unit: "count" },
    ]);
    expect(plan.axes).toEqual([{ side: "hidden", unit: "count" }]);
    expect(plan.layerAxis).toEqual([0, 0]);
  });
});
