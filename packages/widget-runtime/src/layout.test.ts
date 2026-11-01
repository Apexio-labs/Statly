import type { WidgetElement } from "@statly/contract";
import { describe, expect, it } from "vitest";
import {
  cellsToPixels,
  deviceCells,
  isVisibleAt,
  layoutAt,
  pixelsToCells,
  sizeLimits,
} from "./layout.ts";

const element = {
  id: "a",
  kind: "heatmap",
  x: 10,
  y: 10,
  w: 50,
  h: 50,
  opacity: 1,
} as WidgetElement;

const small = { cellsW: 2, cellsH: 2, x: 1, y: 2, w: 3, h: 4 };
const size = { w: 4, h: 6 };

describe("layoutAt", () => {
  it("uses the base arrangement when nothing else was set", () => {
    expect(layoutAt(element, size, { w: 2, h: 2 })).toBe(element);
  });

  it("picks the closest arrangement", () => {
    const arranged = { ...element, layouts: [small] };
    expect(layoutAt(arranged, size, { w: 2, h: 3 })).toBe(small);
    expect(layoutAt(arranged, size, { w: 4, h: 5 })).toBe(arranged);
  });

  it("prefers the base arrangement on a tie", () => {
    const arranged = { ...element, layouts: [{ ...small, cellsW: 6, cellsH: 6 }] };
    expect(layoutAt(arranged, size, { w: 5, h: 6 })).toBe(arranged);
  });
});

describe("isVisibleAt", () => {
  it("shows everything by default", () => {
    expect(isVisibleAt(element, { w: 2, h: 2 })).toBe(true);
  });

  it("needs both width and height", () => {
    const waiting = { ...element, showFrom: { w: 4, h: 6 } };
    expect(isVisibleAt(waiting, { w: 4, h: 6 })).toBe(true);
    expect(isVisibleAt(waiting, { w: 8, h: 5 })).toBe(false);
  });
});

describe("sizes", () => {
  it("fills in the general limits", () => {
    expect(sizeLimits({ w: 4, h: 6, maxW: 8 })).toEqual({ minW: 2, maxW: 8, minH: 2, maxH: 16 });
  });

  it("converts between cells and pixels", () => {
    const { width, height } = cellsToPixels({ w: 5, h: 7 });
    expect(pixelsToCells(width, height)).toEqual({ w: 5, h: 7 });
  });
});

describe("sizes on other devices", () => {
  it("gives small widgets half a phone and large ones all of it", () => {
    expect(deviceCells({ w: 3, h: 4 }, "phone")).toEqual({ w: 2, h: 4 });
    expect(deviceCells({ w: 6, h: 8 }, "phone")).toEqual({ w: 4, h: 8 });
  });

  it("scales for tablets in even steps", () => {
    expect(deviceCells({ w: 3, h: 4 }, "tablet")).toEqual({ w: 2, h: 4 });
    expect(deviceCells({ w: 12, h: 8 }, "tablet")).toEqual({ w: 8, h: 8 });
  });

  it("respects a widget's limits as far as the device allows", () => {
    expect(deviceCells({ w: 4, h: 6, minW: 3 }, "phone").w).toBe(3);
    expect(deviceCells({ w: 6, h: 6, minW: 6 }, "phone").w).toBe(4);
  });
});
