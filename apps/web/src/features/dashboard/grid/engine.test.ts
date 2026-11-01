import { type DashboardLayout, type DashboardWidget, defaultLayout } from "@statly/contract";
import { describe, expect, it } from "vitest";
import {
  addWidget,
  canvasRows,
  moveWidget,
  overlaps,
  removeOneOfType,
  removeWidget,
  resizeWidget,
} from "./engine.ts";

function tile(id: string, x: number, y: number): DashboardWidget {
  return { id, type: "due-cards", x, y, w: 3, h: 4 };
}

function hasOverlap(layout: DashboardLayout): boolean {
  return layout.widgets.some((first, index) =>
    layout.widgets.slice(index + 1).some((second) => overlaps(first, second)),
  );
}

function position(layout: DashboardLayout, id: string) {
  const widget = layout.widgets.find((item) => item.id === id);
  return { x: widget?.x, y: widget?.y };
}

describe("placing widgets", () => {
  it("keeps a widget exactly where it was dropped, even with empty rows above", () => {
    const moved = moveWidget({ widgets: [tile("a", 0, 0)] }, "a", { x: 6, y: 20 });
    expect(position(moved, "a")).toEqual({ x: 6, y: 20 });
  });

  it("moves only the widget that is in the way", () => {
    const layout = { widgets: [tile("a", 0, 0), tile("b", 3, 0), tile("c", 9, 0)] };
    const moved = moveWidget(layout, "a", { x: 3, y: 0 });
    expect(position(moved, "a")).toEqual({ x: 3, y: 0 });
    expect(position(moved, "c")).toEqual({ x: 9, y: 0 });
    expect(hasOverlap(moved)).toBe(false);
  });

  it("sends a blocked widget to the nearest free spot", () => {
    const layout = { widgets: [tile("a", 0, 0), tile("b", 3, 0)] };
    expect(position(moveWidget(layout, "a", { x: 3, y: 0 }), "b")).toEqual({ x: 0, y: 0 });
  });

  it("never pushes a widget outside the grid", () => {
    const moved = moveWidget({ widgets: [tile("a", 0, 0)] }, "a", { x: 50, y: -4 });
    expect(position(moved, "a")).toEqual({ x: 9, y: 0 });
  });

  it("stays free of overlaps through many moves", () => {
    let layout = defaultLayout;
    for (let step = 0; step < 60; step += 1) {
      const widget = layout.widgets[step % layout.widgets.length] as DashboardWidget;
      layout = moveWidget(layout, widget.id, { x: (step * 5) % 11, y: (step * 7) % 13 });
      expect(hasOverlap(layout)).toBe(false);
    }
  });

  it("keeps to the columns of a smaller device", () => {
    const moved = moveWidget(
      { widgets: [tile("a", 0, 0), tile("b", 0, 4)] },
      "a",
      { x: 9, y: 4 },
      4,
    );
    expect(position(moved, "a")).toEqual({ x: 1, y: 4 });
    expect(hasOverlap(moved)).toBe(false);
    expect(moved.widgets.every((widget) => widget.x + widget.w <= 4)).toBe(true);
  });

  it("lets a device be narrower than a widget's smallest width", () => {
    const wide: DashboardWidget = { id: "h", type: "review-heatmap", x: 0, y: 0, w: 4, h: 8 };
    const resized = resizeWidget({ widgets: [wide] }, "h", { w: 2, h: 8 }, undefined, 4);
    expect(resized.widgets[0]?.w).toBe(4);
  });
});

describe("resizing widgets", () => {
  it("respects the sizes a statistic allows", () => {
    const layout = { widgets: [tile("a", 0, 0)] };
    expect(resizeWidget(layout, "a", { w: 99, h: 99 }).widgets[0]).toMatchObject({ w: 6, h: 8 });
    expect(resizeWidget(layout, "a", { w: 1, h: 1 }).widgets[0]).toMatchObject({ w: 2, h: 2 });
  });

  it("makes room when it grows into a neighbor", () => {
    const layout = { widgets: [tile("a", 0, 0), tile("b", 3, 0)] };
    expect(hasOverlap(resizeWidget(layout, "a", { w: 6, h: 4 }))).toBe(false);
  });

  it("pulls a widget back in when it would leave the grid", () => {
    const layout = { widgets: [tile("a", 9, 0)] };
    expect(resizeWidget(layout, "a", { w: 6, h: 4 }).widgets[0]).toMatchObject({ x: 6, w: 6 });
  });
});

describe("adding and removing", () => {
  it("fills the first free spot from the top left", () => {
    const next = addWidget({ widgets: [tile("a", 0, 0)] }, "study-time");
    expect(next.widgets[1]).toMatchObject({ x: 3, y: 0, w: 3, h: 4 });
  });

  it("gives every copy of a statistic its own id", () => {
    const once = addWidget(defaultLayout, "due-cards");
    const twice = addWidget(once, "due-cards");
    const ids = twice.widgets.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("removes one widget by id or the newest of a type", () => {
    const layout = {
      widgets: [tile("a", 0, 0), tile("b", 3, 0)],
    };
    expect(removeWidget(layout, "a").widgets.map((widget) => widget.id)).toEqual(["b"]);
    expect(removeOneOfType(layout, "due-cards").widgets.map((widget) => widget.id)).toEqual(["a"]);
  });
});

describe("canvas", () => {
  it("offers two spare rows below the lowest widget", () => {
    expect(canvasRows([tile("a", 0, 10)])).toBe(16);
    expect(canvasRows([])).toBe(6);
  });
});
