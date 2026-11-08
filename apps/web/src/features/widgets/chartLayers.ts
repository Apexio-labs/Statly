import {
  type ChartLayer,
  type CombinableChartKind,
  combinesWith,
  maxChartLayers,
  type Paint,
  type SeriesSource,
  seriesSources,
  seriesUnitOf,
  type WidgetElement,
} from "@statly/contract";

type ChartElement = Extract<WidgetElement, { kind: "chart" }>;

/**
 * The layers a combined chart draws. A chart without layers draws its own series as bars, and a
 * layer along another axis than the first one is left out, since its points would not line up.
 */
export function layersOf(element: ChartElement): ChartLayer[] {
  const layers = element.layers?.length
    ? element.layers
    : [
        {
          id: "layer-1",
          kind: "bar" as const,
          source: element.source,
          color: element.color,
          axis: "auto" as const,
        },
      ];
  const first = layers[0];
  return first
    ? layers.filter((layer) => combinesWith(first.source, layer.source)).slice(0, maxChartLayers)
    : [];
}

/** Colors for new layers, after the chart's own: theme colors first, then fixed ones. */
const LAYER_PAINTS: Paint[] = ["accent", "muted", "#f59e0b", "#a78bfa", "#f472b6", "#34d399"];

/**
 * A series that goes well with the ones already there: along the same axis, and preferably in
 * another unit, such as focus next to ratings by hour.
 */
export function partnerFor(existing: SeriesSource[]): SeriesSource {
  const first = existing[0];
  if (first === undefined) {
    return "timeline";
  }
  const fitting = seriesSources.filter(
    (source) => combinesWith(first, source) && !existing.includes(source),
  );
  const units = new Set(existing.map((source) => seriesUnitOf[source]));
  return fitting.find((source) => !units.has(seriesUnitOf[source])) ?? fitting[0] ?? first;
}

function freeId(layers: ChartLayer[]): string {
  let number = layers.length + 1;
  while (layers.some((layer) => layer.id === `layer-${number}`)) {
    number += 1;
  }
  return `layer-${number}`;
}

function freePaint(layers: ChartLayer[]): Paint {
  return LAYER_PAINTS.find((paint) => !layers.some((layer) => layer.color === paint)) ?? "accent";
}

/** Adds a layer of ``kind`` with a fitting series and a color of its own. */
export function addLayer(layers: ChartLayer[], kind: CombinableChartKind): ChartLayer[] {
  if (layers.length >= maxChartLayers) {
    return layers;
  }
  const layer: ChartLayer = {
    id: freeId(layers),
    kind,
    source: partnerFor(layers.map((item) => item.source)),
    color: freePaint(layers),
    axis: "auto",
  };
  return [...layers, layer];
}

/** What a chart switched to "combined" starts with: its own series as bars and a fitting line. */
export function startLayers(element: ChartElement): ChartLayer[] {
  if (element.layers?.length) {
    return element.layers;
  }
  const own: ChartLayer = {
    id: "layer-1",
    kind: element.chart === "line" ? "line" : "bar",
    source: element.source,
    color: element.color,
    axis: "auto",
  };
  return addLayer([own], own.kind === "line" ? "bar" : "line");
}

/** The element's own series and color follow the first layer, for older readers of the widget. */
export function withLayers(layers: ChartLayer[]): Partial<ChartElement> {
  const first = layers[0];
  return first ? { layers, source: first.source, color: first.color } : { layers };
}
