import type { ChartAxis } from "@statly/contract/charts";

/**
 * The scales of a combined chart. Up to two scales stand on each side; the second one on a side
 * sits further out. A hidden scale still sizes its layer, only its numbers are not drawn, so the
 * shape stays visible and the hover box tells the values.
 */
export type PlannedAxis =
  | { side: "left" | "right"; slot: 0 | 1; unit: string }
  | { side: "hidden"; unit: string };

export type AxisPlan = {
  axes: PlannedAxis[];
  /** For each layer, the index of its scale in ``axes``. */
  layerAxis: number[];
};

export const AXES_PER_SIDE = 2;

/**
 * Gives every layer a scale. Layers with the same unit share one, so two counts never stand on
 * two different scales. Chosen sides come first; "auto" then puts the first new unit left, the
 * next right, and so on, until both sides are full; the rest get a hidden scale.
 */
export function planAxes(layers: readonly { axis: ChartAxis; unit: string }[]): AxisPlan {
  const axes: PlannedAxis[] = [];
  const layerAxis: number[] = new Array(layers.length).fill(-1);
  const onSide = (side: "left" | "right") => axes.filter((axis) => axis.side === side).length;
  const visible = (unit: string, side?: "left" | "right") =>
    axes.findIndex(
      (axis) =>
        axis.side !== "hidden" && axis.unit === unit && (side === undefined || axis.side === side),
    );
  const place = (side: "left" | "right", unit: string): number => {
    const count = onSide(side);
    if (count >= AXES_PER_SIDE) {
      return -1;
    }
    axes.push({ side, slot: count as 0 | 1, unit });
    return axes.length - 1;
  };
  const hidden = (unit: string): number => {
    const found = axes.findIndex((axis) => axis.side === "hidden" && axis.unit === unit);
    if (found >= 0) {
      return found;
    }
    axes.push({ side: "hidden", unit });
    return axes.length - 1;
  };

  layers.forEach((layer, index) => {
    if (layer.axis === "left" || layer.axis === "right") {
      const found = visible(layer.unit, layer.axis);
      const placed = found >= 0 ? found : place(layer.axis, layer.unit);
      layerAxis[index] = placed >= 0 ? placed : hidden(layer.unit);
    }
  });
  layers.forEach((layer, index) => {
    if (layer.axis !== "auto") {
      return;
    }
    const found = visible(layer.unit);
    if (found >= 0) {
      layerAxis[index] = found;
      return;
    }
    const first = onSide("left") <= onSide("right") ? "left" : "right";
    const second = first === "left" ? "right" : "left";
    const placed = place(first, layer.unit);
    const placedElsewhere = placed >= 0 ? placed : place(second, layer.unit);
    layerAxis[index] = placedElsewhere >= 0 ? placedElsewhere : hidden(layer.unit);
  });
  layers.forEach((layer, index) => {
    if (layer.axis === "none") {
      layerAxis[index] = hidden(layer.unit);
    }
  });
  return { axes, layerAxis };
}
