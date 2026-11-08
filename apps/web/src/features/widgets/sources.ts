import type { MetricSource, SeriesSource, WidgetRange } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useStatistic } from "../../lib/calls.ts";
import { durationParts, monthName, shortDate, weekdayName } from "../../lib/format.ts";
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
const FROM_SUMMARY = new Set<MetricSource>([
  "reviews",
  "ratings",
  "studyTime",
  "successRate",
  "retention",
  "activeDays",
  "newCards",
  "secondsPerRating",
]);
const SHARES = new Set<MetricSource>(["successRate", "retention", "focus", "matureShare"]);
const FROM_CREATION = new Set<MetricSource>([
  "creationTime",
  "cardsCreated",
  "secondsPerCreatedCard",
]);

/** The raw number behind a metric. Fetches only what this source needs. */
export function useMetricValue(
  source: MetricSource,
  range: WidgetRange,
  scope: WidgetScope,
): number | null | undefined {
  const params = useElementRange(range, scope);
  const needsDue = FROM_DUE.has(source);
  const needsHeatmap = FROM_HEATMAP.has(source);
  const summary = useStatistic("statistics.summary", params, FROM_SUMMARY.has(source));
  const speed = useStatistic("statistics.speed", params, source === "focus");
  const states = useStatistic(
    "statistics.cardStates",
    { deckId: scope.deckId },
    source === "matureShare",
  );
  const forgotten = useStatistic(
    "statistics.forgotten",
    { ...params, limit: 1 },
    source === "forgottenCards",
  );
  const due = useStatistic("statistics.due", { deckId: scope.deckId }, needsDue);
  const creation = useStatistic("statistics.creation", params, FROM_CREATION.has(source));
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
    case "newCards":
      return summary.data?.newCards;
    case "secondsPerRating": {
      const data = summary.data;
      return data && (data.ratings > 0 ? data.studyTimeMs / data.ratings / 1000 : null);
    }
    case "focus":
      return speed.data?.current.focus;
    case "matureShare": {
      const data = states.data;
      if (!data) {
        return undefined;
      }
      const cards =
        data.new + data.learning + data.review + data.suspended + data.buried + data.other;
      return cards > 0 ? data.mature / cards : null;
    }
    case "forgottenCards":
      return forgotten.data?.total;
    case "creationTime":
      // Milliseconds, like the study time, so both read the same way.
      return creation.data && creation.data.total.seconds * 1000;
    case "cardsCreated":
      return creation.data?.total.cards;
    case "secondsPerCreatedCard": {
      const total = creation.data?.total;
      return total && (total.cards > 0 ? total.seconds / total.cards : null);
    }
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
    if (source === "secondsPerRating" || source === "secondsPerCreatedCard") {
      return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)} s`;
    }
    if (SHARES.has(source)) {
      return new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    }
    if (source === "studyTime" || source === "creationTime") {
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

/** Null means no value there, such as an hour without answers. */
export type SeriesPoint = { label: string; value: number | null };

/** Turns any series into labeled values, so one chart element can draw all of them. */
export function useSeries(
  source: SeriesSource,
  range: WidgetRange,
  scope: WidgetScope,
  /** False fetches nothing, for a layer slot a combined chart does not use. */
  enabled = true,
) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const params = useElementRange(range, scope);
  const usesRhythm = source === "weekdays" || source === "hours";
  const timelineMeasure = source === "ratingTimeline" ? "ratings" : "reviews";
  const timeline = useStatistic(
    "statistics.timeline",
    { ...params, measure: timelineMeasure },
    enabled && (source === "timeline" || source === "ratingTimeline"),
  );
  const buttons = useStatistic(
    "statistics.answerButtons",
    params,
    enabled && source === "answerButtons",
  );
  const activity = useStatistic(
    "statistics.deckActivity",
    params,
    enabled && source === "deckActivity",
  );
  const forecast = useStatistic(
    "statistics.forecast",
    { deckId: scope.deckId },
    enabled && source === "forecast",
  );
  const states = useStatistic(
    "statistics.cardStates",
    { deckId: scope.deckId },
    enabled && source === "cardStates",
  );
  const rhythm = useStatistic("statistics.rhythm", params, enabled && usesRhythm);
  const usesDaily = DAILY_SERIES.has(source);
  const daily = useStatistic("statistics.daily", params, enabled && usesDaily);
  const forgotten = useStatistic(
    "statistics.forgotten",
    { ...params, limit: 8 },
    enabled && source === "forgottenCards",
  );
  const topics = useStatistic(
    "statistics.topics",
    params,
    enabled && (source === "weakestDecks" || source === "newCardsFrom"),
  );
  const decks = useStatistic(
    "statistics.deckTable",
    { ...params, measure: "reviews" },
    enabled && source === "deckStability",
  );
  const sessions = useStatistic(
    "statistics.sessions",
    params,
    enabled && (source === "sessionHours" || source === "focusHours"),
  );
  const creation = useStatistic(
    "statistics.creation",
    params,
    enabled && source === "creationTimeline",
  );

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
      return (activity.data ?? []).slice(0, 8).map((entry) => ({
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
    case "retentionTimeline":
    case "speedTimeline":
    case "timeTimeline":
    case "newTimeline":
      return (daily.data?.days ?? []).map((day) => ({
        label: shortDate(day.date, locale),
        value: dailyValue(source, day),
      }));
    case "forgottenCards":
      return (forgotten.data?.cards ?? []).map((card) => ({
        label: card.text.length > 28 ? `${card.text.slice(0, 27)}…` : card.text,
        value: card.forgot,
      }));
    case "weakestDecks":
      return (topics.data?.weakest ?? []).map((deck) => ({
        label: deck.name,
        value: Math.round((deck.passed / deck.checked) * 100),
      }));
    case "newCardsFrom":
      return (topics.data?.newFrom ?? []).map((deck) => ({ label: deck.name, value: deck.cards }));
    case "deckStability":
      return (decks.data?.rows ?? [])
        .filter((row) => row.parentId === null && row.stabilityDays !== null)
        .slice(0, 8)
        .map((row) => ({ label: row.name, value: Math.round(row.stabilityDays ?? 0) }));
    case "sessionHours":
      return (sessions.data?.hours ?? []).map((hour, index) => ({
        label: String(index),
        value: hour.ratings,
      }));
    case "focusHours":
      // Percent, like retention over time. An hour without answers has no focus.
      return (sessions.data?.hours ?? []).map((hour, index) => ({
        label: String(index),
        value: hour.focus === null ? null : Math.round(hour.focus * 100),
      }));
    case "creationTimeline": {
      const label = creation.data?.granularity === "month" ? monthName : shortDate;
      // Minutes, like the study time over time.
      return (creation.data?.items ?? []).map((item) => ({
        label: label(item.date, locale),
        value: Math.round(item.seconds / 60),
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

const DAILY_SERIES = new Set<SeriesSource>([
  "retentionTimeline",
  "speedTimeline",
  "timeTimeline",
  "newTimeline",
]);

type DailyDay = {
  ratings: number;
  timeMs: number;
  newCards: number;
  checked: number;
  passed: number;
};

/** Retention in percent, pace in seconds, time in minutes: whole numbers, as on the phone. */
function dailyValue(source: SeriesSource, day: DailyDay): number {
  switch (source) {
    case "retentionTimeline":
      return day.checked > 0 ? Math.round((day.passed / day.checked) * 100) : 0;
    case "speedTimeline":
      return day.ratings > 0 ? Math.round(day.timeMs / day.ratings / 100) / 10 : 0;
    case "timeTimeline":
      return Math.round(day.timeMs / 60_000);
    default:
      return day.newCards;
  }
}
