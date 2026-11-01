import { barOption, type EChartsOption, heatmapOption, readChartTheme } from "@statly/charts";
import type { WidgetElement } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { paintValue, progressShare, textStyle } from "@statly/widget-runtime";
import { useMemo } from "react";
import { useStatistic } from "../../lib/calls.ts";
import { fullDate } from "../../lib/format.ts";
import { Chart } from "../dashboard/Chart.tsx";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { useFormatMetric, useMetricValue, useSeries } from "./sources.ts";
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
};

/** Below this height axes take more room than the data, so small charts drop them. */
const AXIS_MIN_HEIGHT_PX = 110;

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

function ChartView({ element, scope, frame }: Props<"chart">) {
  const { i18n } = useTranslation();
  const points = useSeries(element.source, element.range, scope);
  const number = new Intl.NumberFormat(i18n.language);
  const color = paintValue(element.color);
  const resolved = color.startsWith("var(")
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim()
    : color;
  const compact = frame.heightPx < AXIS_MIN_HEIGHT_PX;
  const option = useThemedChart(
    (theme) =>
      barOption({
        bars: points,
        theme: { ...theme, accent: resolved },
        format: (value) => number.format(value),
        labelInterval: Math.floor(points.length / 6),
        kind: element.chart,
        compact,
      }),
    scope.themeKey,
    [points, resolved, element.chart, compact],
  );
  return <Chart option={option} label={element.source} />;
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

function HeatmapView({ scope }: { scope: WidgetScope }) {
  const { t, i18n } = useTranslation();
  const heatmap = useStatistic("statistics.heatmap", { year: null, deckId: scope.deckId });
  const data = heatmap.data;
  const option = useThemedChart(
    (theme) =>
      heatmapOption({
        year: data?.year ?? new Date().getFullYear(),
        days: data?.days ?? [],
        theme,
        locale: i18n.language,
        format: (date, reviews) =>
          t("widgets.review-heatmap.tooltip", {
            date: fullDate(date, i18n.language),
            count: reviews,
            reviews,
          }),
      }),
    scope.themeKey,
    [data, i18n.language],
  );
  return <Chart option={option} label={t("widgets.review-heatmap.title")} />;
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
      return <HeatmapView scope={scope} />;
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
