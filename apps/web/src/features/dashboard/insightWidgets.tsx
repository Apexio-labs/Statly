import { type ChartTheme, trendOption } from "@statly/charts";
import type { Result } from "@statly/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import {
  CalendarHeatmap,
  type HeatDay,
  type HeatScale,
} from "../../components/CalendarHeatmap.tsx";
import { richTip, type Tip } from "../../components/tip.ts";
import { useStatistic } from "../../lib/calls.ts";
import { addDays, durationParts, fullDate, shortDate, weekdayName } from "../../lib/format.ts";
import { Chart } from "./Chart.tsx";
import { WidgetCard, WidgetState } from "./WidgetCard.tsx";
import { useChartTheme, useFormatters, type WidgetProps } from "./widgetParts.tsx";

/*
 * Closer looks at the dashboard's range: an overview with a calendar in six views, the range
 * against the one before, answers and their pace, study times, decks, forgotten cards and notes.
 * Every widget here follows the range and deck chosen above the dashboard.
 */

// ── Shared parts ─────────────────────────────────────────────────────────────────────────────

/** The element's size, also when it appears only after loading. */
function useSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) {
      return;
    }
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}

function daysBetween(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 864e5) + 1
  );
}

function usePercent() {
  const { locale } = useFormatters();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
    return (value: number | null | undefined) =>
      value === null || value === undefined ? "–" : format.format(value);
  }, [locale]);
}

function useDecimal(digits = 1) {
  const { locale } = useFormatters();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
    return (value: number) => format.format(value);
  }, [locale, digits]);
}

/** Durations the way the rest of Statly writes them. */
function useDuration() {
  const { t } = useFormatters();
  return (milliseconds: number) => {
    const parts = durationParts(milliseconds);
    return parts.hours > 0
      ? t("time.hoursMinutes", parts)
      : parts.minutes > 0
        ? t("time.minutes", parts)
        : t("time.seconds", parts);
  };
}

/** Short enough for a narrow column: 38 h, 12 min. */
function compactDuration(milliseconds: number, decimal: (value: number) => string): string {
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) {
    return `${Math.round(hours)} h`;
  }
  if (hours >= 1) {
    return `${decimal(Math.round(hours * 10) / 10)} h`;
  }
  return `${Math.round(milliseconds / 60_000)} min`;
}

/** From red over yellow to green, `good` may lie below `bad` as for seconds per card. */
function judged(value: number, bad: number, good: number): string {
  const share = Math.max(0, Math.min(1, (value - bad) / (good - bad)));
  if (share < 0.5) {
    return `color-mix(in oklab, var(--statly-warning) ${Math.round(share * 200)}%, var(--statly-danger))`;
  }
  return `color-mix(in oklab, var(--statly-success) ${Math.round((share - 0.5) * 200)}%, var(--statly-warning))`;
}

const FOCUS_BAD = 0.5;
const FOCUS_GOOD = 0.95;
const RETENTION_BAD = 0.75;
const RETENTION_GOOD = 0.95;
const SECONDS_BAD = 15;
const SECONDS_GOOD = 3;

const BUTTON_COLORS = {
  again: "var(--statly-danger)",
  hard: "var(--statly-warning)",
  good: "var(--statly-success)",
  easy: "var(--statly-series-6)",
} as const;

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  nameOf,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  nameOf: (value: T) => string;
}) {
  return (
    <fieldset className="statly-segmented m-0 flex min-w-0 flex-wrap gap-0.5 rounded-full border border-line bg-hover/60 p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className="cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-1 text-[10.5px] font-bold tracking-wide text-muted uppercase hover:text-text aria-pressed:bg-accent aria-pressed:text-on-primary"
        >
          {nameOf(option)}
        </button>
      ))}
    </fieldset>
  );
}

/** A big number with its caption below, as in a dashboard's header. */
function Stat({
  label,
  value,
  unit,
  color,
  tip,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  tip?: Tip;
}) {
  return (
    <div
      className="flex min-w-0 flex-col items-center px-2.5"
      data-tooltip={tip ? richTip(tip) : undefined}
    >
      <span
        className="statly-stat-value text-[clamp(18px,2.6cqw,30px)] leading-none font-semibold tracking-tight tabular-nums"
        style={{ color: color ?? "var(--statly-text)" }}
      >
        {value}
        {unit ? <span className="ml-px text-[0.5em] font-semibold">{unit}</span> : null}
      </span>
      <span className="mt-1.5 text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="h-7 w-px self-center bg-line" />;
}

// ── Study overview ───────────────────────────────────────────────────────────────────────────

const OVERVIEW_MODES = ["reviews", "ratings", "retention", "speed", "time", "new"] as const;
type OverviewMode = (typeof OVERVIEW_MODES)[number];
type Day = Result<"statistics.daily">["days"][number];
const CALENDAR_WEEKS = 53;
const AHEAD_DAYS = 27;
const TREND_PAST_DAYS = 30;
const TREND_AHEAD_DAYS = 30;

export function heatValue(mode: OverviewMode, day: Day): number | null {
  switch (mode) {
    case "reviews":
      return day.reviews;
    case "ratings":
      return day.ratings;
    case "retention":
      return day.checked > 0 ? day.passed / day.checked : null;
    case "speed":
      return day.ratings > 0 ? day.timeMs / day.ratings / 1000 : null;
    case "time":
      return day.timeMs > 0 ? day.timeMs / 60_000 : null;
    default:
      return day.newCards;
  }
}

export function heatScale(mode: OverviewMode): HeatScale {
  switch (mode) {
    case "retention":
      return { kind: "judged", bad: RETENTION_BAD, good: RETENTION_GOOD };
    case "speed":
      return { kind: "judged", bad: SECONDS_BAD, good: SECONDS_GOOD };
    case "ratings":
      return { kind: "amount", color: "var(--statly-series-3)" };
    case "time":
      return { kind: "amount", color: "var(--statly-series-4)" };
    case "new":
      return { kind: "amount", color: "var(--statly-series-7)" };
    default:
      return { kind: "amount" };
  }
}

function sum(days: readonly Day[], key: keyof Omit<Day, "date">): number {
  return days.reduce((total, day) => total + day[key], 0);
}

function StudyOverview({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const percent = usePercent();
  const decimal = useDecimal();
  const duration = useDuration();
  const theme = useChartTheme(scope.themeKey);
  const [mode, setMode] = useState<OverviewMode>("reviews");
  const [body, size] = useSize<HTMLDivElement>();
  const { deckId } = scope;
  const today = useStatistic("statistics.today", {});
  const todayDate = today.data?.date ?? scope.end;
  const calendarStart = addDays(todayDate, -7 * CALENDAR_WEEKS);
  const year = useStatistic(
    "statistics.daily",
    { start: calendarStart, end: todayDate, deckId },
    today.data !== undefined,
  );
  const range = useStatistic("statistics.daily", { start: scope.start, end: scope.end, deckId });
  const forecast = useStatistic("statistics.forecast", { deckId, days: TREND_AHEAD_DAYS + 1 });
  const due = useStatistic("statistics.due", { deckId });
  const streaks = useStatistic("statistics.heatmap", { year: null, deckId });

  const rangeDays = range.data?.days ?? [];
  const reviews = sum(rangeDays, "reviews");
  const ratings = sum(rangeDays, "ratings");
  const timeMs = sum(rangeDays, "timeMs");
  const checked = sum(rangeDays, "checked");
  const seconds = ratings > 0 ? timeMs / ratings / 1000 : null;
  const retention = checked > 0 ? sum(rangeDays, "passed") / checked : null;
  const average = rangeDays.length > 0 ? reviews / rangeDays.length : 0;
  const time = durationParts(timeMs);

  const calendar = useMemo(() => {
    const days = new Map<string, HeatDay>();
    for (const day of year.data?.days ?? []) {
      days.set(day.date, { value: heatValue(mode, day) });
    }
    const counts = mode === "reviews" || mode === "ratings";
    for (const entry of forecast.data ?? []) {
      if (entry.date > todayDate) {
        days.set(entry.date, { value: counts ? entry.cards : null, ahead: true });
      }
    }
    for (let offset = 1; offset <= AHEAD_DAYS; offset += 1) {
      const date = addDays(todayDate, offset);
      if (!days.has(date)) {
        days.set(date, { value: null, ahead: true });
      }
    }
    return days;
  }, [year.data, forecast.data, mode, todayDate]);
  const byDate = useMemo(
    () => new Map((year.data?.days ?? []).map((day) => [day.date, day])),
    [year.data],
  );

  const dayTip = (date: string, entry: HeatDay | undefined): Tip => {
    const title = fullDate(date, locale);
    if (entry?.ahead) {
      const cards = forecast.data?.find((item) => item.date === date)?.cards;
      return cards === undefined
        ? { title }
        : { title, rows: [{ label: t("widgets.study-overview.tip.ahead"), value: number(cards) }] };
    }
    const day = byDate.get(date);
    if (!day || day.ratings === 0) {
      return { title, lines: [t("widgets.study-overview.noAnswers")] };
    }
    const show = (key: OverviewMode, label: string, value: string) => ({
      label,
      value,
      ...(key === mode ? { color: "var(--statly-accent)" } : {}),
    });
    return {
      title,
      rows: [
        show("reviews", t("widgets.study-overview.tip.reviews"), number(day.reviews)),
        show("ratings", t("widgets.study-overview.tip.ratings"), number(day.ratings)),
        show("time", t("widgets.study-overview.tip.time"), duration(day.timeMs)),
        show(
          "speed",
          t("widgets.study-overview.tip.speed"),
          t("widgets.study-overview.secondsPerCard", {
            seconds: decimal(day.timeMs / day.ratings / 1000),
          }),
        ),
        show(
          "retention",
          t("widgets.study-overview.tip.retention"),
          percent(day.checked > 0 ? day.passed / day.checked : null),
        ),
        show("new", t("widgets.study-overview.tip.new"), number(day.newCards)),
      ],
      ...(scope.pickRange ? { lines: [t("widgets.study-overview.tip.pick")] } : {}),
    };
  };

  const showTrend = size.height >= 300;
  const trend = useMemo(
    () =>
      overviewTrend({
        past: rangeDays.length >= 7 ? rangeDays : (year.data?.days ?? []).slice(-TREND_PAST_DAYS),
        ahead: (forecast.data ?? []).filter((day) => day.date > todayDate),
        theme,
        locale,
        t,
        number,
        decimal,
        percent,
      }),
    [rangeDays, year.data, forecast.data, todayDate, theme, locale, t, number, decimal, percent],
  );

  const status = {
    isPending: range.isPending || year.isPending,
    error: range.error ?? year.error ?? null,
  };
  return (
    <WidgetCard title={t("widgets.study-overview.title")}>
      <WidgetState status={status} empty={false}>
        <div ref={body} className="flex h-full min-h-0 flex-col gap-3 [container-type:inline-size]">
          <div className="flex flex-wrap items-start justify-between gap-y-2">
            <div className="flex flex-wrap items-start">
              <Stat
                label={t("widgets.study-overview.due")}
                value={due.data ? number(due.data.cards) : "–"}
                color="var(--statly-accent)"
                tip={{ title: t("widgets.study-overview.dueNote") }}
              />
              <Divider />
              <Stat
                label={t("widgets.study-overview.done")}
                value={number(reviews)}
                color={reviews > 0 ? "var(--statly-series-2)" : "var(--statly-muted)"}
                tip={{
                  title: t("widgets.study-overview.doneNote"),
                  rows: [
                    { label: t("widgets.study-overview.tip.ratings"), value: number(ratings) },
                  ],
                }}
              />
              <Divider />
              <Stat
                label={t("widgets.study-overview.speed")}
                value={seconds === null ? "–" : decimal(seconds)}
                unit={seconds === null ? "" : t("widgets.study-overview.secondsUnit")}
                {...(seconds === null ? {} : { color: judged(seconds, SECONDS_BAD, SECONDS_GOOD) })}
              />
              <Divider />
              <Stat
                label={t("widgets.study-overview.time")}
                value={time.hours > 0 ? String(time.hours) : String(time.minutes)}
                unit={
                  time.hours > 0
                    ? t("widgets.study-overview.hoursUnit")
                    : t("widgets.study-overview.minutesUnit")
                }
                tip={{ title: duration(timeMs) }}
              />
              <Divider />
              <Stat
                label={t("widgets.study-overview.retention")}
                value={retention === null ? "–" : decimal(retention * 100)}
                unit={retention === null ? "" : "%"}
                {...(retention === null
                  ? {}
                  : { color: judged(retention, RETENTION_BAD, RETENTION_GOOD) })}
              />
            </div>
            <div className="flex items-start">
              <Stat
                label={t("widgets.study-overview.average")}
                value={number(Math.round(average))}
              />
              <Divider />
              <Stat
                label={t("widgets.study-overview.streak")}
                value={streaks.data ? number(streaks.data.currentStreak) : "–"}
              />
            </div>
          </div>
          <Segmented
            label={t("widgets.study-overview.mode")}
            options={OVERVIEW_MODES}
            value={mode}
            onChange={setMode}
            nameOf={(key) => t(`widgets.study-overview.modes.${key}`)}
          />
          <div className="min-h-[96px] flex-1">
            <CalendarHeatmap
              end={addDays(todayDate, AHEAD_DAYS)}
              today={todayDate}
              days={calendar}
              scale={heatScale(mode)}
              locale={locale}
              label={t(`widgets.study-overview.modes.${mode}`)}
              tip={dayTip}
              highlight={{ start: scope.start, end: scope.end }}
              onPick={
                scope.pickRange
                  ? (date) => scope.pickRange?.({ start: date, end: date })
                  : undefined
              }
            />
          </div>
          {showTrend ? (
            <div className="h-[32%] min-h-[96px]">
              <Chart option={trend} label={t("widgets.study-overview.title")} />
            </div>
          ) : null}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

function overviewTrend({
  past,
  ahead,
  theme,
  locale,
  t,
  number,
  decimal,
  percent,
}: {
  past: readonly Day[];
  ahead: readonly { date: string; cards: number }[];
  theme: ChartTheme;
  locale: string;
  t: ReturnType<typeof useFormatters>["t"];
  number: (value: number) => string;
  decimal: (value: number) => string;
  percent: (value: number | null) => string;
}) {
  const todayIndex = Math.max(0, past.length - 1);
  const titles = [...past.map((day) => day.date), ...ahead.map((day) => day.date)].map((date) =>
    shortDate(date, locale),
  );
  const blanks = (count: number) => Array.from({ length: count }, () => null);
  const last = past.at(-1)?.reviews ?? null;
  const lastIndex = titles.length - 1;
  return trendOption({
    titles,
    theme,
    todayIndex,
    marks: {
      0: t("widgets.study-overview.past", { count: past.length - 1 }),
      [todayIndex]: t("widgets.study-overview.today"),
      ...(ahead.length > 0
        ? { [lastIndex]: t("widgets.study-overview.ahead", { count: ahead.length }) }
        : {}),
    },
    lines: [
      {
        name: t("widgets.study-overview.legend.reviews"),
        color: theme.accent,
        values: [...past.map((day) => day.reviews), ...blanks(ahead.length)],
        format: number,
      },
      {
        name: t("widgets.study-overview.legend.forecast"),
        color: theme.muted,
        dashed: true,
        values: [...blanks(past.length - 1), last, ...ahead.map((day) => day.cards)],
        format: number,
      },
      {
        name: t("widgets.study-overview.legend.speed"),
        color: theme.series[4] ?? theme.accent,
        values: [
          ...past.map((day) => (day.ratings > 0 ? day.timeMs / day.ratings / 1000 : null)),
          ...blanks(ahead.length),
        ],
        format: (value) => t("widgets.study-overview.secondsPerCard", { seconds: decimal(value) }),
        floating: true,
      },
      {
        name: t("widgets.study-overview.legend.retention"),
        color: theme.series[3] ?? theme.accent,
        values: [
          ...past.map((day) => (day.checked > 0 ? day.passed / day.checked : null)),
          ...blanks(ahead.length),
        ],
        format: (value) => percent(value),
        floating: true,
      },
    ],
  });
}

// ── The range at a glance ────────────────────────────────────────────────────────────────────

function PeriodSummary({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const percent = usePercent();
  const duration = useDuration();
  const { start, end, deckId } = scope;
  const length = daysBetween(start, end);
  const before = { start: addDays(start, -length), end: addDays(start, -1), deckId };
  const current = useStatistic("statistics.summary", { start, end, deckId });
  const previous = useStatistic("statistics.summary", before, before.start >= "2006-01-01");
  const speed = useStatistic("statistics.speed", { start, end, deckId });
  const now = current.data;
  const then = previous.data;
  const focusNow = speed.data?.current.focus ?? null;
  const focusThen = speed.data?.previous?.focus ?? null;
  const beforeText = (value: string | null) =>
    value === null
      ? t("widgets.period-summary.noBefore")
      : t("widgets.period-summary.before", { value });

  const tiles: { key: string; value: string; before: string; color?: string; tip?: Tip }[] = now
    ? [
        {
          key: "cards",
          value: number(now.reviews),
          before: beforeText(then ? number(then.reviews) : null),
        },
        {
          key: "time",
          value: duration(now.studyTimeMs),
          before: beforeText(then ? duration(then.studyTimeMs) : null),
        },
        {
          key: "retention",
          value: percent(now.retention),
          before: beforeText(then?.retention == null ? null : percent(then.retention)),
          ...(now.retention === null
            ? {}
            : { color: judged(now.retention, RETENTION_BAD, RETENTION_GOOD) }),
        },
        {
          key: "focus",
          value: percent(focusNow),
          before: beforeText(focusThen === null ? null : percent(focusThen)),
          ...(focusNow === null ? {} : { color: judged(focusNow, FOCUS_BAD, FOCUS_GOOD) }),
          tip: { title: t("widgets.period-summary.focusNote") },
        },
        {
          key: "new",
          value: number(now.newCards),
          before: beforeText(then ? number(then.newCards) : null),
        },
      ]
    : [];
  return (
    <WidgetCard title={t("widgets.period-summary.title")}>
      <WidgetState status={current} empty={false}>
        <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(96px,1fr))] content-center gap-x-1 gap-y-3 [container-type:inline-size]">
          {tiles.map((tile, index) => (
            <div
              key={tile.key}
              className={`flex min-w-0 flex-col justify-center px-3 ${index > 0 ? "border-l border-line" : ""}`}
              data-tooltip={tile.tip ? richTip(tile.tip) : undefined}
            >
              <span className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                {t(`widgets.period-summary.${tile.key}`)}
              </span>
              <span
                className="statly-stat-value mt-1 truncate text-[clamp(17px,3.2cqw,26px)] leading-tight font-semibold tabular-nums"
                style={{ color: tile.color ?? "var(--statly-text)" }}
              >
                {tile.value}
              </span>
              <span className="mt-0.5 truncate text-[11.5px] text-muted">{tile.before}</span>
            </div>
          ))}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Answers ──────────────────────────────────────────────────────────────────────────────────

function AnswerMix({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const percent = usePercent();
  const { start, end, deckId } = scope;
  const mix = useStatistic("statistics.answerMix", { start, end, deckId });
  const data = mix.data;
  const buttons = (["again", "hard", "good", "easy"] as const).map((key) => ({
    key,
    value: data?.[key] ?? 0,
  }));
  const total = buttons.reduce((all, button) => all + button.value, 0);
  const kinds = (["review", "learning", "new", "relearning"] as const).map((key) => ({
    key,
    value: data?.[key] ?? 0,
  }));
  return (
    <WidgetCard title={t("widgets.answer-mix.title")}>
      <WidgetState status={mix} empty={total === 0}>
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
          <div className="flex h-3.5 w-full shrink-0 overflow-hidden rounded-full bg-hover">
            {buttons.map((button) =>
              button.value > 0 ? (
                <span
                  key={button.key}
                  className="h-full"
                  style={{
                    width: `${(button.value / total) * 100}%`,
                    background: BUTTON_COLORS[button.key],
                  }}
                  data-tooltip={richTip({
                    title: t(`answers.${button.key}`),
                    rows: [{ label: number(button.value), value: percent(button.value / total) }],
                  })}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text">
            {buttons.map((button) => (
              <span key={button.key} className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block size-2.5 rounded-[3px]"
                  style={{ background: BUTTON_COLORS[button.key] }}
                />
                {t(`answers.${button.key}`)}{" "}
                <span className="font-semibold tabular-nums">{number(button.value)}</span>
              </span>
            ))}
          </div>
          <dl className="m-0 mt-1 grid gap-2 border-t border-line pt-3 text-[12.5px]">
            {kinds.map((kind) => (
              <div
                key={kind.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
                data-tooltip={richTip({
                  title: t(`widgets.answer-mix.kinds.${kind.key}`),
                  lines: [t("widgets.answer-mix.share", { share: percent(kind.value / total) })],
                })}
              >
                <dt className="text-muted">{t(`widgets.answer-mix.kinds.${kind.key}`)}</dt>
                <dd className="m-0 font-semibold text-text tabular-nums">{number(kind.value)}</dd>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-hover">
                  <span
                    className="block h-full rounded-full bg-accent/70"
                    style={{ width: `${total ? (kind.value / total) * 100 : 0}%` }}
                  />
                </span>
              </div>
            ))}
          </dl>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Answer pace ──────────────────────────────────────────────────────────────────────────────

const Z_FROM = -2.5;
const Z_TO = 4.5;
const SPEED_TICKS = [-2, -1, 0, 1, 2, 3, 4];

function zColor(z: number): string {
  // Faster than usual is fine, slower turns yellow and then red.
  return judged(-z, -2.5, 0.2);
}

function AnswerSpeed({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const percent = usePercent();
  const decimal = useDecimal();
  const [frame, size] = useSize<HTMLDivElement>();
  const { start, end, deckId } = scope;
  const speed = useStatistic("statistics.speed", { start, end, deckId });
  const data = speed.data;
  const current = data?.current;
  const width = size.width;
  const height = Math.max(60, size.height - 34);
  const x = (z: number) =>
    14 + ((Math.max(Z_FROM, Math.min(Z_TO, z)) - Z_FROM) / (Z_TO - Z_FROM)) * (width - 28);
  const middle = height * 0.58;
  const axis = height - 14;
  const highest = Math.max(1, ...(current?.histogram ?? [0]));
  const band = Math.min(28, middle - 20);

  const box = (quantiles: number[] | null | undefined, y: number, tall: number, faint: boolean) => {
    if (!quantiles) {
      return null;
    }
    const [p5 = 0, p25 = 0, p50 = 0, p75 = 0, p95 = 0] = quantiles;
    const stroke = faint ? "var(--statly-muted)" : "var(--statly-text)";
    const opacity = faint ? 0.5 : 1;
    return (
      <g
        opacity={opacity}
        data-tooltip={richTip({
          title: faint ? t("widgets.answer-speed.faint") : t("widgets.answer-speed.box"),
          rows: [
            {
              label: "25 %",
              value: t("widgets.answer-speed.spread", { value: signed(p25, decimal) }),
            },
            {
              label: "50 %",
              value: t("widgets.answer-speed.spread", { value: signed(p50, decimal) }),
            },
            {
              label: "75 %",
              value: t("widgets.answer-speed.spread", { value: signed(p75, decimal) }),
            },
          ],
          lines: [t("widgets.answer-speed.whiskers")],
        })}
      >
        <line x1={x(p5)} x2={x(p25)} y1={y} y2={y} stroke={stroke} strokeWidth={1.5} />
        <line x1={x(p75)} x2={x(p95)} y1={y} y2={y} stroke={stroke} strokeWidth={1.5} />
        <line
          x1={x(p5)}
          x2={x(p5)}
          y1={y - tall / 4}
          y2={y + tall / 4}
          stroke={stroke}
          strokeWidth={1.5}
        />
        <line
          x1={x(p95)}
          x2={x(p95)}
          y1={y - tall / 4}
          y2={y + tall / 4}
          stroke={stroke}
          strokeWidth={1.5}
        />
        <rect
          x={x(p25)}
          y={y - tall / 2}
          width={Math.max(2, x(p75) - x(p25))}
          height={tall}
          rx={tall / 3}
          fill={faint ? "transparent" : "rgb(255 255 255 / 6%)"}
          stroke={stroke}
          strokeWidth={faint ? 1.2 : 2}
        />
        <line
          x1={x(p50)}
          x2={x(p50)}
          y1={y - tall / 2 - 3}
          y2={y + tall / 2 + 3}
          stroke={stroke}
          strokeWidth={faint ? 1.5 : 3}
        />
      </g>
    );
  };

  return (
    <WidgetCard
      title={t("widgets.answer-speed.title")}
      actions={
        current?.medianMs != null ? (
          <span className="text-[12px] text-muted tabular-nums">
            {t("widgets.answer-speed.median", { seconds: decimal(current.medianMs / 1000) })}
            {" · "}
            <span
              style={
                current.focus === null
                  ? undefined
                  : { color: judged(current.focus, FOCUS_BAD, FOCUS_GOOD) }
              }
            >
              {t("widgets.answer-speed.focus", { share: percent(current.focus) })}
            </span>
          </span>
        ) : null
      }
    >
      <WidgetState status={speed} empty={(current?.answers ?? 0) === 0}>
        <div ref={frame} className="flex h-full min-h-0 flex-col">
          {data && current && width > 0 ? (
            <>
              <svg
                width={width}
                height={height}
                role="img"
                aria-label={t("widgets.answer-speed.title")}
              >
                {SPEED_TICKS.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={x(tick)}
                      x2={x(tick)}
                      y1={10}
                      y2={axis}
                      stroke="var(--statly-border)"
                      strokeWidth={1}
                    />
                    <text
                      x={x(tick)}
                      y={height - 2}
                      textAnchor="middle"
                      className="statly-heat-label"
                    >
                      {tick === 0 ? t("widgets.answer-speed.usual") : signed(tick, decimal)}
                    </text>
                  </g>
                ))}
                <line
                  x1={x(data.slowAt)}
                  x2={x(data.slowAt)}
                  y1={6}
                  y2={axis}
                  stroke="var(--statly-muted)"
                  strokeDasharray="4 4"
                  strokeWidth={1.2}
                />
                {current.histogram.map((count, index) => {
                  const z = data.zLow + (index + 0.5) * data.zStep;
                  if (count === 0 || z < Z_FROM || z > Z_TO) {
                    return null;
                  }
                  const half = Math.max(1.5, (count / highest) * band);
                  const left = x(data.zLow + index * data.zStep);
                  return (
                    <rect
                      // biome-ignore lint/suspicious/noArrayIndexKey: one bar per step of the scale.
                      key={index}
                      x={left}
                      y={middle - half}
                      width={Math.max(1, x(data.zLow + (index + 1) * data.zStep) - left - 1)}
                      height={half * 2}
                      rx={2}
                      fill={zColor(z)}
                      opacity={0.78}
                      data-tooltip={richTip({
                        title: t("widgets.answer-speed.spread", { value: signed(z, decimal) }),
                        rows: [
                          {
                            label: t("widgets.answer-speed.answers", { count }),
                            value: number(count),
                          },
                        ],
                      })}
                    />
                  );
                })}
                {box(data.previous?.quantiles, Math.max(10, middle - band - 12), 10, true)}
                {box(current.quantiles, middle, Math.min(22, band), false)}
              </svg>
              <div className="flex justify-between gap-3 text-[11px] text-muted">
                <span>{t("widgets.answer-speed.faint")}</span>
                <span>{t("widgets.answer-speed.slow")}</span>
              </div>
            </>
          ) : null}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

function signed(value: number, decimal: (value: number) => string): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${decimal(rounded)}` : rounded < 0 ? `−${decimal(-rounded)}` : "0";
}

// ── Study times ──────────────────────────────────────────────────────────────────────────────

const LANE_DAYS = 14;

function focusColor(focus: number | null): string {
  return focus === null ? "var(--statly-muted)" : judged(focus, FOCUS_BAD, FOCUS_GOOD);
}

function StudySessions({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const percent = usePercent();
  const duration = useDuration();
  const [frame, size] = useSize<HTMLDivElement>();
  const { start, end, deckId } = scope;
  const sessions = useStatistic("statistics.sessions", { start, end, deckId });
  const data = sessions.data;
  const lanes = daysBetween(start, end) <= LANE_DAYS;
  const width = size.width;
  const height = Math.max(40, size.height - 22);
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const hourName = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" });
  const startHour = data?.dayStartHour ?? 4;
  const time = (seconds: number) => clock.format(new Date((startHour * 3600 + seconds) * 1000));
  const labelWidth = lanes && (data?.days.length ?? 0) > 1 ? 54 : 6;
  const plot = Math.max(1, width - labelWidth - 8);
  const x = (seconds: number) => labelWidth + (seconds / 86_400) * plot;
  const ticks = [0, 4, 8, 12, 16, 20, 24];
  const axisY = height - 14;

  const body = (): ReactNode => {
    if (!data || width === 0) {
      return null;
    }
    if (!lanes) {
      const ordered = Array.from({ length: 24 }, (_, index) => (startHour + index) % 24);
      const highest = Math.max(1, ...data.hours.map((hour) => hour.ratings));
      const step = plot / 24;
      return ordered.map((hour, index) => {
        const entry = data.hours[hour] ?? { ratings: 0, focus: null };
        const tall = (entry.ratings / highest) * (axisY - 8);
        return entry.ratings > 0 ? (
          <rect
            key={hour}
            x={labelWidth + index * step + 1}
            y={axisY - tall}
            width={Math.max(2, step - 3)}
            height={tall}
            rx={3}
            fill={focusColor(entry.focus)}
            opacity={0.85}
            data-tooltip={richTip({
              title: t("widgets.study-sessions.hour", { hour, next: (hour + 1) % 24 }),
              rows: [
                { label: t("widgets.study-overview.tip.ratings"), value: number(entry.ratings) },
              ],
              lines:
                entry.focus === null
                  ? []
                  : [t("widgets.study-sessions.focusShare", { share: percent(entry.focus) })],
            })}
          />
        ) : null;
      });
    }
    const laneHeight = (axisY - 6) / Math.max(1, data.days.length);
    return data.days.map((day, lane) => {
      const middle = 4 + lane * laneHeight + laneHeight / 2;
      return (
        <g key={day.date}>
          {data.days.length > 1 ? (
            <text x={0} y={middle + 3.5} className="statly-heat-label">
              {`${weekdayName((new Date(`${day.date}T12:00:00Z`).getUTCDay() + 6) % 7, locale)} ${Number(day.date.slice(8))}.`}
            </text>
          ) : null}
          <line
            x1={labelWidth}
            x2={labelWidth + plot}
            y1={middle}
            y2={middle}
            stroke="var(--statly-border)"
          />
          {day.sessions.map((session) => {
            const tall = Math.min(laneHeight - 4, 7 + Math.sqrt(session.ratings) * 1.1);
            const left = x(session.start);
            return (
              <rect
                key={session.start}
                x={left}
                y={middle - tall / 2}
                width={Math.max(4, Math.min(x(session.end), labelWidth + plot) - left)}
                height={tall}
                rx={Math.min(5, tall / 3)}
                fill={focusColor(session.focus)}
                opacity={0.88}
                data-tooltip={richTip({
                  title: t("widgets.study-sessions.session", {
                    start: time(session.start),
                    end: time(session.end),
                  }),
                  rows: [
                    {
                      label: t("widgets.study-sessions.cards", {
                        count: session.ratings,
                        time: duration(session.timeMs),
                      }),
                    },
                  ],
                  lines: [
                    ...(session.focus === null
                      ? []
                      : [
                          t("widgets.study-sessions.focusShare", { share: percent(session.focus) }),
                        ]),
                    ...(session.retention === null
                      ? []
                      : [
                          t("widgets.study-sessions.retentionShare", {
                            share: percent(session.retention),
                          }),
                        ]),
                    fullDate(day.date, locale),
                  ],
                })}
              />
            );
          })}
        </g>
      );
    });
  };

  return (
    <WidgetCard
      title={t("widgets.study-sessions.title")}
      note={lanes ? undefined : t("widgets.study-sessions.hours")}
    >
      <WidgetState
        status={sessions}
        empty={(data?.hours ?? []).every((hour) => hour.ratings === 0)}
      >
        <div ref={frame} className="flex h-full min-h-0 flex-col">
          {width > 0 ? (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={t("widgets.study-sessions.title")}
            >
              {body()}
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={x(tick * 3600)}
                    x2={x(tick * 3600)}
                    y1={axisY - 3}
                    y2={axisY + 2}
                    stroke="var(--statly-border)"
                  />
                  <text
                    x={x(tick * 3600)}
                    y={height - 1}
                    textAnchor={tick === 0 ? "start" : tick === 24 ? "end" : "middle"}
                    className="statly-heat-label"
                  >
                    {hourName.format(new Date(((startHour + tick) % 24) * 3_600_000))}
                  </text>
                </g>
              ))}
            </svg>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
            {t("widgets.study-sessions.focus")}: {t("widgets.study-sessions.low")}
            <span
              className="inline-block h-2 w-16 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--statly-danger), var(--statly-warning), var(--statly-success))",
              }}
            />
            {t("widgets.study-sessions.high")}
            <span className="ml-2 inline-block size-2.5 rounded-[3px] bg-muted" />
            {t("widgets.study-sessions.notEnough")}
          </div>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Decks ────────────────────────────────────────────────────────────────────────────────────

type DeckRow = Result<"statistics.deckTable">["rows"][number];
type DeckSort = "name" | "count" | "timeMs" | "stability" | "matureShare";

function Sparkline({ values }: { values: number[] }) {
  const highest = Math.max(1, ...values);
  const step = 120 / Math.max(1, values.length);
  return (
    <svg width={120} height={26} aria-hidden className="block">
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per part of the range.
            key={index}
            x={index * step + 0.5}
            y={26 - Math.max(2, (value / highest) * 26)}
            width={Math.max(1, step - 1.5)}
            height={Math.max(2, (value / highest) * 26)}
            rx={1}
            fill="var(--statly-accent)"
            opacity={0.85}
          />
        ) : null,
      )}
    </svg>
  );
}

function StabilityBadge({ value }: { value: number | null }) {
  const decimal = useDecimal(0);
  if (value === null) {
    return <span className="text-muted">–</span>;
  }
  const change = (value - 1) * 100;
  const text = `${change >= 0 ? "+" : "−"}${decimal(Math.abs(change))} %`;
  const strong = Math.abs(change) >= 15;
  const color = change >= 0 ? "var(--statly-success)" : "var(--statly-danger)";
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 tabular-nums"
      style={
        strong
          ? { background: `color-mix(in oklab, ${color} 22%, transparent)`, color }
          : { color: "var(--statly-muted)" }
      }
    >
      {text}
    </span>
  );
}

function DeckTable({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const percent = usePercent();
  const decimal = useDecimal();
  const [frame, size] = useSize<HTMLDivElement>();
  const [sort, setSort] = useState<{ key: DeckSort; down: boolean }>({ key: "count", down: true });
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const { start, end, deckId } = scope;
  const table = useStatistic("statistics.deckTable", { start, end, deckId, measure: "reviews" });
  const data = table.data;
  const wide = size.width >= 640;
  const roomy = size.width >= 470;
  const columns = [
    "minmax(0,1fr)",
    ...(wide ? ["128px"] : []),
    "72px",
    ...(roomy ? ["58px"] : []),
    "84px",
    ...(roomy ? ["124px"] : ["48px"]),
  ].join(" ");

  const kids = useMemo(() => {
    const found = new Map<number | null, DeckRow[]>();
    for (const row of data?.rows ?? []) {
      const list = found.get(row.parentId) ?? [];
      list.push(row);
      found.set(row.parentId, list);
    }
    return found;
  }, [data]);

  const ordered = (rows: DeckRow[]) =>
    [...rows].sort((a, b) => {
      const direction = sort.down ? -1 : 1;
      if (sort.key === "name") {
        return a.name.localeCompare(b.name) * -direction;
      }
      const left = a[sort.key] ?? -1;
      const right = b[sort.key] ?? -1;
      return (left - right) * direction;
    });

  const visible: DeckRow[] = [];
  const walk = (parent: number | null) => {
    for (const row of ordered(kids.get(parent) ?? [])) {
      visible.push(row);
      if (open.has(row.deckId)) {
        walk(row.deckId);
      }
    }
  };
  walk(null);

  const stabilityLabel =
    data?.stabilityKind === "interval"
      ? t("widgets.deck-table.interval")
      : t("widgets.deck-table.stability");
  const header = (key: DeckSort | null, label: string, align = "text-right") => (
    <button
      type="button"
      disabled={key === null}
      onClick={() =>
        key &&
        setSort((current) => ({ key, down: current.key === key ? !current.down : key !== "name" }))
      }
      className={`cursor-pointer truncate border-0 bg-transparent p-0 text-[10px] font-bold tracking-[0.1em] uppercase disabled:cursor-default ${align} ${sort.key === key ? "text-text" : "text-muted hover:text-text"}`}
      title={key ? t("widgets.deck-table.sortBy", { column: label }) : undefined}
    >
      {sort.key === key ? <span aria-hidden>{sort.down ? "↓ " : "↑ "}</span> : null}
      {label}
    </button>
  );

  return (
    <WidgetCard title={t("widgets.deck-table.title")}>
      <WidgetState status={table} empty={(data?.rows.length ?? 0) === 0}>
        <div ref={frame} className="flex h-full min-h-0 flex-col">
          <div
            className="grid items-center gap-x-3 border-b border-line px-2 pb-1.5"
            style={{ gridTemplateColumns: columns }}
          >
            {header("name", t("widgets.deck-table.deck"), "text-left")}
            {wide ? header(null, t("widgets.deck-table.history"), "text-left") : null}
            {header("count", t("widgets.deck-table.count"))}
            {roomy ? header("timeMs", t("widgets.deck-table.time")) : null}
            {header("stability", stabilityLabel, "text-center")}
            {header("matureShare", t("widgets.deck-table.mature"))}
          </div>
          <div className="statly-scroll min-h-0 flex-1 overflow-y-auto">
            {visible.map((row) => {
              const expanded = open.has(row.deckId);
              const tipLines = [
                t("widgets.deck-table.tipRetention", { share: percent(row.retention) }),
                row.stability === null
                  ? t("widgets.deck-table.tipNoStability")
                  : t("widgets.deck-table.tipStability", {
                      change: `${row.stability >= 1 ? "+" : "−"}${decimal(Math.abs(row.stability - 1) * 100)} %`,
                    }),
                ...(row.stabilityDays === null
                  ? []
                  : [
                      t(
                        data?.stabilityKind === "interval"
                          ? "widgets.deck-table.tipMedianInterval"
                          : "widgets.deck-table.tipMedian",
                        { days: decimal(row.stabilityDays) },
                      ),
                    ]),
                t("widgets.deck-table.tipCards", {
                  count: number(row.cards),
                  mature: number(Math.round((row.matureShare ?? 0) * row.cards)),
                }),
              ];
              return (
                <div
                  key={row.deckId}
                  className="grid min-h-[44px] items-center gap-x-3 rounded-control border-b border-line/60 px-2 py-1 text-[13px] hover:bg-hover/70"
                  style={{ gridTemplateColumns: columns }}
                  data-tooltip={richTip({ title: row.name, lines: tipLines })}
                >
                  <div
                    className="flex min-w-0 items-center gap-1"
                    style={{ paddingLeft: row.depth * 16 }}
                  >
                    {row.children > 0 ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={t(
                          expanded ? "widgets.deck-table.close" : "widgets.deck-table.open",
                        )}
                        onClick={() =>
                          setOpen((current) => {
                            const next = new Set(current);
                            if (expanded) {
                              next.delete(row.deckId);
                            } else {
                              next.add(row.deckId);
                            }
                            return next;
                          })
                        }
                        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 text-muted hover:bg-hover hover:text-text"
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-text">{row.name}</span>
                      {row.path ? (
                        <span className="block truncate text-[11.5px] text-muted">
                          {row.path.replaceAll("::", " › ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {wide ? <Sparkline values={row.series} /> : null}
                  <span className="text-right text-text tabular-nums">{number(row.count)}</span>
                  {roomy ? (
                    <span className="text-right text-text tabular-nums">
                      {compactDuration(row.timeMs, decimal)}
                    </span>
                  ) : null}
                  <span className="text-center text-[12px]">
                    <StabilityBadge value={row.stability} />
                  </span>
                  <span className="flex items-center justify-end gap-2 tabular-nums">
                    {roomy ? (
                      <span className="relative h-1.5 w-[72px] overflow-hidden rounded-full bg-hover">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-accent"
                          style={{
                            width: `${Math.max(row.matureShare ? 6 : 0, (row.matureShare ?? 0) * 100)}%`,
                          }}
                        />
                      </span>
                    ) : null}
                    <span className="text-text">
                      {percent(row.matureShare ?? 0).replace(/[.,]\d/, "")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Forgotten most ───────────────────────────────────────────────────────────────────────────

const FORGOTTEN_LIMIT = 40;

function ForgottenCards({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const forgotten = useStatistic("statistics.forgotten", {
    start,
    end,
    deckId,
    limit: FORGOTTEN_LIMIT,
  });
  const cards = forgotten.data?.cards ?? [];
  const browse = (ids: number[]) => {
    if (ids.length > 0) {
      void bridge.call("system.openBrowser", { cardIds: ids });
    }
  };
  const columns = "minmax(0,1fr) 92px 64px";
  return (
    <WidgetCard
      title={t("widgets.forgotten-cards.title")}
      note={
        forgotten.data && forgotten.data.total > cards.length
          ? t("widgets.forgotten-cards.more", { count: forgotten.data.total })
          : undefined
      }
      actions={
        cards.length > 0 ? (
          <Button
            className="h-8 px-2.5 text-[12px]"
            onClick={() => browse(cards.map((card) => card.cardId))}
          >
            <ExternalLink size={13} />
            {t("widgets.forgotten-cards.open")}
          </Button>
        ) : null
      }
    >
      <WidgetState status={forgotten} empty={cards.length === 0}>
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="grid gap-x-3 border-b border-line px-2 pb-1.5 text-[10px] font-bold tracking-[0.1em] text-muted uppercase"
            style={{ gridTemplateColumns: columns }}
          >
            <span>{t("widgets.forgotten-cards.card")}</span>
            <span className="text-right">{t("widgets.forgotten-cards.forgot")}</span>
            <span className="text-right">{t("widgets.forgotten-cards.interval")}</span>
          </div>
          <div className="statly-scroll min-h-0 flex-1 overflow-y-auto">
            {cards.map((card) => (
              <button
                key={card.cardId}
                type="button"
                onClick={() => browse([card.cardId])}
                className="grid w-full cursor-pointer items-center gap-x-3 rounded-control border-0 border-b border-line/60 bg-transparent px-2 py-2.5 text-left text-[13px] text-text hover:bg-hover/70"
                style={{ gridTemplateColumns: columns }}
                data-tooltip={richTip({
                  title: card.text,
                  rows: [
                    {
                      color: "var(--statly-danger)",
                      label: t("widgets.forgotten-cards.tipForgot", {
                        forgot: card.forgot,
                        seen: card.seen,
                      }),
                    },
                  ],
                  lines: [card.deck.replaceAll("::", " › "), t("widgets.forgotten-cards.openOne")],
                })}
              >
                <span className="truncate">{card.text}</span>
                <span className="text-right tabular-nums">
                  <span className="font-semibold text-danger">{number(card.forgot)}</span>{" "}
                  <span className="text-muted">
                    {t("widgets.forgotten-cards.of", { count: card.seen })}
                  </span>
                </span>
                <span className="text-right text-muted tabular-nums">
                  {card.intervalDays === null
                    ? "–"
                    : t("widgets.forgotten-cards.days", { count: card.intervalDays })}
                </span>
              </button>
            ))}
          </div>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Weakest decks and where new cards came from ─────────────────────────────────────────────

function WeakestDecks({ scope }: WidgetProps) {
  const { t } = useFormatters();
  const percent = usePercent();
  const { start, end, deckId } = scope;
  const topics = useStatistic("statistics.topics", { start, end, deckId });
  const data = topics.data;
  const rows = data?.weakest ?? [];
  const shares = rows.map((row) => row.passed / row.checked);
  const low = Math.min(0.6, ...shares.map((share) => Math.floor(share * 10) / 10));
  const position = (share: number) => `${((share - low) / (1 - low)) * 100}%`;
  return (
    <WidgetCard
      title={t("widgets.weakest-decks.title")}
      note={
        data?.retention == null
          ? undefined
          : t("widgets.weakest-decks.overall", { share: percent(data.retention) })
      }
    >
      <WidgetState status={topics} empty={rows.length === 0}>
        <div className="statly-scroll flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const share = row.passed / row.checked;
            const below = data?.retention != null && share < data.retention;
            return (
              <div
                key={row.deckId}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_44px] items-center gap-3"
                data-tooltip={richTip({
                  title: row.name,
                  rows: [
                    {
                      label: t("widgets.weakest-decks.checked", { count: row.checked }),
                      value: percent(share),
                    },
                  ],
                  lines: row.path ? [row.path.replaceAll("::", " › ")] : [],
                })}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text">{row.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {[
                      row.path.replaceAll("::", " › "),
                      t("widgets.weakest-decks.checked", { count: row.checked }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="relative h-2 rounded-full bg-hover">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: position(share),
                      background: below
                        ? "color-mix(in oklab, var(--statly-danger) 80%, transparent)"
                        : "var(--statly-accent)",
                    }}
                  />
                  {data?.retention == null ? null : (
                    <span
                      className="absolute -inset-y-1.5 w-0 border-l-2 border-dashed border-text/70"
                      style={{ left: position(data.retention) }}
                    />
                  )}
                </span>
                <span className="text-right text-[13px] text-text tabular-nums">
                  {percent(share).replace(/[.,]\d/, "")}
                </span>
              </div>
            );
          })}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

function NewCardsFrom({ scope }: WidgetProps) {
  const { t, number } = useFormatters();
  const { start, end, deckId } = scope;
  const topics = useStatistic("statistics.topics", { start, end, deckId });
  const data = topics.data;
  const shown = data?.newFrom ?? [];
  const rest = (data?.newCards ?? 0) - shown.reduce((all, deck) => all + deck.cards, 0);
  return (
    <WidgetCard title={t("widgets.new-cards-from.title")}>
      <WidgetState
        status={topics}
        empty={shown.length === 0}
        emptyText={t("widgets.new-cards-from.none")}
      >
        <div className="statly-scroll flex h-full flex-wrap content-start items-center gap-2 overflow-y-auto">
          {shown.map((deck) => (
            <span
              key={deck.deckId}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border px-3 py-1 text-[12.5px] text-text"
              style={{
                borderColor: "color-mix(in oklab, var(--statly-accent) 45%, transparent)",
                background: "color-mix(in oklab, var(--statly-accent) 14%, transparent)",
              }}
              data-tooltip={
                deck.path
                  ? richTip({ title: deck.name, lines: [deck.path.replaceAll("::", " › ")] })
                  : undefined
              }
            >
              <span className="truncate">{deck.name}</span>
              <span className="text-muted">· {number(deck.cards)}</span>
            </span>
          ))}
          {rest > 0 ? (
            <span className="text-[12px] text-muted">
              {t("widgets.new-cards-from.more", { count: rest })}
            </span>
          ) : null}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

// ── Day notes ────────────────────────────────────────────────────────────────────────────────

function DayNotes({ scope }: WidgetProps) {
  const { t, locale } = useFormatters();
  const client = useQueryClient();
  const today = useStatistic("statistics.today", {});
  const { start, end } = scope;
  const day = today.data && end > today.data.date ? today.data.date : end;
  const notes = useQuery({
    queryKey: ["notes", start, end],
    queryFn: () => bridge.call("notes.list", { start, end }),
  });
  const stored = notes.data?.find((note) => note.date === day)?.text ?? "";
  const [draft, setDraft] = useState<{ day: string; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const text = draft?.day === day ? draft.text : stored;
  const changed = text.trim() !== stored;

  const save = async () => {
    await bridge.call("notes.save", { date: day, text });
    setDraft(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
    await client.invalidateQueries({ queryKey: ["notes"] });
  };
  const earlier = (notes.data ?? []).filter((note) => note.date !== day).reverse();
  return (
    <WidgetCard
      title={t("widgets.day-notes.title")}
      note={t("widgets.day-notes.editing", { date: fullDate(day, locale) })}
    >
      <WidgetState status={notes} empty={false}>
        <div className="flex h-full min-h-0 flex-col gap-2">
          {/* The hint lives in the hover box; the save button only shows once there is something
              to save, in the field's corner, so the widget stays quiet otherwise. */}
          <div className="relative flex min-h-[54px] flex-1">
            <textarea
              value={text}
              maxLength={2000}
              placeholder={t("widgets.day-notes.placeholder")}
              onChange={(event) => setDraft({ day, text: event.target.value })}
              onBlur={() => (changed ? void save() : undefined)}
              className={`h-full w-full resize-none rounded-control border border-line bg-hover/50 p-2.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent ${
                changed || saved ? "pb-11" : ""
              }`}
              title={t("widgets.day-notes.private")}
            />
            {changed || saved ? (
              <Button
                primary={changed}
                className="absolute bottom-2 left-2 h-7 px-2.5 text-[12px] shadow-card"
                disabled={!changed}
                // Keeps the field focused, so its blur does not save first and move the button.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void save()}
              >
                {saved && !changed ? t("widgets.day-notes.saved") : t("widgets.day-notes.save")}
              </Button>
            ) : null}
          </div>
          {earlier.length > 0 ? (
            <div className="statly-scroll max-h-[45%] min-h-0 overflow-y-auto border-t border-line pt-2">
              <p className="m-0 mb-1 text-[10px] font-bold tracking-[0.1em] text-muted uppercase">
                {t("widgets.day-notes.earlier")}
              </p>
              {earlier.map((note) => (
                <button
                  key={note.date}
                  type="button"
                  onClick={() => scope.pickRange?.({ start: note.date, end: note.date })}
                  className="block w-full cursor-pointer rounded-control border-0 bg-transparent px-1.5 py-1 text-left hover:bg-hover"
                >
                  <span className="block text-[11px] font-semibold text-muted">
                    {fullDate(note.date, locale)}
                  </span>
                  <span className="block truncate text-[12.5px] text-text">{note.text}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

export const insightWidgets = {
  "study-overview": StudyOverview,
  "period-summary": PeriodSummary,
  "answer-mix": AnswerMix,
  "answer-speed": AnswerSpeed,
  "study-sessions": StudySessions,
  "deck-table": DeckTable,
  "forgotten-cards": ForgottenCards,
  "weakest-decks": WeakestDecks,
  "new-cards-from": NewCardsFrom,
  "day-notes": DayNotes,
} as const;
