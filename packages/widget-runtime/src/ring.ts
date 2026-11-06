/**
 * Geometry for rings made of slices, like a disk usage chart: each slice gets its share of a
 * circle, and a slice can carry the next ring outside it. Pure numbers, so the desktop app and
 * the phone card can draw the same rings.
 */

export const FULL_TURN = Math.PI * 2;

export type Slice<T> = { item: T; start: number; end: number };

/**
 * Share the angle from `start` to `end` among items by weight, with a small gap between them.
 * Items with no weight get no slice. A single item takes the whole span without a gap.
 */
export function slices<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  start = 0,
  end = FULL_TURN,
  gap = 0.02,
): Slice<T>[] {
  const weighted = items.filter((item) => weightOf(item) > 0);
  const total = weighted.reduce((sum, item) => sum + weightOf(item), 0);
  if (total === 0) {
    return [];
  }
  const span = end - start;
  const gaps = weighted.length > 1 ? Math.min(gap, span / (weighted.length * 4)) : 0;
  const usable =
    span -
    gaps * (weighted.length > 1 && span >= FULL_TURN ? weighted.length : weighted.length - 1);
  const placed: Slice<T>[] = [];
  let at = start;
  for (const item of weighted) {
    const size = (usable * weightOf(item)) / total;
    placed.push({ item, start: at, end: at + size });
    at += size + gaps;
  }
  return placed;
}

function point(cx: number, cy: number, radius: number, angle: number): [number, number] {
  // Angles start at twelve o'clock and run clockwise, as people read a ring.
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** An SVG path for a ring slice between two radii. A full turn is drawn as two halves. */
export function slicePath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  start: number,
  end: number,
): string {
  const span = end - start;
  if (span <= 0) {
    return "";
  }
  if (span >= FULL_TURN - 1e-6) {
    const middle = start + Math.PI;
    return `${slicePath(cx, cy, inner, outer, start, middle)} ${slicePath(cx, cy, inner, outer, middle, start + FULL_TURN - 1e-6)}`;
  }
  const large = span > Math.PI ? 1 : 0;
  const [ax, ay] = point(cx, cy, outer, start).map(round) as [number, number];
  const [bx, by] = point(cx, cy, outer, end).map(round) as [number, number];
  const [c, d] = point(cx, cy, inner, end).map(round) as [number, number];
  const [e, f] = point(cx, cy, inner, start).map(round) as [number, number];
  return `M${ax} ${ay} A${outer} ${outer} 0 ${large} 1 ${bx} ${by} L${c} ${d} A${inner} ${inner} 0 ${large} 0 ${e} ${f} Z`;
}

/** The part of a slice that is filled, from its start: `share` runs from 0 to 1. */
export function filledEnd(slice: { start: number; end: number }, share: number): number {
  return slice.start + (slice.end - slice.start) * Math.max(0, Math.min(1, share));
}
