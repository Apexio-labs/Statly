import type { Cells, CustomWidget, DeviceKind, WidgetElement } from "@statly/contract";
import { deviceColumns, gridColumns, widgetSizeLimits } from "@statly/contract/limits";

type Box = Pick<WidgetElement, "x" | "y" | "w" | "h">;

/** The sizes a widget may take on the dashboard, in grid cells. */
export function sizeLimits(size: CustomWidget["size"]) {
  return {
    minW: size.minW ?? widgetSizeLimits.minW,
    maxW: size.maxW ?? widgetSizeLimits.maxW,
    minH: size.minH ?? widgetSizeLimits.minH,
    maxH: size.maxH ?? widgetSizeLimits.maxH,
  };
}

function distance(first: Cells, second: Cells): number {
  return Math.abs(first.w - second.w) + Math.abs(first.h - second.h);
}

/**
 * Where an element sits at a widget size. Percentages make it scale by themselves. If the user
 * arranged it for particular sizes, the arrangement closest to the current size applies.
 */
export function layoutAt(element: WidgetElement, size: Cells, cells: Cells): Box {
  let best: Box = element;
  let bestDistance = distance(size, cells);
  for (const layout of element.layouts ?? []) {
    const away = distance({ w: layout.cellsW, h: layout.cellsH }, cells);
    if (away < bestDistance) {
      best = layout;
      bestDistance = away;
    }
  }
  return best;
}

/** Elements can wait until the widget is large enough for them. */
export function isVisibleAt(element: WidgetElement, cells: Cells): boolean {
  const from = element.showFrom;
  return !from || (cells.w >= from.w && cells.h >= from.h);
}

const COLUMN_PX = 104;
const ROW_PX = 45;
const GAP_PX = 14;

/** The distance from one grid cell to the next, and the free space between two cells. */
export const GRID_PITCH = { x: COLUMN_PX, y: ROW_PX, gap: GAP_PX } as const;

export function cellsToPixels(cells: Cells) {
  return { width: cells.w * COLUMN_PX - GAP_PX, height: cells.h * ROW_PX - GAP_PX };
}

export function pixelsToCells(width: number, height: number): Cells {
  return {
    w: Math.round((width + GAP_PX) / COLUMN_PX),
    h: Math.round((height + GAP_PX) / ROW_PX),
  };
}

/** The size a widget gets on a device when Statly works out the layout by itself. */
export function deviceCells(size: CustomWidget["size"], device: DeviceKind): Cells {
  const columns = deviceColumns[device];
  const limits = sizeLimits(size);
  const full = device === "phone" ? 5 : 10;
  const scaled = Math.max(2, Math.round((size.w * columns) / gridColumns / 2) * 2);
  const wanted = size.w >= full ? columns : scaled;
  return {
    w: Math.max(Math.min(limits.minW, columns), Math.min(limits.maxW, columns, wanted)),
    h: size.h,
  };
}

/** Height over width of the size a widget was designed at, which keeps text proportional. */
export function designAspect(size: Cells): number {
  const { width, height } = cellsToPixels(size);
  return height / width;
}
