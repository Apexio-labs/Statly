import type { Cells, CustomWidget, SizeLayout, WidgetElement } from "@statly/contract";
import { layoutAt, sizeLimits } from "@statly/widget-runtime";

const HISTORY_LIMIT = 100;
const MAX_LAYOUTS = 8;

export type History = { past: CustomWidget[]; present: CustomWidget; future: CustomWidget[] };

export function startHistory(widget: CustomWidget): History {
  return { past: [], present: widget, future: [] };
}

/** Records a change. Everything before it stays reachable through undo. */
export function commit(history: History, next: CustomWidget): History {
  if (next === history.present) {
    return history;
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  return previous
    ? {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    : history;
}

export function redo(history: History): History {
  const [next, ...future] = history.future;
  return next ? { past: [...history.past, history.present], present: next, future } : history;
}

export function updateElement(
  widget: CustomWidget,
  id: string,
  patch: Partial<WidgetElement>,
): CustomWidget {
  return {
    ...widget,
    elements: widget.elements.map((element) =>
      element.id === id ? ({ ...element, ...patch } as WidgetElement) : element,
    ),
  };
}

function sameCells(first: Cells, second: Cells): boolean {
  return first.w === second.w && first.h === second.h;
}

export function isDesignSize(widget: CustomWidget, cells: Cells): boolean {
  return sameCells(widget.size, cells);
}

/**
 * Moves or sizes an element. At the widget's standard size this changes its normal place, at any
 * other size it stores an arrangement for that size alone.
 */
export function placeElement(
  widget: CustomWidget,
  id: string,
  cells: Cells,
  box: Partial<Pick<WidgetElement, "x" | "y" | "w" | "h">>,
): CustomWidget {
  if (isDesignSize(widget, cells)) {
    return updateElement(widget, id, box);
  }
  const element = widget.elements.find((item) => item.id === id);
  if (!element) {
    return widget;
  }
  const { x, y, w, h } = layoutAt(element, widget.size, cells);
  const layout: SizeLayout = { cellsW: cells.w, cellsH: cells.h, x, y, w, h, ...box };
  const others = (element.layouts ?? []).filter(
    (item) => item.cellsW !== cells.w || item.cellsH !== cells.h,
  );
  return updateElement(widget, id, { layouts: [...others, layout].slice(-MAX_LAYOUTS) });
}

export function hasLayoutFor(element: WidgetElement, cells: Cells): boolean {
  return (element.layouts ?? []).some((item) => item.cellsW === cells.w && item.cellsH === cells.h);
}

export function clearLayout(widget: CustomWidget, id: string, cells: Cells): CustomWidget {
  const element = widget.elements.find((item) => item.id === id);
  const layouts = element?.layouts?.filter(
    (item) => item.cellsW !== cells.w || item.cellsH !== cells.h,
  );
  return updateElement(widget, id, { layouts: layouts ?? [] });
}

/** Sets one size and moves the others along, so minimum, standard and maximum stay in order. */
export function setSizeRole(
  widget: CustomWidget,
  role: "standard" | "minimum" | "maximum",
  cells: Cells,
): CustomWidget {
  const limits = sizeLimits(widget.size);
  if (role === "standard") {
    return { ...widget, size: { ...widget.size, w: cells.w, h: cells.h } };
  }
  const minW = role === "minimum" ? cells.w : Math.min(limits.minW, cells.w);
  const minH = role === "minimum" ? cells.h : Math.min(limits.minH, cells.h);
  const maxW = role === "maximum" ? cells.w : Math.max(limits.maxW, cells.w);
  const maxH = role === "maximum" ? cells.h : Math.max(limits.maxH, cells.h);
  const w = Math.max(minW, Math.min(maxW, widget.size.w));
  const h = Math.max(minH, Math.min(maxH, widget.size.h));
  return { ...widget, size: { w, h, minW, maxW, minH, maxH } };
}

export function removeElement(widget: CustomWidget, id: string): CustomWidget {
  return { ...widget, elements: widget.elements.filter((element) => element.id !== id) };
}

export function unusedElementId(widget: CustomWidget): string {
  const taken = new Set(widget.elements.map((element) => element.id));
  let number = widget.elements.length + 1;
  while (taken.has(`e${number}`)) {
    number += 1;
  }
  return `e${number}`;
}

export function duplicateElement(widget: CustomWidget, id: string): CustomWidget {
  const source = widget.elements.find((element) => element.id === id);
  if (!source) {
    return widget;
  }
  const copy = { ...source, id: unusedElementId(widget), x: source.x + 4, y: source.y + 4 };
  return { ...widget, elements: [...widget.elements, copy] };
}

/** Later elements draw on top, so the list order is the layer order. */
export function moveLayer(widget: CustomWidget, id: string, direction: 1 | -1): CustomWidget {
  const elements = [...widget.elements];
  const index = elements.findIndex((element) => element.id === id);
  const target = index + direction;
  const [moved] = elements.splice(index, 1);
  if (!moved || target < 0 || target >= widget.elements.length) {
    return widget;
  }
  elements.splice(target, 0, moved);
  return { ...widget, elements };
}

/** How an element's box changes when a corner is pulled, in pixels, whatever its rotation. */
export function resizedBox(
  box: { x: number; y: number; w: number; h: number },
  corner: { x: 1 | -1; y: 1 | -1 },
  pull: { x: number; y: number },
  rotation: number,
  fromCenter: boolean,
  smallest: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const alongX = pull.x * cos + pull.y * sin;
  const alongY = -pull.x * sin + pull.y * cos;
  const grow = fromCenter ? 2 : 1;
  const w = Math.max(smallest, box.w + alongX * corner.x * grow);
  const h = Math.max(smallest, box.h + alongY * corner.y * grow);
  // The opposite corner stays put, so the center moves by half the growth along the turned axes.
  const shiftX = fromCenter ? 0 : ((w - box.w) / 2) * corner.x;
  const shiftY = fromCenter ? 0 : ((h - box.h) / 2) * corner.y;
  const centerX = box.x + box.w / 2 + shiftX * cos - shiftY * sin;
  const centerY = box.y + box.h / 2 + shiftX * sin + shiftY * cos;
  return { x: centerX - w / 2, y: centerY - h / 2, w, h };
}

const ROTATION_STEP = 1;
const ROTATION_SNAP = 15;
/** Close to a right angle the element settles on it, as it does in every design tool. */
const ROTATION_PULL = 3;

/** The angle a pointer gives an element around its center. A handle sits above the center. */
export function rotationAt(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  coarse: boolean,
): number {
  const degrees = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  const normal = ((((degrees + 180) % 360) + 360) % 360) - 180;
  if (coarse) {
    return Math.round(normal / ROTATION_SNAP) * ROTATION_SNAP;
  }
  const right = Math.round(normal / 90) * 90;
  return Math.abs(normal - right) <= ROTATION_PULL ? right : Math.round(normal / ROTATION_STEP);
}

const SNAP_DISTANCE = 1.2;

export type Guides = { x: number | null; y: number | null };

function nearest(candidates: number[], lines: number[]) {
  let best: { shift: number; line: number } | null = null;
  for (const candidate of candidates) {
    for (const line of lines) {
      const shift = line - candidate;
      if (Math.abs(shift) <= SNAP_DISTANCE && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, line };
      }
    }
  }
  return best;
}

/** Pulls a moved box onto widget edges, the center and the edges of other elements. */
export function snapBox(
  box: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number; guides: Guides } {
  const linesX = [0, 50, 100, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const linesY = [0, 50, 100, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const snapX = nearest([box.x, box.x + box.w / 2, box.x + box.w], linesX);
  const snapY = nearest([box.y, box.y + box.h / 2, box.y + box.h], linesY);
  return {
    x: box.x + (snapX?.shift ?? 0),
    y: box.y + (snapY?.shift ?? 0),
    guides: { x: snapX?.line ?? null, y: snapY?.line ?? null },
  };
}
