import { describe, expect, it } from "vitest";
import { addLayer, layersOf, partnerFor, startLayers } from "./chartLayers.ts";

const chart = {
  id: "c",
  kind: "chart" as const,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  opacity: 1,
  source: "hours" as const,
  chart: "bar" as const,
  range: "dashboard" as const,
  color: "accent" as const,
};

describe("chart layers", () => {
  it("suggests a partner along the same axis in another unit", () => {
    expect(partnerFor(["hours"])).toBe("focusHours");
    expect(partnerFor(["timeline"])).toBe("retentionTimeline");
  });

  it("starts a combined chart with the chart's own series and a fitting line", () => {
    const layers = startLayers(chart);
    expect(layers.map((layer) => [layer.kind, layer.source])).toEqual([
      ["bar", "hours"],
      ["line", "focusHours"],
    ]);
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(2);
  });

  it("stops at six layers", () => {
    let layers = startLayers(chart);
    for (let step = 0; step < 10; step += 1) {
      layers = addLayer(layers, "line");
    }
    expect(layers).toHaveLength(6);
  });

  it("draws a chart without layers as bars and leaves out layers along another axis", () => {
    expect(layersOf(chart)).toHaveLength(1);
    const mixed = layersOf({
      ...chart,
      chart: "combined",
      layers: [
        { id: "a", kind: "bar", source: "hours", color: "accent", axis: "auto" },
        { id: "b", kind: "line", source: "timeline", color: "muted", axis: "auto" },
      ],
    });
    expect(mixed.map((layer) => layer.id)).toEqual(["a"]);
  });
});
