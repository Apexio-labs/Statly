import { barOption, heatmapOption } from "@statly/charts";
import type { WidgetType } from "@statly/contract";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { useStatistic } from "../../lib/calls.ts";
import {
  addDays,
  durationParts,
  fullDate,
  monthName,
  shortDate,
  weekdayName,
} from "../../lib/format.ts";
import { ankiWidgets } from "./ankiWidgets.tsx";
import { Chart } from "./Chart.tsx";
import { WidgetCard, WidgetState } from "./WidgetCard.tsx";
import { ChipGroup, Tile, useChartTheme, useFormatters, type WidgetProps } from "./widgetParts.tsx";

export type { WidgetScope } from "./widgetParts.tsx";

function ReviewSummary({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const summary = useStatistic("statistics.summary", { start, end, deckId });
  return (
    <WidgetCard title={t("widgets.review-summary.title")}>
      <WidgetState status={summary} empty={false}>
        <Tile
          value={summary.data ? number(summary.data.reviews) : null}
          note={t("widgets.review-summary.note")}
        />
      </WidgetState>
    </WidgetCard>
  );
}

function StudyTime({ scope }: WidgetProps) {
  const { t } = useFormatters();
  const { start, end, deckId } = scope;
  const summary = useStatistic("statistics.summary", { start, end, deckId });
  const parts = durationParts(summary.data?.studyTimeMs ?? 0);
  const value =
    parts.hours > 0
      ? t("time.hoursMinutes", parts)
      : parts.minutes > 0
        ? t("time.minutes", parts)
        : t("time.seconds", parts);
  return (
    <WidgetCard title={t("widgets.study-time.title")}>
      <WidgetState status={summary} empty={false}>
        <Tile value={value} note={t("widgets.study-time.note")} />
      </WidgetState>
    </WidgetCard>
  );
}

function SuccessRate({ scope }: WidgetProps) {
  const { t, locale } = useFormatters();
  const { start, end, deckId } = scope;
  const summary = useStatistic("statistics.summary", { start, end, deckId });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const rate = summary.data?.successRate;
  return (
    <WidgetCard title={t("widgets.success-rate.title")}>
      <WidgetState status={summary} empty={false}>
        <Tile
          value={rate === null || rate === undefined ? "–" : percent.format(rate)}
          note={t("widgets.success-rate.note")}
        />
      </WidgetState>
    </WidgetCard>
  );
}

function DueCards({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const due = useStatistic("statistics.due", { deckId: scope.deckId });
  return (
    <WidgetCard title={t("widgets.due-cards.title")}>
      <WidgetState status={due} empty={false}>
        <Tile value={due.data ? number(due.data.cards) : null} note={t("widgets.due-cards.note")} />
      </WidgetState>
    </WidgetCard>
  );
}

function ReviewBreakdown({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const categories = useStatistic("statistics.categories", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const data = categories.data;
  const keys = ["total", "failed", "new", "reviewed", "relearned", "longInterval"] as const;
  const bars = data ? keys.map((key) => ({ label: t(`categories.${key}`), value: data[key] })) : [];
  const title = t("widgets.review-breakdown.title");
  return (
    <WidgetCard title={title} note={t("widgets.review-breakdown.note")}>
      <WidgetState status={categories} empty={data?.total === 0}>
        <Chart
          option={barOption({ bars, theme, horizontal: true, format: number })}
          label={title}
        />
      </WidgetState>
    </WidgetCard>
  );
}

const MAX_DECK_BARS = 10;

function DeckActivity({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const activity = useStatistic("statistics.deckActivity", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const bars = (activity.data ?? []).slice(0, MAX_DECK_BARS).map((entry) => ({
    label: entry.name?.split("::").at(-1) ?? t("widgets.deck-activity.deleted"),
    value: entry.reviews,
  }));
  const title = t("widgets.deck-activity.title");
  return (
    <WidgetCard title={title} note={t("widgets.deck-activity.note")}>
      <WidgetState status={activity} empty={bars.length === 0}>
        <Chart
          option={barOption({ bars, theme, horizontal: true, format: number })}
          label={title}
        />
      </WidgetState>
    </WidgetCard>
  );
}

const TIMELINE_RANGES = { month: 30, threeMonths: 90, year: 365, selected: 0 } as const;
type TimelineRange = keyof typeof TIMELINE_RANGES;

function ReviewTimeline({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const [range, setRange] = useState<TimelineRange>("month");
  const { end, deckId } = scope;
  const start = range === "selected" ? scope.start : addDays(end, 1 - TIMELINE_RANGES[range]);
  const timeline = useStatistic("statistics.timeline", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const items = timeline.data?.items ?? [];
  const label = timeline.data?.granularity === "month" ? monthName : shortDate;
  const bars = items.map((item) => ({ label: label(item.date, locale), value: item.reviews }));
  const title = t("widgets.review-timeline.title");
  const option = barOption({
    bars,
    theme,
    format: number,
    labelInterval: Math.floor(bars.length / 8),
    average: {
      label: t("widgets.review-timeline.average"),
      values: items.map((item) => Math.round(item.runningAverage)),
    },
  });
  return (
    <WidgetCard title={title} note={t("widgets.review-timeline.note")}>
      <div className="flex h-full flex-col gap-2">
        <ChipGroup
          label={t("widgets.review-timeline.range")}
          options={Object.keys(TIMELINE_RANGES) as TimelineRange[]}
          value={range}
          onChange={setRange}
          nameOf={(key) => t(`widgets.review-timeline.ranges.${key}`)}
        />
        <div className="min-h-0 flex-1">
          <WidgetState status={timeline} empty={items.every((item) => item.reviews === 0)}>
            <Chart option={option} label={title} />
          </WidgetState>
        </div>
      </div>
    </WidgetCard>
  );
}

function AnswerButtons({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const buttons = useStatistic("statistics.answerButtons", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const data = buttons.data;
  const keys = ["again", "hard", "good", "easy"] as const;
  const bars = data ? keys.map((key) => ({ label: t(`answers.${key}`), value: data[key] })) : [];
  const title = t("widgets.answer-buttons.title");
  return (
    <WidgetCard title={title} note={t("widgets.answer-buttons.note")}>
      <WidgetState status={buttons} empty={bars.every((bar) => bar.value === 0)}>
        <Chart option={barOption({ bars, theme, format: number })} label={title} />
      </WidgetState>
    </WidgetCard>
  );
}

function DueForecast({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const forecast = useStatistic("statistics.forecast", { deckId: scope.deckId });
  const theme = useChartTheme(scope.themeKey);
  const bars = (forecast.data ?? []).map((day) => ({
    label: shortDate(day.date, locale),
    value: day.cards,
  }));
  const title = t("widgets.due-forecast.title");
  return (
    <WidgetCard title={title} note={t("widgets.due-forecast.note")}>
      <WidgetState status={forecast} empty={bars.every((bar) => bar.value === 0)}>
        <Chart option={barOption({ bars, theme, format: number })} label={title} />
      </WidgetState>
    </WidgetCard>
  );
}

function CardStates({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const states = useStatistic("statistics.cardStates", { deckId: scope.deckId });
  const theme = useChartTheme(scope.themeKey);
  const data = states.data;
  const keys = ["new", "learning", "review", "suspended", "buried", "other"] as const;
  const bars = data
    ? keys
        .map((key) => ({ label: t(`states.${key}`), value: data[key] }))
        .filter((bar) => bar.value > 0)
    : [];
  const title = t("widgets.card-states.title");
  return (
    <WidgetCard title={title} note={t("widgets.card-states.note")}>
      <WidgetState status={states} empty={bars.length === 0}>
        <Chart
          option={barOption({ bars, theme, horizontal: true, format: number })}
          label={title}
        />
      </WidgetState>
    </WidgetCard>
  );
}

function StudyRhythm({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const { start, end, deckId } = scope;
  const rhythm = useStatistic("statistics.rhythm", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const weekdays = (rhythm.data?.weekdays ?? []).map((value, index) => ({
    label: weekdayName(index, locale),
    value,
  }));
  const hours = (rhythm.data?.hours ?? []).map((value, hour) => ({
    label: String(hour),
    value,
  }));
  const title = t("widgets.study-rhythm.title");
  return (
    <WidgetCard title={title} note={t("widgets.study-rhythm.note")}>
      <WidgetState status={rhythm} empty={weekdays.every((bar) => bar.value === 0)}>
        <div className="grid h-full grid-cols-[2fr_3fr] gap-4">
          <Chart
            option={barOption({ bars: weekdays, theme, format: number })}
            label={t("widgets.study-rhythm.weekdays")}
          />
          <Chart
            option={barOption({ bars: hours, theme, format: number, labelInterval: 2 })}
            label={t("widgets.study-rhythm.hours")}
          />
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

function ReviewHeatmap({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const [year, setYear] = useState<number | null>(null);
  const heatmap = useStatistic("statistics.heatmap", { year, deckId: scope.deckId });
  const theme = useChartTheme(scope.themeKey);
  const data = heatmap.data;
  const shownYear = data?.year ?? new Date().getFullYear();
  const option = heatmapOption({
    year: shownYear,
    days: data?.days ?? [],
    theme,
    locale,
    format: (date, reviews) =>
      t("widgets.review-heatmap.tooltip", {
        date: fullDate(date, locale),
        count: reviews,
        reviews: number(reviews),
      }),
  });
  const stats = data
    ? t("widgets.review-heatmap.summary", {
        current: number(data.currentStreak),
        longest: number(data.longestStreak),
        average: number(Math.round(data.dailyAverage)),
      })
    : undefined;
  const actions = data ? (
    <div className="flex items-center gap-1">
      <Button
        aria-label={t("widgets.review-heatmap.previous")}
        className="h-7 px-1"
        disabled={shownYear <= data.firstYear}
        onClick={() => setYear(shownYear - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      <span className="text-xs font-semibold text-text">{shownYear}</span>
      <Button
        aria-label={t("widgets.review-heatmap.next")}
        className="h-7 px-1"
        disabled={shownYear >= data.lastYear}
        onClick={() => setYear(shownYear + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  ) : null;
  return (
    <WidgetCard title={t("widgets.review-heatmap.title")} note={stats} actions={actions}>
      <WidgetState status={heatmap} empty={false}>
        <Chart option={option} label={t("widgets.review-heatmap.title")} />
      </WidgetState>
    </WidgetCard>
  );
}

export const widgetComponents: Record<WidgetType, (props: WidgetProps) => ReactNode> = {
  "review-summary": ReviewSummary,
  "study-time": StudyTime,
  "success-rate": SuccessRate,
  "due-cards": DueCards,
  "review-breakdown": ReviewBreakdown,
  "deck-activity": DeckActivity,
  "review-timeline": ReviewTimeline,
  "answer-buttons": AnswerButtons,
  "due-forecast": DueForecast,
  "card-states": CardStates,
  "study-rhythm": StudyRhythm,
  "review-heatmap": ReviewHeatmap,
  ...ankiWidgets,
};
