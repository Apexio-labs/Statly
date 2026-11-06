import {
  builtinWidgets,
  type CustomWidget,
  customWidgetPrefix,
  type DashboardLayout,
  type DashboardWidget,
  deviceMinHeight,
  type GoalView,
  goalWidgetPrefix,
  goalWidgetSizes,
  gridColumns,
  maxGridRows,
  type SizeRules,
  type WidgetType,
  widgetSizeLimits,
} from "@statly/contract";

import { sizeLimits } from "@statly/widget-runtime";

type Box = Pick<DashboardWidget, "x" | "y" | "w" | "h">;

/** The sizes a widget type allows. Custom widgets need their definitions to answer this. */
export type RulesOf = (type: string) => SizeRules;

const FALLBACK_RULES: SizeRules = { ...widgetSizeLimits, w: 4, h: 6 };

/** A goal widget, `goal:<id>:<view>`, takes the sizes of its view. Python knows whether it exists. */
function goalRules(type: string): SizeRules | undefined {
  if (!type.startsWith(goalWidgetPrefix)) {
    return undefined;
  }
  const view = type.split(":")[2] as GoalView;
  return view in goalWidgetSizes ? { ...goalWidgetSizes[view] } : undefined;
}

export function rulesOfWidgets(customWidgets: CustomWidget[] = []): RulesOf {
  const custom = new Map(
    customWidgets.map((widget) => [
      `${customWidgetPrefix}${widget.id}`,
      { ...widgetSizeLimits, ...widget.size, ...sizeLimits(widget.size) },
    ]),
  );
  return (type) =>
    builtinWidgets[type as WidgetType] ?? custom.get(type) ?? goalRules(type) ?? FALLBACK_RULES;
}

const builtinRules = rulesOfWidgets();

export function overlaps(first: Box, second: Box): boolean {
  return (
    first.x < second.x + second.w &&
    first.x + first.w > second.x &&
    first.y < second.y + second.h &&
    first.y + first.h > second.y
  );
}

function searchLimit(widget: Box, occupied: Box[]): number {
  const lowest = Math.max(12, widget.y + widget.h + 2, ...occupied.map((o) => o.y + o.h + 2));
  return Math.min(maxGridRows - widget.h, lowest);
}

/** The free spot closest to where a widget stands, counting steps across the grid. */
function nearestFree(
  widget: DashboardWidget,
  occupied: Box[],
  columns: number,
): Pick<Box, "x" | "y"> {
  const limit = searchLimit(widget, occupied);
  for (let distance = 0; distance <= limit + columns; distance += 1) {
    const top = Math.max(0, widget.y - distance);
    const bottom = Math.min(limit, widget.y + distance);
    for (let y = top; y <= bottom; y += 1) {
      const sideways = distance - Math.abs(y - widget.y);
      const candidates = sideways === 0 ? [widget.x] : [widget.x - sideways, widget.x + sideways];
      for (const x of candidates) {
        const fits = x >= 0 && x + widget.w <= columns;
        if (fits && !occupied.some((other) => overlaps({ ...widget, x, y }, other))) {
          return { x, y };
        }
      }
    }
  }
  throw new Error("The dashboard grid has no free space.");
}

/**
 * Places the moved widget exactly where it was dropped. Widgets in its way step to the nearest
 * free spot, and all others stay put, so gaps the user left stay as they are.
 */
export function resolveCollisions<W extends DashboardWidget>(
  widgets: W[],
  moved: W,
  columns: number = gridColumns,
): W[] {
  const placed: W[] = [moved];
  const others = widgets
    .filter((widget) => widget.id !== moved.id)
    .sort((first, second) => first.y - second.y || first.x - second.x);
  for (const widget of others) {
    const blocked = placed.some((item) => overlaps(widget, item));
    const position = blocked ? nearestFree(widget, placed, columns) : {};
    placed.push({ ...widget, ...position });
  }
  const byId = new Map(placed.map((widget) => [widget.id, widget]));
  return widgets.map((widget) => byId.get(widget.id) ?? widget);
}

/** The first free spot from the top left, which is where new widgets go. */
function firstFreeSpot(
  widgets: Box[],
  w: number,
  h: number,
  columns: number,
): Pick<Box, "x" | "y"> {
  for (let y = 0; y <= maxGridRows - h; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      if (!widgets.some((widget) => overlaps({ x, y, w, h }, widget))) {
        return { x, y };
      }
    }
  }
  throw new Error("The dashboard grid has no free space.");
}

type Grid<W> = { widgets: W[] };

function unusedId(layout: Grid<DashboardWidget>, type: string): string {
  const taken = new Set(layout.widgets.map((widget) => widget.id));
  const base = type.replaceAll(":", "-").slice(0, 56);
  let number = layout.widgets.filter((widget) => widget.type === type).length + 1;
  while (taken.has(`${base}-${number}`)) {
    number += 1;
  }
  return `${base}-${number}`;
}

export function newWidget(
  layout: Grid<DashboardWidget>,
  type: string,
  rulesOf: RulesOf = builtinRules,
  columns: number = gridColumns,
): DashboardWidget {
  const rules = rulesOf(type);
  const { w, h } = clampSize(rules, rules.w, rules.h, columns);
  return {
    id: unusedId(layout, type),
    type,
    ...firstFreeSpot(layout.widgets, w, h, columns),
    w,
    h,
  };
}

export function addWidget(
  layout: DashboardLayout,
  type: string,
  rulesOf: RulesOf = builtinRules,
): DashboardLayout {
  return { widgets: [...layout.widgets, newWidget(layout, type, rulesOf)] };
}

export function removeWidget<W extends DashboardWidget>(layout: Grid<W>, id: string): Grid<W> {
  return { widgets: layout.widgets.filter((widget) => widget.id !== id) };
}

export function removeOneOfType(layout: DashboardLayout, type: string): DashboardLayout {
  const last = layout.widgets.findLast((widget) => widget.type === type);
  return last ? removeWidget(layout, last.id) : layout;
}

/** Rows the editor shows: everything in use plus room to drag below it. */
export function canvasRows(widgets: DashboardWidget[]): number {
  return Math.max(6, ...widgets.map((widget) => widget.y + widget.h + 2));
}

export function moveWidget<W extends DashboardWidget>(
  layout: Grid<W>,
  id: string,
  position: Pick<Box, "x" | "y">,
  columns: number = gridColumns,
): Grid<W> {
  const widget = layout.widgets.find((item) => item.id === id);
  if (!widget) {
    return layout;
  }
  const x = Math.max(0, Math.min(columns - widget.w, position.x));
  const y = Math.max(0, position.y);
  return { widgets: resolveCollisions(layout.widgets, { ...widget, x, y }, columns) };
}

/**
 * A widget's limits apply everywhere, except that nothing can be wider than the device, and small
 * screens may show a chart lower than a desktop would.
 */
export function clampSize(
  rules: SizeRules,
  w: number,
  h: number,
  columns: number = gridColumns,
): Pick<Box, "w" | "h"> {
  const narrowest = Math.min(rules.minW, columns);
  const widest = Math.min(rules.maxW, columns);
  const lowest = columns < gridColumns ? Math.min(rules.minH, deviceMinHeight) : rules.minH;
  return {
    w: Math.max(narrowest, Math.min(widest, w)),
    h: Math.max(lowest, Math.min(rules.maxH, h)),
  };
}

export function resizeWidget<W extends DashboardWidget>(
  layout: Grid<W>,
  id: string,
  size: Pick<Box, "w" | "h">,
  rulesOf: RulesOf = builtinRules,
  columns: number = gridColumns,
): Grid<W> {
  const widget = layout.widgets.find((item) => item.id === id);
  if (!widget) {
    return layout;
  }
  const { w, h } = clampSize(rulesOf(widget.type), size.w, size.h, columns);
  const x = Math.min(widget.x, columns - w);
  return { widgets: resolveCollisions(layout.widgets, { ...widget, x, w, h }, columns) };
}
