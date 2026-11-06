import type { MetricSource, SeriesSource, WidgetRange } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useStatistic } from "../../lib/calls.ts";
import { durationParts, shortDate, weekdayName } from "../../lib/format.ts";
import { rangeOf } from "../dashboard/useDashboardFilters.ts";
import type { WidgetScope } from "../dashboard/widgets.tsx";

export function useElementRange(range: WidgetRange, scope: WidgetScope) {
  const today = useStatistic("statistics.today", {});
  if (range === "dashboard" || !today.data) {
    return { start: scope.start, end: scope.end, deckId: scope.deckId };
  }
  const { start, end } = rangeOf({
    preset: range,
    custom: null,
    today: today.data.date,
    firstReview: today.data.firstReview,
  });
  return { start, end, deckId: scope.deckId };
}

const FROM_DUE = new Set<MetricSource>(["dueCards"]);
const FROM_HEATMAP = new Set<MetricSource>(["currentStreak", "longestStreak", "dailyAverage"]);

/** The raw number behind a metric. Fetches only what this source needs. */
export function useMetricValue(
  source: MetricSource,
  range: WidgetRange,
  scope: WidgetScope,
): number | null | undefined {
  const params = useElementRange(range, scope);
  const needsDue = FROM_DUE.has(source);
  const needsHeatmap = FROM_HEATMAP.has(source);
  const summary = useStatistic("statistics.summary", params, !needsDue && !needsHeatmap);
  const due = useStatistic("statistics.due", { deckId: scope.deckId }, needsDue);
  const heatmap = useStatistic(
    "statistics.heatmap",
    { year: null, deckId: scope.deckId },
    needsHeatmap,
  );
  switch (source) {
    case "reviews":
      return summary.data?.reviews;
    case "ratings":
      return summary.data?.ratings;
    case "studyTime":
      return summary.data?.studyTimeMs;
    case "successRate":
      return summary.data?.successRate;
    case "retention":
      return summary.data?.retention;
    case "activeDays":
      return summary.data?.activeDays;
    case "dueCards":
      return due.data?.cards;
    case "currentStreak":
      return heatmap.data?.currentStreak;
    case "longestStreak":
      return heatmap.data?.longestStreak;
    default:
      return heatmap.data?.dailyAverage;
  }
}

export function useFormatMetric() {
  const { t, i18n } = useTranslation();
  return (source: MetricSource, value: number | null | undefined): string => {
    if (value === null || value === undefined) {
      return "–";
    }
    if (source === "successRate" || source === "retention") {
      return new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    }
    if (source === "studyTime") {
      const parts = durationParts(value);
      return parts.hours > 0
        ? t("time.hoursMinutes", parts)
        : parts.minutes > 0
          ? t("time.minutes", parts)
          : t("time.seconds", parts);
    }
    return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(value);
  };
}

export type SeriesPoint = { label: string; value: number };

/** Turns any series into labeled values, so one chart element can draw all of them. */
export function useSeries(source: SeriesSource, range: WidgetRange, scope: WidgetScope) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const params = useElementRange(range, scope);
  const usesRhythm = source === "weekdays" || source === "hours";
  const timelineMeasure = source === "ratingTimeline" ? "ratings" : "reviews";
  const timeline = useStatistic(
    "statistics.timeline",
    { ...params, measure: timelineMeasure },
    source === "timeline" || source === "ratingTimeline",
  );
  const buttons = useStatistic("statistics.answerButtons", params, source === "answerButtons");
  const decks = useStatistic("statistics.deckActivity", params, source === "deckActivity");
  const forecast = useStatistic(
    "statistics.forecast",
    { deckId: scope.deckId },
    source === "forecast",
  );
  const states = useStatistic(
    "statistics.cardStates",
    { deckId: scope.deckId },
    source === "cardStates",
  );
  const rhythm = useStatistic("statistics.rhythm", params, usesRhythm);

  switch (source) {
    case "timeline":
    case "ratingTimeline":
      return (timeline.data?.items ?? []).map((item) => ({
        label: shortDate(item.date, locale),
        value: item.count,
      }));
    case "answerButtons": {
      const data = buttons.data;
      return (["again", "hard", "good", "easy"] as const).map((key) => ({
        label: t(`answers.${key}`),
        value: data?.[key] ?? 0,
      }));
    }
    case "deckActivity":
      return (decks.data ?? []).slice(0, 8).map((entry) => ({
        label: entry.name?.split("::").at(-1) ?? t("widgets.deck-activity.deleted"),
        value: entry.count,
      }));
    case "forecast":
      return (forecast.data ?? []).map((day) => ({
        label: shortDate(day.date, locale),
        value: day.cards,
      }));
    case "cardStates": {
      const data = states.data;
      return (["new", "learning", "review", "suspended", "buried"] as const).map((key) => ({
        label: t(`states.${key}`),
        value: data?.[key] ?? 0,
      }));
    }
    case "weekdays":
      return (rhythm.data?.weekdays ?? []).map((value, index) => ({
        label: weekdayName(index, locale),
        value,
      }));
    default:
      return (rhythm.data?.hours ?? []).map((value, hour) => ({ label: String(hour), value }));
  }
}
