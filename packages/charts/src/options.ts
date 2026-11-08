import type { EChartsOption } from "echarts";

export type ChartTheme = {
  accent: string;
  text: string;
  muted: string;
  line: string;
  card: string;
  /** From empty to busiest day, one hue from light to dark. */
  sequence: string[];
  /** For telling series apart, always in this order: it keeps neighbors distinguishable. */
  series: string[];
  /** Glass themes light their bars like tubes. All others keep flat colors. */
  gloss: boolean;
};

const BAR_RADIUS = 4;

function readToken(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

/** Reads the active theme, so charts follow theme changes without their own color tables. */
export function readChartTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: readToken(styles, "--statly-accent"),
    text: readToken(styles, "--statly-text"),
    muted: readToken(styles, "--statly-muted"),
    line: readToken(styles, "--statly-border"),
    card: readToken(styles, "--statly-card"),
    sequence: [1, 2, 3, 4, 5].map((step) => readToken(styles, `--statly-sequence-${step}`)),
    series: [1, 2, 3, 4, 5, 6, 7].map((step) => readToken(styles, `--statly-series-${step}`)),
    gloss: readToken(styles, "--statly-chart-gloss") !== "",
  };
}

/** Moves a #rrggbb color toward white (above 0) or black (below 0). */
function shade(color: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16);
    return Math.round(channel + (target - channel) * Math.abs(amount))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/** Lit from one side and across the width of the bar, so it stays right at any length. */
function barColor(color: string, theme: ChartTheme, horizontal: boolean) {
  if (!(theme.gloss && /^#[0-9a-f]{6}$/i.test(color))) {
    return color;
  }
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: horizontal ? 0 : 1,
    y2: horizontal ? 1 : 0,
    colorStops: [
      { offset: 0, color: shade(color, 0.62) },
      { offset: 0.38, color: shade(color, 0.2) },
      { offset: 0.42, color: color },
      { offset: 1, color: shade(color, -0.22) },
    ],
  };
}

/** What a hover box says: a title, colored rows with their values, and lines below. */
export type Tip = {
  title?: string;
  rows?: { color?: string; label: string; value?: string }[];
  lines?: string[];
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The same box as Statly's own hover box (`.statly-tip`), as markup for chart tooltips. */
export function tipHtml(tip: Tip): string {
  const title = tip.title ? `<div class="statly-tip-title">${escapeHtml(tip.title)}</div>` : "";
  const rows = (tip.rows ?? [])
    .map(
      (row) =>
        `<div class="statly-tip-row">${
          row.color ? `<i style="background:${escapeHtml(row.color)}"></i>` : ""
        }<span>${escapeHtml(row.label)}</span>${
          row.value === undefined ? "" : `<b>${escapeHtml(row.value)}</b>`
        }</div>`,
    )
    .join("");
  const lines = (tip.lines ?? [])
    .map((line) => `<div class="statly-tip-line">${escapeHtml(line)}</div>`)
    .join("");
  return `<div class="statly-tip">${title}${rows}${lines}</div>`;
}

function tooltip(_theme: ChartTheme): EChartsOption["tooltip"] {
  // The box is drawn by `.statly-tip`, so ECharts' own frame stays invisible.
  return {
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    extraCssText: "box-shadow:none;",
    confine: true,
    transitionDuration: 0.1,
  };
}

type AxisItem = {
  axisValueLabel?: string;
  name?: string;
  seriesName?: string;
  color?: unknown;
  value?: unknown;
};

/** A plain color for the dot, also when a series is painted with a gradient. */
function solid(color: unknown, fallback: string): string {
  if (typeof color === "string") {
    return color;
  }
  const stops = (color as { colorStops?: { color: string }[] } | null)?.colorStops;
  return stops?.[Math.floor(stops.length / 2)]?.color ?? fallback;
}

/** One box for every series under the pointer, each value in its own format. */
export function axisTip(
  theme: ChartTheme,
  formatOf: (seriesName: string) => (value: number) => string,
  titles?: string[],
) {
  return (params: unknown): string => {
    const items = (Array.isArray(params) ? params : [params]) as (AxisItem & {
      dataIndex?: number;
    })[];
    const first = items[0];
    const index = first?.dataIndex ?? 0;
    return tipHtml({
      title: titles?.[index] ?? first?.axisValueLabel ?? first?.name ?? "",
      rows: items
        .filter((item) => item.value !== undefined && item.value !== null && item.value !== "-")
        .map((item) => ({
          color: solid(item.color, theme.accent),
          label: item.seriesName ?? "",
          value: formatOf(item.seriesName ?? "")(Number(item.value)),
        })),
    });
  };
}

export type Bar = { label: string; value: number };

type BarOptions = {
  bars: Bar[];
  theme: ChartTheme;
  horizontal?: boolean;
  /** Keep every n-th axis label, for long category lists such as the hours of a day. */
  labelInterval?: number;
  average?: { label: string; values: number[] };
  format?: (value: number) => string;
  kind?: "bar" | "line";
  /** Leaves out the axes, for charts too small to spare the room. */
  compact?: boolean;
  /** How the hover box names the value. */
  valueName?: string;
  /** A color for each bar, where one says something, such as above or below the usual. */
  colors?: (string | undefined)[];
  /** A whole hover box for each bar, instead of the value alone. */
  tips?: Tip[];
};

export function barOption({
  bars,
  theme,
  horizontal = false,
  labelInterval = 0,
  average,
  format = String,
  kind = "bar",
  compact = false,
  valueName = "",
  colors,
  tips,
}: BarOptions): EChartsOption {
  const categoryAxis = {
    show: !compact,
    type: "category" as const,
    data: bars.map((bar) => bar.label),
    axisLabel: { color: theme.muted, fontSize: 11, interval: labelInterval, hideOverlap: true },
    axisLine: { lineStyle: { color: theme.line } },
    axisTick: { show: false },
    inverse: horizontal,
  };
  const valueAxis = {
    show: !compact,
    type: "value" as const,
    minInterval: 1,
    axisLabel: { color: theme.muted, fontSize: 11, formatter: format },
    splitLine: { lineStyle: { color: theme.line, type: "dashed" as const } },
  };
  return {
    grid: { top: 12, right: horizontal ? 40 : 12, bottom: 4, left: 4, outerBounds: {} },
    tooltip: {
      ...tooltip(theme),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${theme.line}55` } },
      formatter: tips
        ? (params: unknown) => {
            const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number };
            return tipHtml(tips[first?.dataIndex ?? 0] ?? {});
          }
        : axisTip(theme, () => format),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [
      kind === "line"
        ? {
            type: "line",
            name: valueName,
            data: bars.map((bar) => bar.value),
            symbol: "none",
            lineStyle: { color: theme.accent, width: 2 },
            itemStyle: { color: theme.accent },
          }
        : {
            type: "bar",
            name: valueName,
            data: bars.map((bar, index) => {
              const color = colors?.[index];
              return color
                ? { value: bar.value, itemStyle: { color: barColor(color, theme, horizontal) } }
                : bar.value;
            }),
            barMaxWidth: 28,
            barCategoryGap: "24%",
            itemStyle: {
              color: barColor(theme.accent, theme, horizontal),
              borderRadius: horizontal
                ? [0, BAR_RADIUS, BAR_RADIUS, 0]
                : [BAR_RADIUS, BAR_RADIUS, 0, 0],
            },
            label: horizontal
              ? {
                  show: true,
                  position: "right",
                  color: theme.text,
                  fontSize: 11,
                  formatter: ({ value }) => format(Number(value)),
                }
              : { show: false },
          },
      ...(average
        ? [
            {
              type: "line" as const,
              name: average.label,
              data: average.values,
              symbol: "none",
              smooth: false,
              lineStyle: { color: theme.muted, width: 2 },
            },
          ]
        : []),
    ],
  };
}

export type Slice = { label: string; value: number; color?: string };

type PieOptions = {
  slices: Slice[];
  theme: ChartTheme;
  format?: (value: number) => string;
  /** Names each slice beside it. Small charts leave the names to the hover box. */
  labels?: boolean;
};

/**
 * A pie: every slice its share of the whole. Slices without their own color take the accent,
 * each one a little lighter than the one before, so neighbors stay apart.
 */
export function pieOption({
  slices,
  theme,
  format = String,
  labels = false,
}: PieOptions): EChartsOption {
  const shown = slices.filter((slice) => slice.value > 0);
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);
  return {
    tooltip: {
      ...tooltip(theme),
      trigger: "item",
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: unknown; color?: unknown };
        const value = Number(item.value);
        return tipHtml({
          title: item.name ?? "",
          rows: [
            {
              color: solid(item.color, theme.accent),
              label: format(value),
              value: total ? `${Math.round((value / total) * 1000) / 10} %` : "–",
            },
          ],
        });
      },
    },
    series: [
      {
        type: "pie",
        radius: labels ? "62%" : "88%",
        center: ["50%", "50%"],
        startAngle: 90,
        avoidLabelOverlap: true,
        data: shown.map((slice, index) => ({
          name: slice.label,
          value: slice.value,
          itemStyle: {
            color: slice.color ?? theme.accent,
            opacity: slice.color ? 1 : Math.max(0.3, 1 - index * (0.7 / Math.max(1, shown.length))),
            borderColor: theme.card,
            borderWidth: 2,
          },
        })),
        label: labels
          ? { show: true, color: theme.muted, fontSize: 11, formatter: "{b}" }
          : { show: false },
        labelLine: { show: labels, lineStyle: { color: theme.line } },
        emphasis: { scale: true, scaleSize: 4 },
      },
    ],
  };
}

export type Series = { name: string; color: string; values: number[] };

type SeriesOptions = {
  /** What the axis shows. */
  labels: string[];
  /** What the tooltip names, which can say more than fits under a bar. */
  titles?: string[];
  series: Series[];
  theme: ChartTheme;
  stacked?: boolean;
  format?: (value: number) => string;
  labelInterval?: number;
  /** A second measure, drawn as a line over the bars on a scale of its own at the right. */
  trend?: { name: string; values: number[]; max?: number; format: (value: number) => string };
};

/** Bars, stacked by default, and an optional line on a second scale. */
export function seriesOption({
  labels,
  titles = labels,
  series,
  theme,
  stacked = true,
  format = String,
  labelInterval,
  trend,
}: SeriesOptions): EChartsOption {
  const axes: ComboAxis[] = [{ side: "left", slot: 0, format }];
  const layers: ComboLayer[] = series.map((item) => ({
    kind: "bar",
    name: item.name,
    color: item.color,
    values: item.values,
    axis: 0,
    format,
    ...(stacked ? { stack: "all" } : {}),
  }));
  if (trend) {
    axes.push({ side: "right", slot: 0, format: trend.format, max: trend.max });
    layers.push({
      kind: "line",
      name: trend.name,
      color: theme.muted,
      values: trend.values,
      axis: 1,
      format: trend.format,
    });
  }
  return comboOption({
    labels,
    titles,
    layers,
    axes,
    theme,
    labelInterval,
    legend: layers.length > 1,
  });
}

/** One scale of a combined chart. "hidden" sizes its layers without drawing numbers. */
export type ComboAxis = {
  side: "left" | "right" | "hidden";
  /** The second scale on a side sits further out. */
  slot?: 0 | 1;
  format: (value: number) => string;
  max?: number | undefined;
};

export type ComboLayer = {
  kind: "bar" | "line";
  name: string;
  color: string;
  /** Null leaves a gap. */
  values: (number | null)[];
  /** Index into the axes. */
  axis: number;
  format: (value: number) => string;
  /** Bars with the same stack stand on each other; others stand side by side. */
  stack?: string;
};

type ComboOptions = {
  labels: string[];
  titles?: string[];
  layers: ComboLayer[];
  axes: ComboAxis[];
  theme: ChartTheme;
  labelInterval?: number | undefined;
  legend?: boolean;
  /** No axes at all, for charts too small to spare the room. */
  compact?: boolean;
  /** Only the inner scale on each side, for narrow charts. */
  narrow?: boolean;
};

const LEGEND_HEIGHT = 30;
/** How far the second scale on a side sits out from the first. */
const OUTER_AXIS_OFFSET = 44;

/**
 * Bars and lines in one plot, each on the scale it was given. With two units, such as reviews and
 * a share, the plot reads from both sides at once, like Anki's own charts.
 */
export function comboOption({
  labels,
  titles = labels,
  layers,
  axes,
  theme,
  labelInterval,
  legend = layers.length > 1,
  compact = false,
  narrow = false,
}: ComboOptions): EChartsOption {
  const top = legend ? LEGEND_HEIGHT : 8;
  const shown = (axis: ComboAxis) =>
    !compact && axis.side !== "hidden" && !(narrow && (axis.slot ?? 0) > 0);
  const outer = (side: "left" | "right") =>
    axes.some((axis) => axis.side === side && (axis.slot ?? 0) > 0 && shown(axis));
  const formatOf = new Map(layers.map((layer) => [layer.name, layer.format]));
  // The other scales line their steps up with one shown scale, so every label sits on a grid
  // line. A scale with a fixed top, such as 0 to 100 %, leads, since it cannot stretch.
  const fixed = axes.findIndex((axis) => shown(axis) && axis.max !== undefined);
  const leader = fixed >= 0 ? fixed : axes.findIndex(shown);
  return {
    legend: {
      show: legend,
      top: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: theme.muted, fontSize: 11 },
      inactiveColor: `${theme.muted}66`,
    },
    grid: {
      top,
      right: outer("right") ? OUTER_AXIS_OFFSET + 8 : 8,
      bottom: 4,
      left: outer("left") ? OUTER_AXIS_OFFSET + 4 : 4,
      outerBounds: {},
    },
    tooltip: {
      ...tooltip(theme),
      trigger: "axis",
      axisPointer: layers.some((layer) => layer.kind === "bar")
        ? { type: "shadow", shadowStyle: { color: `${theme.line}55` } }
        : { type: "line", lineStyle: { color: theme.muted, width: 1 } },
      formatter: axisTip(theme, (name) => formatOf.get(name) ?? String, titles),
    },
    xAxis: {
      show: !compact,
      type: "category",
      data: titles,
      axisLine: { lineStyle: { color: theme.line } },
      axisTick: { show: false },
      axisLabel: {
        color: theme.muted,
        fontSize: 11,
        hideOverlap: true,
        formatter: (_item: string, index: number) => labels[index] ?? "",
        ...(labelInterval === undefined ? {} : { interval: labelInterval }),
      },
    },
    // ECharts lines a scale with alignTicks up with the one scale that has none: the leader.
    yAxis: axes.map((axis, index) => ({
      type: "value" as const,
      show: shown(axis),
      position: axis.side === "right" ? ("right" as const) : ("left" as const),
      offset: (axis.slot ?? 0) > 0 ? OUTER_AXIS_OFFSET : 0,
      min: 0,
      ...(axis.max === undefined ? {} : { max: axis.max }),
      ...(index === leader
        ? axis.max === 100
          ? { interval: 25 }
          : { splitNumber: 3 }
        : leader >= 0
          ? { alignTicks: true }
          : { splitNumber: 3 }),
      axisLabel: {
        color: theme.muted,
        fontSize: 11,
        formatter: (item: number) => axis.format(item),
      },
      // One set of grid lines is enough; more scales would draw lines that do not line up.
      splitLine: {
        show: index === leader,
        lineStyle: { color: theme.line, type: "dashed" as const },
      },
    })),
    series: layers.map((layer) =>
      layer.kind === "bar"
        ? {
            type: "bar" as const,
            name: layer.name,
            data: layer.values,
            yAxisIndex: layer.axis,
            ...(layer.stack ? { stack: layer.stack } : {}),
            barMaxWidth: 24,
            itemStyle: {
              color: barColor(layer.color, theme, false),
              borderColor: theme.card,
              borderWidth: 1,
            },
          }
        : {
            type: "line" as const,
            name: layer.name,
            data: layer.values,
            yAxisIndex: layer.axis,
            symbol: layer.values.length <= 14 ? "circle" : "none",
            symbolSize: 5,
            connectNulls: false,
            z: 3,
            lineStyle: { color: layer.color, width: 2 },
            itemStyle: { color: layer.color },
          },
    ),
  };
}

export type TrendLine = {
  name: string;
  color: string;
  /** Null leaves a gap, such as the past for a forecast. */
  values: (number | null)[];
  format: (value: number) => string;
  dashed?: boolean;
  /** A rate whose ups and downs matter more than its distance from zero. */
  floating?: boolean;
};

type TrendOptions = {
  /** What the hover box names each point. */
  titles: string[];
  lines: TrendLine[];
  theme: ChartTheme;
  /** Axis labels at a few places only, by index. */
  marks: Record<number, string>;
  /** Where a dashed line marks today. */
  todayIndex?: number;
};

/**
 * Several measures over the same days, each on a scale of its own, so their shapes compare
 * without one large number flattening the others. The scales stay hidden on purpose: the hover
 * box tells each value.
 */
export function trendOption({
  titles,
  lines,
  theme,
  marks,
  todayIndex,
}: TrendOptions): EChartsOption {
  return {
    legend: {
      top: 0,
      left: "center",
      icon: "roundRect",
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 14,
      textStyle: { color: theme.muted, fontSize: 10.5, fontWeight: 650 },
      inactiveColor: `${theme.muted}66`,
    },
    grid: { top: 26, right: 6, bottom: 20, left: 6 },
    tooltip: {
      ...tooltip(theme),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.muted, width: 1 } },
      formatter: axisTip(
        theme,
        (name) => lines.find((line) => line.name === name)?.format ?? String,
        titles,
      ),
    },
    xAxis: {
      type: "category",
      data: titles,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.muted,
        fontSize: 10,
        fontWeight: 650,
        interval: (index: number) => index in marks,
        formatter: (_value: string, index: number) => marks[index] ?? "",
        alignMinLabel: "left",
        alignMaxLabel: "right",
      },
    },
    yAxis: lines.map((line) => ({
      type: "value" as const,
      show: false,
      scale: line.floating === true,
      ...(line.floating ? {} : { min: 0 }),
    })),
    series: lines.map((line, index) => ({
      type: "line" as const,
      name: line.name,
      yAxisIndex: index,
      data: line.values,
      smooth: 0.35,
      symbol: "none",
      connectNulls: false,
      lineStyle: {
        color: line.color,
        width: 2,
        type: line.dashed ? ("dashed" as const) : ("solid" as const),
      },
      itemStyle: { color: line.color },
      ...(index === 0 && todayIndex !== undefined
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: theme.muted, type: "dashed" as const, width: 1 },
              data: [{ xAxis: todayIndex }],
            },
          }
        : {}),
    })),
  };
}
