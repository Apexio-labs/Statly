import {
  builtinWidgets,
  type DashboardLayout,
  dashboardFile,
  dashboardFileFormat,
  dashboardFileVersion,
  dashboardLayout,
} from "@statly/contract";
import { clampSize, moveWidget, rulesOfWidgets } from "./grid/engine.ts";

function isBuiltin(widget: { type: string }): boolean {
  return widget.type in builtinWidgets;
}

export function createDashboardFile(layout: DashboardLayout): string {
  const file = { format: dashboardFileFormat, version: dashboardFileVersion, layout };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Reads a shared file. Returns null if it is not a usable Statly dashboard. */
export function readDashboardFile(text: string): DashboardLayout | null {
  try {
    const value: unknown = JSON.parse(text);
    const parsed = dashboardFile.safeParse(value);
    if (parsed.success) {
      return fitted(parsed.data.layout);
    }
    return fitted(dashboardLayout.parse(readPrototypeFile(value)));
  } catch {
    return null;
  }
}

/** Files exported by earlier versions keep the layout under `dashboard`. */
function readPrototypeFile(value: unknown): unknown {
  const file = value as { format?: string; dashboard?: { widgets?: unknown[] } };
  if (file.format !== dashboardFileFormat) {
    throw new Error("Not a Statly file.");
  }
  return { widgets: file.dashboard?.widgets };
}

/** Keeps built-in statistics. Custom widgets travel as their own package files. */
function fitted(layout: DashboardLayout): DashboardLayout {
  const rulesOf = rulesOfWidgets();
  let result: DashboardLayout = {
    widgets: layout.widgets.filter(isBuiltin).map((widget) => ({
      ...widget,
      ...clampSize(rulesOf(widget.type), widget.w, widget.h),
    })),
  };
  for (const widget of result.widgets) {
    result = moveWidget(result, widget.id, widget);
  }
  return result;
}
