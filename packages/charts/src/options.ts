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
  };
}

function tooltip(theme: ChartTheme): EChartsOption["tooltip"] {
  return {
    backgroundColor: theme.card,
    borderColor: theme.line,
    textStyle: { color: theme.text, fontSize: 12 },
    confine: true,
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
      valueFormatter: (value) => format(Number(value)),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [
      kind === "line"
        ? {
            type: "line",
            data: bars.map((bar) => bar.value),
            symbol: "none",
            lineStyle: { color: theme.accent, width: 2 },
            itemStyle: { color: theme.accent },
          }
        : {
            type: "bar",
            data: bars.map((bar) => bar.value),
            barMaxWidth: 28,
            barCategoryGap: "24%",
            itemStyle: {
              color: theme.accent,
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
  /** A second measure gets a panel of its own, because two scales on one plot mislead. */
  trend?: { name: string; values: number[]; max?: number; format: (value: number) => string };
};

const LEGEND_HEIGHT = 24;
const TREND_SHARE = 0.26;

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
  const legend = series.length > 1;
  const top = legend ? LEGEND_HEIGHT : 8;
  const plotBottom = trend ? `${TREND_SHARE * 100 + 6}%` : 4;
  const category = {
    type: "category" as const,
    data: titles,
    axisLine: { lineStyle: { color: theme.line } },
    axisTick: { show: false },
  };
  const value = {
    type: "value" as const,
    splitNumber: 3,
    axisLabel: { color: theme.muted, fontSize: 11, formatter: (item: number) => format(item) },
    splitLine: { lineStyle: { color: theme.line, type: "dashed" as const } },
  };
  return {
    legend: {
      show: legend,
      top: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: theme.muted, fontSize: 11 },
    },
    grid: [
      { top, right: 8, bottom: plotBottom, left: 4, outerBounds: {} },
      ...(trend
        ? [{ height: `${TREND_SHARE * 100 - 6}%`, right: 8, bottom: 4, left: 4, outerBounds: {} }]
        : []),
    ],
    tooltip: {
      ...tooltip(theme),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${theme.line}55` } },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis: [
      {
        ...category,
        axisLabel: {
          color: theme.muted,
          fontSize: 11,
          hideOverlap: true,
          show: !trend,
          formatter: (_item: string, index: number) => labels[index] ?? "",
          ...(labelInterval === undefined ? {} : { interval: labelInterval }),
        },
      },
      ...(trend
        ? [
            {
              ...category,
              gridIndex: 1,
              axisLabel: {
                color: theme.muted,
                fontSize: 11,
                hideOverlap: true,
                formatter: (_item: string, index: number) => labels[index] ?? "",
                ...(labelInterval === undefined ? {} : { interval: labelInterval }),
              },
            },
          ]
        : []),
    ],
    yAxis: [
      value,
      ...(trend
        ? [
            {
              ...value,
              gridIndex: 1,
              splitNumber: 2,
              ...(trend.max === undefined ? {} : { max: trend.max }),
              axisLabel: { ...value.axisLabel, formatter: (item: number) => trend.format(item) },
            },
          ]
        : []),
    ],
    series: [
      ...series.map((item) => ({
        type: "bar" as const,
        name: item.name,
        data: item.values,
        ...(stacked ? { stack: "all" } : {}),
        barMaxWidth: 24,
        itemStyle: { color: item.color, borderColor: theme.card, borderWidth: 1 },
        tooltip: { valueFormatter: (item_: unknown) => format(Number(item_)) },
      })),
      ...(trend
        ? [
            {
              type: "line" as const,
              name: trend.name,
              data: trend.values,
              xAxisIndex: 1,
              yAxisIndex: 1,
              symbol: "none",
              lineStyle: { color: theme.muted, width: 2 },
              itemStyle: { color: theme.muted },
              tooltip: { valueFormatter: (item_: unknown) => trend.format(Number(item_)) },
            },
          ]
        : []),
    ],
  };
}

type HeatmapOptions = {
  year: number;
  days: { date: string; reviews: number }[];
  theme: ChartTheme;
  locale: string;
  format: (date: string, reviews: number) => string;
};

export function heatmapOption({
  year,
  days,
  theme,
  locale,
  format,
}: HeatmapOptions): EChartsOption {
  const highest = Math.max(1, ...days.map((day) => day.reviews));
  const emptyDay = theme.sequence[0] ?? theme.line;
  const names = (options: Intl.DateTimeFormatOptions, dates: Date[]) =>
    dates.map((date) => new Intl.DateTimeFormat(locale, options).format(date));
  const months = Array.from({ length: 12 }, (_, month) => new Date(2024, month, 1));
  // 2024-01-07 was a Sunday, which is where ECharts starts counting.
  const weekdays = Array.from({ length: 7 }, (_, day) => new Date(2024, 0, 7 + day));
  return {
    tooltip: {
      ...tooltip(theme),
      formatter: (item) => {
        const [date, reviews] = (item as unknown as { value: [string, number] }).value;
        return format(date, reviews);
      },
    },
    visualMap: {
      show: false,
      min: 1,
      max: highest,
      inRange: { color: theme.sequence.slice(1) },
      outOfRange: { color: emptyDay },
    },
    calendar: {
      top: 22,
      left: 34,
      right: 8,
      bottom: 6,
      range: String(year),
      cellSize: ["auto", "auto"],
      splitLine: { show: false },
      itemStyle: { color: emptyDay, borderColor: theme.card, borderWidth: 2 },
      dayLabel: {
        firstDay: 1,
        nameMap: names({ weekday: "short" }, weekdays),
        color: theme.muted,
        fontSize: 10,
      },
      monthLabel: { nameMap: names({ month: "short" }, months), color: theme.muted, fontSize: 10 },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: days.map((day) => [day.date, day.reviews]),
      },
    ],
  };
}
