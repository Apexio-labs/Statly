import type { Tip } from "@statly/charts";

export type { Tip };

/**
 * A structured hover box for any element: put the result in `data-tooltip`. The tooltip layer
 * draws it like the boxes of the charts, with a title, colored rows and lines below.
 */
export function richTip(tip: Tip): string {
  return JSON.stringify(tip);
}

export function readTip(text: string): Tip | null {
  if (!text.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Tip;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
