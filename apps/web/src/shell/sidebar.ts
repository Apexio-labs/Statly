export const SIDEBAR_MIN = 64;
export const SIDEBAR_MAX = 260;
export const SIDEBAR_COMPACT_BELOW = 194;
export const SNAP_DISTANCE = 14;
export const SETTINGS_RAIL_WIDTH = 236;
export const WIDGET_RAIL_MIN = 180;
export const WIDGET_RAIL_MAX = 340;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** A width close to an edge settles on that edge when the handle is released. */
export function snapped(width: number, minimum: number, maximum: number): number {
  if (width - minimum <= SNAP_DISTANCE) {
    return minimum;
  }
  if (maximum - width <= SNAP_DISTANCE) {
    return maximum;
  }
  return width;
}
