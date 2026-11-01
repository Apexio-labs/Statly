import type { CustomWidget, WidgetElement } from "@statly/contract";
import { customWidget } from "@statly/contract";
import { describe, expect, it } from "vitest";
import {
  clearLayout,
  commit,
  duplicateElement,
  hasLayoutFor,
  moveLayer,
  placeElement,
  redo,
  removeElement,
  resizedBox,
  rotationAt,
  setSizeRole,
  snapBox,
  startHistory,
  undo,
  unusedElementId,
  updateElement,
} from "./editorState.ts";
import { blankWidget, newElement, templates } from "./templates.ts";

function text(id: string): WidgetElement {
  return { ...newElement("text", id), kind: "text" } as WidgetElement;
}

function widget(...ids: string[]): CustomWidget {
  return { ...blankWidget("test"), elements: ids.map(text) };
}

describe("history", () => {
  it("undoes and redoes in order", () => {
    const first = widget("a");
    const second = widget("a", "b");
    let history = commit(startHistory(first), second);
    history = undo(history);
    expect(history.present).toBe(first);
    history = redo(history);
    expect(history.present).toBe(second);
  });

  it("forgets the redo path after a new change", () => {
    let history = commit(startHistory(widget("a")), widget("b"));
    history = commit(undo(history), widget("c"));
    expect(history.future).toEqual([]);
  });

  it("does nothing at either end", () => {
    const history = startHistory(widget("a"));
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});

describe("elements", () => {
  it("changes only the chosen element", () => {
    const next = updateElement(widget("a", "b"), "b", { x: 40 });
    expect(next.elements.map((element) => element.x === 40)).toEqual([false, true]);
  });

  it("removes one element", () => {
    expect(removeElement(widget("a", "b"), "a").elements.map((e) => e.id)).toEqual(["b"]);
  });

  it("duplicates next to the original with a new id", () => {
    const next = duplicateElement(widget("e1"), "e1");
    expect(next.elements).toHaveLength(2);
    expect(next.elements[1]?.id).not.toBe("e1");
    expect(next.elements[1]?.x).toBe((next.elements[0]?.x ?? 0) + 4);
  });

  it("finds an id nobody uses", () => {
    expect(unusedElementId(widget("e1", "e3"))).toBe("e4");
    expect(unusedElementId(widget("e2", "e3"))).toBe("e4");
  });

  it("moves layers within the list only", () => {
    const start = widget("a", "b");
    expect(moveLayer(start, "a", 1).elements.map((e) => e.id)).toEqual(["b", "a"]);
    expect(moveLayer(start, "b", 1)).toBe(start);
    expect(moveLayer(start, "a", -1)).toBe(start);
  });
});

describe("arrangements per size", () => {
  const start = widget("a");

  it("changes the normal place at the standard size", () => {
    const next = placeElement(start, "a", start.size, { x: 33 });
    expect(next.elements[0]?.x).toBe(33);
    expect(next.elements[0]?.layouts).toBeUndefined();
  });

  it("stores a separate arrangement at any other size", () => {
    const small = { w: 2, h: 2 };
    const next = placeElement(start, "a", small, { x: 33 });
    const [element] = next.elements;
    expect(element?.x).toBe(start.elements[0]?.x);
    expect(element?.layouts?.[0]).toMatchObject({ cellsW: 2, cellsH: 2, x: 33 });
  });

  it("updates an arrangement instead of adding another", () => {
    const small = { w: 2, h: 2 };
    const once = placeElement(start, "a", small, { x: 33 });
    const twice = placeElement(once, "a", small, { y: 44 });
    expect(twice.elements[0]?.layouts).toHaveLength(1);
    expect(twice.elements[0]?.layouts?.[0]).toMatchObject({ x: 33, y: 44 });
  });

  it("can be cleared again", () => {
    const small = { w: 2, h: 2 };
    const next = clearLayout(placeElement(start, "a", small, { x: 33 }), "a", small);
    expect(hasLayoutFor(next.elements[0] as WidgetElement, small)).toBe(false);
  });
});

describe("size roles", () => {
  const start = { ...widget("a"), size: { w: 4, h: 6 } };

  it("sets the standard size", () => {
    expect(setSizeRole(start, "standard", { w: 6, h: 8 }).size).toMatchObject({ w: 6, h: 8 });
  });

  it("raises the standard size when the minimum passes it", () => {
    const { size } = setSizeRole(start, "minimum", { w: 5, h: 7 });
    expect(size).toMatchObject({ w: 5, h: 7, minW: 5, minH: 7 });
  });

  it("lowers the standard size when the maximum falls below it", () => {
    const { size } = setSizeRole(start, "maximum", { w: 3, h: 4 });
    expect(size).toMatchObject({ w: 3, h: 4, maxW: 3, maxH: 4 });
  });
});

describe("snapping", () => {
  it("pulls a box to the widget's center", () => {
    const result = snapBox({ x: 39.5, y: 10, w: 20, h: 20 }, []);
    expect(result.x).toBe(40);
    expect(result.guides.x).toBe(50);
  });

  it("pulls a box to another element's edge", () => {
    const result = snapBox({ x: 10, y: 30.8, w: 20, h: 20 }, [{ x: 60, y: 20, w: 10, h: 11 }]);
    expect(result.y).toBe(31);
  });

  it("leaves a box alone when nothing is close", () => {
    const result = snapBox({ x: 13, y: 17, w: 9, h: 11 }, []);
    expect(result).toMatchObject({ x: 13, y: 17, guides: { x: null, y: null } });
  });
});

describe("templates", () => {
  it("are all valid widgets", () => {
    for (const template of templates) {
      expect(() => customWidget.parse(template.build("id"))).not.toThrow();
    }
  });

  it("every new element is valid", () => {
    for (const kind of ["text", "metric", "chart", "progress", "heatmap", "shape"] as const) {
      const value = { ...blankWidget("id"), name: "Test", elements: [newElement(kind, "e1")] };
      expect(() => customWidget.parse(value)).not.toThrow();
    }
  });
});

describe("rotating elements", () => {
  const box = { x: 100, y: 100, w: 100, h: 50 };
  const corner = { x: 1, y: 1 } as const;

  it("grows from the opposite corner without rotation", () => {
    const next = resizedBox(box, corner, { x: 20, y: 10 }, 0, false, 5);
    expect(next).toEqual({ x: 100, y: 100, w: 120, h: 60 });
  });

  it("grows around the center with Alt", () => {
    const next = resizedBox(box, corner, { x: 10, y: 0 }, 0, true, 5);
    expect(next).toEqual({ x: 90, y: 100, w: 120, h: 50 });
  });

  it("keeps the opposite corner in place when the element is turned", () => {
    const next = resizedBox(box, corner, { x: 0, y: 20 }, 90, false, 5);
    expect(next.w).toBeCloseTo(120);
    expect(next.h).toBeCloseTo(50);
    const centerY = next.y + next.h / 2;
    expect(centerY).toBeCloseTo(125 + 10);
    expect(next.x + next.w / 2).toBeCloseTo(150);
  });

  it("never gets smaller than the smallest size", () => {
    expect(resizedBox(box, corner, { x: -500, y: -500 }, 0, false, 5).w).toBe(5);
  });

  const center = { x: 100, y: 100 };

  it("reads the angle from the handle's position above the center", () => {
    expect(rotationAt(center, { x: 100, y: 50 }, false)).toBe(0);
    expect(rotationAt(center, { x: 150, y: 100 }, false)).toBe(90);
    expect(rotationAt(center, { x: 50, y: 100 }, false)).toBe(-90);
  });

  it("settles on right angles and steps with Shift", () => {
    expect(rotationAt(center, { x: 102, y: 50 }, false)).toBe(0);
    expect(rotationAt(center, { x: 120, y: 50 }, true)).toBe(15);
  });
});
