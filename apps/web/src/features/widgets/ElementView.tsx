import {
  barOption,
  type ComboAxis,
  comboOption,
  type EChartsOption,
  pieOption,
  readChartTheme,
} from "@statly/charts";
import {
  type ChartLayer,
  type Paint,
  type SeriesUnit,
  seriesUnitOf,
  type WidgetElement,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { paintValue, planAxes, progressShare, textStyle } from "@statly/widget-runtime";
import { useMemo } from "react";
import { CalendarHeatmap, type HeatDay } from "../../components/CalendarHeatmap.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { addDays, fullDate } from "../../lib/format.ts";
import { Chart } from "../dashboard/Chart.tsx";
import { heatScale, heatValue } from "../dashboard/insightWidgets.tsx";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { layersOf } from "./chartLayers.ts";
import { type SeriesPoint, useFormatMetric, useMetricValue, useSeries } from "./sources.ts";
import { useMedia } from "./useCustomWidgets.ts";

type Of<K extends WidgetElement["kind"]> = Extract<WidgetElement, { kind: K }>;
type Props<K extends WidgetElement["kind"]> = {
  element: Of<K>;
  scope: WidgetScope;
  frame: ElementFrame;
};

/** What an element knows about the size it is drawn at. */
export type ElementFrame = {
  /** Height over width of the widget's design size. */
  aspect: number;
  heightPx: number;
  widthPx?: number;
};

/** Below this height axes take more room than the data, so small charts drop them. */
const AXIS_MIN_HEIGHT_PX = 110;
/** Below this width a combined chart keeps only the inner scale on each side. */
const OUTER_AXES_MIN_WIDTH_PX = 420;

/** A theme color as a plain value, which charts need. */
function resolvedPaint(paint: Paint): string {
  const color = paintValue(paint);
  return color.startsWith("var(")
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim()
    : color;
}

function FitText({ style, children }: { style: React.CSSProperties; children: string }) {
  return (
    <div className="flex h-full w-full items-center overflow-hidden" style={style}>
      <span className="w-full whitespace-pre-wrap">{children}</span>
    </div>
  );
}

function MetricView({ element, scope, frame }: Props<"metric">) {
  const value = useMetricValue(element.source, element.range, scope);
  const format = useFormatMetric();
  return (
    <FitText style={textStyle(element, frame.aspect)}>{format(element.source, value)}</FitText>
  );
}

function useThemedChart(
  build: (theme: ReturnType<typeof readChartTheme>) => EChartsOption,
  key: string,
  deps: unknown[],
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `deps` lists what the option uses.
  return useMemo(() => build(readChartTheme()), [key, ...deps]);
}

function ChartView(props: Props<"chart">) {
  return props.element.chart === "combined" ? (
    <CombinedChartView {...props} />
  ) : (
    <SingleChartView {...props} />
  );
}

function SingleChartView({ element, scope, frame }: Props<"chart">) {
  const { i18n } = useTranslation();
  const points = useSeries(element.source, element.range, scope).map((point) => ({
    label: point.label,
    value: point.value ?? 0,
  }));
  const number = new Intl.NumberFormat(i18n.language);
  const resolved = resolvedPaint(element.color);
  const compact = frame.heightPx < AXIS_MIN_HEIGHT_PX;
  const kind = element.chart === "line" ? "line" : "bar";
  const option = useThemedChart(
    (theme) =>
      element.chart === "pie"
        ? pieOption({
            slices: points,
            theme: { ...theme, accent: resolved },
            format: (value) => number.format(value),
            labels: !compact,
          })
        : barOption({
            bars: points,
            theme: { ...theme, accent: resolved },
            format: (value) => number.format(value),
            labelInterval: Math.floor(points.length / 6),
            kind,
            compact,
          }),
    scope.themeKey,
    [JSON.stringify(points), resolved, element.chart, compact],
  );
  return <Chart option={option} label={element.source} />;
}

/** Lays several series over one axis: labels in the order they first appear, gaps as null. */
export function joinSeries(series: SeriesPoint[][]): {
  labels: string[];
  values: (number | null)[][];
} {
  const longest = series.reduce<SeriesPoint[]>(
    (best, item) => (item.length > best.length ? item : best),
    [],
  );
  const labels = longest.map((point) => point.label);
  const known = new Set(labels);
  for (const item of series) {
    for (const point of item) {
      if (!known.has(point.label)) {
        known.add(point.label);
        labels.push(point.label);
      }
    }
  }
  const values = series.map((item) => {
    const byLabel = new Map(item.map((point) => [point.label, point.value]));
    return labels.map((label) => byLabel.get(label) ?? null);
  });
  return { labels, values };
}

function useUnitFormat() {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  return (unit: SeriesUnit) =>
    (value: number): string => {
      const shown = number.format(value);
      return unit === "count" ? shown : t(`editor.axisUnits.${unit}`, { value: shown });
    };
}

function CombinedChartView({ element, scope, frame }: Props<"chart">) {
  const { t } = useTranslation();
  const layers = layersOf(element);
  const at = (index: number): ChartLayer | undefined => layers[index];
  // Hooks run the same number of times on every render, so unused slots fetch nothing.
  const fetched = [
    useSeries(at(0)?.source ?? element.source, element.range, scope, at(0) !== undefined),
    useSeries(at(1)?.source ?? element.source, element.range, scope, at(1) !== undefined),
    useSeries(at(2)?.source ?? element.source, element.range, scope, at(2) !== undefined),
    useSeries(at(3)?.source ?? element.source, element.range, scope, at(3) !== undefined),
    useSeries(at(4)?.source ?? element.source, element.range, scope, at(4) !== undefined),
    useSeries(at(5)?.source ?? element.source, element.range, scope, at(5) !== undefined),
  ].slice(0, layers.length);
  const formatFor = useUnitFormat();
  const compact = frame.heightPx < AXIS_MIN_HEIGHT_PX;
  const narrow = (frame.widthPx ?? Number.POSITIVE_INFINITY) < OUTER_AXES_MIN_WIDTH_PX;
  const { labels, values } = joinSeries(fetched);
  const plan = planAxes(
    layers.map((layer) => ({ axis: layer.axis, unit: seriesUnitOf[layer.source] })),
  );
  const colors = layers.map((layer) => resolvedPaint(layer.color));
  const names = layers.map((layer, index) => {
    const name = t(`editor.series.${layer.source}`);
    const before = layers.slice(0, index).filter((other) => other.source === layer.source).length;
    return before > 0 ? `${name} (${before + 1})` : name;
  });
  const option = useThemedChart(
    (theme) => {
      const axes: ComboAxis[] = plan.axes.map((axis) => {
        const format = formatFor(axis.unit as SeriesUnit);
        const percentOnly =
          axis.unit === "percent" &&
          values.every(
            (row, index) =>
              plan.layerAxis[index] !== plan.axes.indexOf(axis) ||
              row.every((value) => value === null || value <= 100),
          );
        return axis.side === "hidden"
          ? { side: "hidden", format, ...(percentOnly ? { max: 100 } : {}) }
          : { side: axis.side, slot: axis.slot, format, ...(percentOnly ? { max: 100 } : {}) };
      });
      return comboOption({
        labels,
        layers: layers.map((layer, index) => ({
          kind: layer.kind,
          name: names[index] ?? "",
          color: colors[index] ?? theme.accent,
          values: values[index] ?? [],
          axis: plan.layerAxis[index] ?? 0,
          format: formatFor(seriesUnitOf[layer.source]),
        })),
        axes,
        theme,
        labelInterval: Math.floor(labels.length / 6),
        legend: !compact && layers.length > 1,
        compact,
        narrow,
      });
    },
    scope.themeKey,
    [
      JSON.stringify(values),
      labels.join("|"),
      JSON.stringify(layers),
      colors.join(),
      compact,
      narrow,
    ],
  );
  return <Chart option={option} label={names.join(", ")} />;
}

function ProgressView({ element, scope }: Props<"progress">) {
  const value = useMetricValue(element.source, element.range, scope);
  const format = useFormatMetric();
  const share = progressShare(value ?? 0, element.goal);
  const color = paintValue(element.color);
  if (element.style === "bar") {
    return (
      <div className="h-full w-full overflow-hidden rounded-full bg-hover">
        <div
          className="h-full rounded-full"
          style={{ width: `${share * 100}%`, background: color }}
        />
      </div>
    );
  }
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={element.source}>
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="var(--statly-hover)"
        strokeWidth="10"
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${share * circumference} ${circumference}`}
        transform="rotate(-90 50 50)"
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="16"
        fontWeight="700"
        fill="var(--statly-text)"
      >
        {format(element.source, value)}
      </text>
    </svg>
  );
}

function HeatmapView({ element, scope }: { element: Of<"heatmap">; scope: WidgetScope }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const mode = element.mode ?? "reviews";
  const today = useStatistic("statistics.today", {});
  const end = today.data?.date ?? scope.end;
  const start = addDays(end, -7 * 53);
  const daily = useStatistic(
    "statistics.daily",
    { start, end, deckId: scope.deckId },
    today.data !== undefined,
  );
  const days = useMemo(
    () =>
      new Map<string, HeatDay>(
        (daily.data?.days ?? []).map((day) => [day.date, { value: heatValue(mode, day) }]),
      ),
    [daily.data, mode],
  );
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <CalendarHeatmap
      end={end}
      today={end}
      days={days}
      scale={heatScale(mode)}
      locale={locale}
      label={t(`widgets.study-overview.modes.${mode}`)}
      minCell={6}
      tip={(date, day) => ({
        title: fullDate(date, locale),
        rows: [
          {
            label: t(`widgets.study-overview.modes.${mode}`),
            value:
              day?.value == null
                ? "–"
                : number.format(mode === "retention" ? day.value * 100 : day.value),
          },
        ],
      })}
    />
  );
}

function MediaView({ element }: { element: Of<"media"> }) {
  const url = useMedia(element.asset.id);
  const style = { objectFit: element.fit, borderRadius: `${element.radius}%` };
  if (!url) {
    return <div className="h-full w-full animate-pulse rounded-control bg-hover" />;
  }
  return element.asset.type.startsWith("video/") ? (
    <video
      src={url}
      autoPlay
      loop={element.loop ?? true}
      muted
      playsInline
      className="h-full w-full"
      style={style}
    />
  ) : (
    <img src={url} alt="" className="h-full w-full" style={style} />
  );
}

export function ElementView({
  element,
  scope,
  frame,
}: {
  element: WidgetElement;
  scope: WidgetScope;
  frame: ElementFrame;
}) {
  switch (element.kind) {
    case "text":
      return <FitText style={textStyle(element, frame.aspect)}>{element.text}</FitText>;
    case "metric":
      return <MetricView element={element} scope={scope} frame={frame} />;
    case "chart":
      return <ChartView element={element} scope={scope} frame={frame} />;
    case "progress":
      return <ProgressView element={element} scope={scope} frame={frame} />;
    case "heatmap":
      return <HeatmapView element={element} scope={scope} />;
    case "media":
      return <MediaView element={element} />;
    default:
      return (
        <div
          className="h-full w-full"
          style={{
            background: paintValue(element.fill),
            borderRadius: element.shape === "ellipse" ? "50%" : `${element.radius}%`,
          }}
        />
      );
  }
}
