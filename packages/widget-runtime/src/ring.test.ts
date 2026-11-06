import { describe, expect, it } from "vitest";
import { FULL_TURN, filledEnd, slicePath, slices } from "./ring.ts";

const weight = (item: { w: number }) => item.w;

describe("ring slices", () => {
  it("share the circle by weight and keep gaps between them", () => {
    const placed = slices([{ w: 1 }, { w: 3 }], weight, 0, FULL_TURN, 0.1);
    expect(placed).toHaveLength(2);
    const [first, second] = placed;
    expect(first?.start).toBe(0);
    const firstSize = (first?.end ?? 0) - (first?.start ?? 0);
    const secondSize = (second?.end ?? 0) - (second?.start ?? 0);
    expect(secondSize / firstSize).toBeCloseTo(3);
    expect((second?.start ?? 0) - (first?.end ?? 0)).toBeCloseTo(0.1);
    expect((second?.end ?? 0) + 0.1).toBeCloseTo(FULL_TURN);
  });

  it("give a single item the whole span and leave weightless ones out", () => {
    const placed = slices([{ w: 0 }, { w: 5 }], weight);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.start).toBe(0);
    expect(placed[0]?.end).toBeCloseTo(FULL_TURN);
    expect(slices([{ w: 0 }], weight)).toEqual([]);
  });

  it("can split only part of a circle, for the ring outside a slice", () => {
    const placed = slices([{ w: 1 }, { w: 1 }], weight, 1, 2, 0.1);
    expect(placed[0]?.start).toBe(1);
    expect(placed[1]?.end).toBeCloseTo(2);
  });
});

describe("ring paths", () => {
  it("draw a slice as two arcs joined by straight lines", () => {
    const path = slicePath(50, 50, 30, 40, 0, Math.PI / 2);
    expect(path.startsWith("M50 10 A40 40 0 0 1 90 50 L80 50 A30 30 0 0 0 50 20")).toBe(true);
  });

  it("draw a whole turn in two halves and nothing for an empty slice", () => {
    expect(slicePath(50, 50, 30, 40, 0, FULL_TURN).match(/M/g)).toHaveLength(2);
    expect(slicePath(50, 50, 30, 40, 1, 1)).toBe("");
  });

  it("fill a slice from its start", () => {
    expect(filledEnd({ start: 1, end: 3 }, 0.25)).toBe(1.5);
    expect(filledEnd({ start: 1, end: 3 }, 4)).toBe(3);
  });
});
