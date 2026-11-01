import { type ChartTheme, heatmapOption, seriesOption } from "@statly/charts";
import type { AnkiFact, AnkiView, AnkiViewResult, WidgetType } from "@statly/contract";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { durationParts, fullDate, shortDate } from "../../lib/format.ts";
import { Chart } from "./Chart.tsx";
import { WidgetCard, WidgetState } from "./WidgetCard.tsx";
import { Chip, ChipGroup, useChartTheme, useFormatters, type WidgetProps } from "./widgetParts.tsx";

const TIME_RANGES = ["month", "threeMonths", "year", "all"] as const;
const DAY_RANGES = ["month", "half", "most", "all"] as const;
const PERCENT_RANGES = ["half", "most", "all"] as const;
const BUTTONS = ["again", "hard", "good", "easy"] as const;
const RETENTION_MODES = ["summary", "young", "mature", "all"] as const;
const DAYS_PER_MONTH = 30.4;
const DAYS_PER_YEAR = 365;

type Range = (typeof TIME_RANGES)[number] | (typeof DAY_RANGES)[number];
type Kind = AnkiViewResult["kind"];
type Formatters = ReturnType<typeof useFormatters>;

/** Colors follow what they stand for, so mature cards look the same in every widget. */
const SERIES_SLOTS: Record<string, number> = {
  mature: 0,
  young: 1,
  relearn: 2,
  relearning: 2,
  learn: 3,
  learning: 3,
  filtered: 4,
  new: 4,
  suspended: 5,
  buried: 6,
};

function colorOf(theme: ChartTheme, name: string): string {
  return theme.series[SERIES_SLOTS[name] ?? 0] ?? theme.accent;
}

function useAnkiView<K extends Kind>(
  kind: K,
  view: AnkiView,
  deckId: number | null,
  range: Range,
  option = false,
) {
  const status = useStatistic("statistics.ankiView", { view, deckId, range, option });
  const data = status.data?.kind === kind ? status.data : undefined;
  return { status, data: data as Extract<AnkiViewResult, { kind: K }> | undefined };
}

function spanOf(days: number, { t, number }: Formatters): string {
  if (days < DAYS_PER_MONTH) {
    return t("ankiStats.units.days", { count: Math.round(days), value: number(Math.round(days)) });
  }
  const years = days >= DAYS_PER_YEAR;
  const amount = days / (years ? DAYS_PER_YEAR : DAYS_PER_MONTH);
  const value = number(Math.round(amount * 10) / 10);
  return t(`ankiStats.units.${years ? "years" : "months"}`, { value });
}

function minutesText(minutes: number, { t }: Formatters): string {
  const parts = durationParts(minutes * 60_000);
  return parts.hours > 0 ? t("time.hoursMinutes", parts) : t("time.minutes", parts);
}

function percentText(share: number, { locale }: Formatters): string {
  const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  return format.format(share);
}

function factText(fact: AnkiFact, tools: Formatters): string {
  const { t, number } = tools;
  const perDay = fact.name.startsWith("average") && fact.unit !== "days";
  const rounded = number(Math.round(fact.value * 10) / 10);
  const plain = (): string => {
    switch (fact.unit) {
      case "reviews":
      case "cards":
      case "notes":
        return t(`ankiStats.units.${fact.unit}`, { count: fact.value, value: rounded });
      case "minutes":
        return minutesText(fact.value, tools);
      case "seconds":
        return t("ankiStats.units.seconds", { value: rounded });
      case "cardsPerMinute":
        return t("ankiStats.units.cardsPerMinute", { value: rounded });
      case "percent":
        return percentText(fact.value / 100, tools);
      default:
        return spanOf(fact.value, tools);
    }
  };
  if (fact.of !== undefined) {
    return t("ankiStats.ofTotal", {
      amount: number(fact.value),
      total: number(fact.of),
      percent: percentText(fact.of ? fact.value / fact.of : 0, tools),
    });
  }
  return perDay ? t("ankiStats.perDay", { value: plain() }) : plain();
}

function Facts({ facts }: { facts: AnkiFact[] }) {
  const tools = useFormatters();
  return (
    <dl className="m-0 grid shrink-0 grid-cols-1 gap-x-4 gap-y-0.5 text-xs @sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.name} className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-muted">
            {tools.t(`ankiStats.facts.${fact.name as "total"}`)}
          </dt>
          <dd className="m-0 shrink-0 font-semibold text-text">{factText(fact, tools)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Layout({ controls, children }: { controls?: ReactNode; children: ReactNode }) {
  return (
    <div className="@container flex h-full flex-col gap-2 overflow-hidden">
      {controls ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">{controls}</div>
      ) : null}
      {children}
    </div>
  );
}

function useCopy(type: WidgetType) {
  const tools = useFormatters();
  return {
    tools,
    title: tools.t(`widgets.${type}.title`),
    note: tools.t(`widgets.${type}.note`),
  };
}

function RangeChips<T extends Range>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useFormatters();
  return (
    <ChipGroup
      label={t("ankiStats.range")}
      options={options}
      value={value}
      onChange={onChange}
      nameOf={(key) => t(`ankiStats.ranges.${key}`)}
    />
  );
}

function binTitle(start: string, end: string, locale: string): string {
  const first = shortDate(start, locale);
  return start === end ? first : `${first} – ${shortDate(end, locale)}`;
}

function Timeline({
  view,
  type,
  scope,
  option,
  optionLabel,
  defaultOption = false,
}: WidgetProps & {
  view: AnkiView;
  type: WidgetType;
  /** The extra choice this section offers, if any. */
  option?: "time" | "backlog";
  optionLabel?: string;
  defaultOption?: boolean;
}) {
  const { tools, title, note } = useCopy(type);
  const { t, number, locale } = tools;
  const [range, setRange] = useState<(typeof TIME_RANGES)[number]>("month");
  const [chosen, setChosen] = useState(defaultOption);
  const { status, data } = useAnkiView("timeline", view, scope.deckId, range, chosen);
  const theme = useChartTheme(scope.themeKey);
  const points = data?.points ?? [];
  const inMinutes = data?.unit === "minutes";
  const format = (value: number) =>
    inMinutes ? minutesText(value, tools) : number(Math.round(value));
  const canChoose = option === "time" || data?.hasBacklog;
  return (
    <WidgetCard title={title} note={note}>
      <Layout
        controls={
          <>
            <RangeChips options={TIME_RANGES} value={range} onChange={setRange} />
            {canChoose && optionLabel ? (
              <Chip pressed={chosen} onClick={() => setChosen(!chosen)}>
                {optionLabel}
              </Chip>
            ) : null}
          </>
        }
      >
        <div className="min-h-0 flex-1">
          <WidgetState status={status} empty={points.every((point) => point.running === 0)}>
            <Chart
              label={title}
              option={seriesOption({
                labels: points.map((point) => shortDate(point.start, locale)),
                titles: points.map((point) => binTitle(point.start, point.end, locale)),
                series: (data?.series ?? []).map((name, index) => ({
                  name: t(`ankiStats.series.${name as "mature"}`),
                  color: colorOf(theme, name),
                  values: points.map((point) => point.values[index] ?? 0),
                })),
                theme,
                format,
                trend: {
                  name: t("ankiStats.running"),
                  values: points.map((point) => point.running),
                  format,
                },
              })}
            />
          </WidgetState>
        </div>
        <Facts facts={data?.facts ?? []} />
      </Layout>
    </WidgetCard>
  );
}

function binLabel(start: number, end: number, percent: boolean): string {
  const span = start === end ? `${start}` : `${start}–${end}`;
  return percent ? `${span} %` : span;
}

function Histogram({
  view,
  type,
  scope,
  ranges,
}: WidgetProps & { view: AnkiView; type: WidgetType; ranges: readonly Range[] }) {
  const { tools, title, note } = useCopy(type);
  const { t, number } = tools;
  const [range, setRange] = useState<Range>(ranges.includes("most") ? "most" : "all");
  const { status, data } = useAnkiView("histogram", view, scope.deckId, range);
  const theme = useChartTheme(scope.themeKey);
  const points = data?.points ?? [];
  const percent = data?.mode !== "days";
  const mode = data?.mode ?? "days";
  const shownTitle = mode === "ease" ? t("widgets.anki-difficulty.titleEase") : title;
  const shownNote = mode === "ease" ? t("widgets.anki-difficulty.noteEase") : note;
  const needsFsrs = data?.available === false;
  return (
    <WidgetCard title={shownTitle} note={shownNote}>
      <Layout controls={<RangeChips options={ranges} value={range} onChange={setRange} />}>
        <div className="min-h-0 flex-1">
          <WidgetState
            status={status}
            empty={needsFsrs || points.length === 0}
            emptyText={needsFsrs ? t("ankiStats.needsFsrs") : undefined}
          >
            <Chart
              label={shownTitle}
              option={seriesOption({
                labels: points.map((point) => binLabel(point.start, point.end, percent)),
                series: [
                  {
                    name: t("ankiStats.series.cards"),
                    color: theme.accent,
                    values: points.map((point) => point.value),
                  },
                ],
                theme,
                format: number,
                trend: {
                  name: t("ankiStats.runningShare"),
                  values: points.map((point) => point.running * 100),
                  max: 100,
                  format: (value) => `${Math.round(value)} %`,
                },
              })}
            />
          </WidgetState>
        </div>
        <Facts facts={data?.facts ?? []} />
      </Layout>
    </WidgetCard>
  );
}

function AnkiToday({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-today");
  const { t, number } = tools;
  const { status, data } = useAnkiView("today", "today", scope.deckId, "all");
  const rows: [string, string][] = data
    ? [
        [t("ankiStats.today.time"), minutesText(data.millis / 60_000, tools)],
        [
          t("ankiStats.today.perCard"),
          t("ankiStats.units.seconds", {
            value: number(Math.round(data.millis / 100 / Math.max(1, data.answers)) / 10),
          }),
        ],
        [t("ankiStats.today.again"), number(data.answers - data.correct)],
        [
          t("ankiStats.today.correct"),
          percentText(data.answers ? data.correct / data.answers : 0, tools),
        ],
        [t("ankiStats.series.learn"), number(data.learn)],
        [t("ankiStats.series.review"), number(data.review)],
        [t("ankiStats.series.relearn"), number(data.relearn)],
        [t("ankiStats.series.filtered"), number(data.filtered)],
        [
          t("ankiStats.today.mature"),
          data.matureCount
            ? `${number(data.matureCorrect)}/${number(data.matureCount)} (${percentText(
                data.matureCorrect / data.matureCount,
                tools,
              )})`
            : "–",
        ],
      ]
    : [];
  return (
    <WidgetCard title={title} note={note}>
      <WidgetState
        status={status}
        empty={data?.answers === 0}
        emptyText={t("ankiStats.today.nothing")}
      >
        <div className="flex h-full flex-col gap-2 overflow-hidden">
          <p className="m-0 text-2xl leading-tight font-bold text-text">
            {t("ankiStats.units.cards", {
              count: data?.answers ?? 0,
              value: number(data?.answers ?? 0),
            })}
          </p>
          <dl className="m-0 flex flex-col gap-0.5 text-xs">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="truncate text-muted">{label}</dt>
                <dd className="m-0 shrink-0 font-semibold text-text">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}

function AnkiCalendar({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-calendar");
  const { t, number, locale } = tools;
  const [year, setYear] = useState<number | null>(null);
  const { status, data } = useAnkiView("calendar", "calendar", scope.deckId, "all");
  const theme = useChartTheme(scope.themeKey);
  const shownYear = year ?? data?.lastYear ?? new Date().getFullYear();
  const days = (data?.days ?? []).filter((day) => day.date.startsWith(`${shownYear}-`));
  const option = heatmapOption({
    year: shownYear,
    days,
    theme,
    locale,
    format: (date, reviews) =>
      t("widgets.review-heatmap.tooltip", {
        date: fullDate(date, locale),
        count: reviews,
        reviews: number(reviews),
      }),
  });
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
    <WidgetCard title={title} note={note} actions={actions}>
      <WidgetState status={status} empty={false}>
        <Chart option={option} label={title} />
      </WidgetState>
    </WidgetCard>
  );
}

function AnkiCardCounts({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-card-counts");
  const { t, number } = tools;
  const [separate, setSeparate] = useState(true);
  const { status, data } = useAnkiView("counts", "card-counts", scope.deckId, "all", separate);
  const theme = useChartTheme(scope.themeKey);
  const items = (data?.items ?? []).filter((item) => item.value > 0 || item.name !== "buried");
  const total = data?.total ?? 0;
  return (
    <WidgetCard title={title} note={note}>
      <Layout
        controls={
          <Chip pressed={separate} onClick={() => setSeparate(!separate)}>
            {t("ankiStats.separateInactive")}
          </Chip>
        }
      >
        <WidgetState status={status} empty={total === 0}>
          <div
            role="img"
            aria-label={title}
            className="flex h-5 shrink-0 gap-0.5 overflow-hidden rounded-[4px]"
          >
            {items
              .filter((item) => item.value > 0)
              .map((item) => (
                <span
                  key={item.name}
                  style={{ flexGrow: item.value, background: colorOf(theme, item.name) }}
                />
              ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto statly-no-scrollbar">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {items.map((item) => (
                  <tr key={item.name}>
                    <th scope="row" className="py-0.5 text-left font-normal text-muted">
                      <span
                        className="mr-1.5 inline-block size-2.5 rounded-[3px]"
                        style={{ background: colorOf(theme, item.name) }}
                      />
                      {t(`ankiStats.series.${item.name as "mature"}`)}
                    </th>
                    <td className="text-right font-semibold text-text">{number(item.value)}</td>
                    <td className="w-16 text-right text-muted">
                      {percentText(total ? item.value / total : 0, tools)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="border-t border-line py-0.5 text-left font-semibold">
                    {t("ankiStats.series.total")}
                  </th>
                  <td className="border-t border-line text-right font-semibold text-text">
                    {number(total)}
                  </td>
                  <td className="border-t border-line" />
                </tr>
              </tbody>
            </table>
          </div>
        </WidgetState>
      </Layout>
    </WidgetCard>
  );
}

function AnkiHours({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-hours");
  const { t, number } = tools;
  const [range, setRange] = useState<(typeof TIME_RANGES)[number]>("month");
  const { status, data } = useAnkiView("hours", "hours", scope.deckId, range);
  const theme = useChartTheme(scope.themeKey);
  const points = data?.points ?? [];
  return (
    <WidgetCard title={title} note={note}>
      <Layout controls={<RangeChips options={TIME_RANGES} value={range} onChange={setRange} />}>
        <div className="min-h-0 flex-1">
          <WidgetState status={status} empty={points.every((point) => point.total === 0)}>
            <Chart
              label={title}
              option={seriesOption({
                labels: points.map((point) => String(point.hour)),
                titles: points.map((point) =>
                  t("ankiStats.hourSpan", { from: point.hour, to: (point.hour + 1) % 24 }),
                ),
                series: [
                  {
                    name: t("ankiStats.series.reviews"),
                    color: theme.accent,
                    values: points.map((point) => point.total),
                  },
                ],
                theme,
                format: number,
                labelInterval: 2,
                trend: {
                  name: t("ankiStats.correctShare"),
                  values: points.map((point) =>
                    point.total ? Math.round((point.correct / point.total) * 100) : 0,
                  ),
                  max: 100,
                  format: (value) => `${Math.round(value)} %`,
                },
              })}
            />
          </WidgetState>
        </div>
      </Layout>
    </WidgetCard>
  );
}

function AnkiButtons({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-buttons");
  const { t, number } = tools;
  const [range, setRange] = useState<(typeof TIME_RANGES)[number]>("month");
  const { status, data } = useAnkiView("buttons", "buttons", scope.deckId, range);
  const theme = useChartTheme(scope.themeKey);
  const groups = data?.groups ?? [];
  return (
    <WidgetCard title={title} note={note}>
      <Layout controls={<RangeChips options={TIME_RANGES} value={range} onChange={setRange} />}>
        <div className="min-h-0 flex-1">
          <WidgetState status={status} empty={groups.every((group) => group.total === 0)}>
            <Chart
              label={title}
              option={seriesOption({
                labels: groups.map((group) => t(`ankiStats.series.${group.name}`)),
                series: BUTTONS.map((button, index) => ({
                  name: t(`answers.${button}`),
                  color: theme.series[index] ?? theme.accent,
                  values: groups.map((group) => group.counts[index] ?? 0),
                })),
                theme,
                stacked: false,
                format: number,
              })}
            />
          </WidgetState>
        </div>
        <dl className="m-0 flex shrink-0 flex-col gap-0.5 text-xs">
          {groups.map((group) => (
            <div key={group.name} className="flex justify-between gap-2">
              <dt className="truncate text-muted">{t(`ankiStats.series.${group.name}`)}</dt>
              <dd className="m-0 shrink-0 font-semibold text-text">
                {t("ankiStats.correctOf", {
                  percent: percentText(group.total ? group.correct / group.total : 0, tools),
                  amount: number(group.correct),
                  total: number(group.total),
                })}
              </dd>
            </div>
          ))}
        </dl>
      </Layout>
    </WidgetCard>
  );
}

type RetentionRow = Extract<AnkiViewResult, { kind: "retention" }>["rows"][number];

function shareOf(passed: number, failed: number, tools: Formatters): string {
  return passed + failed ? percentText(passed / (passed + failed), tools) : "–";
}

function retentionCells(
  row: RetentionRow,
  mode: (typeof RETENTION_MODES)[number],
  tools: Formatters,
): string[] {
  const allPassed = row.youngPassed + row.maturePassed;
  const allFailed = row.youngFailed + row.matureFailed;
  if (mode === "summary") {
    return [
      shareOf(row.youngPassed, row.youngFailed, tools),
      shareOf(row.maturePassed, row.matureFailed, tools),
      shareOf(allPassed, allFailed, tools),
      tools.number(allPassed + allFailed),
    ];
  }
  const [passed, failed] =
    mode === "young"
      ? [row.youngPassed, row.youngFailed]
      : mode === "mature"
        ? [row.maturePassed, row.matureFailed]
        : [allPassed, allFailed];
  return [tools.number(passed), tools.number(failed), shareOf(passed, failed, tools)];
}

function AnkiTrueRetention({ scope }: WidgetProps) {
  const { tools, title, note } = useCopy("anki-true-retention");
  const { t } = tools;
  const [mode, setMode] = useState<(typeof RETENTION_MODES)[number]>("summary");
  const { status, data } = useAnkiView("retention", "true-retention", scope.deckId, "all");
  const rows = data?.rows ?? [];
  const headings =
    mode === "summary"
      ? [
          t("ankiStats.series.young"),
          t("ankiStats.series.mature"),
          t("ankiStats.retention.all"),
          t("ankiStats.retention.count"),
        ]
      : [
          t("ankiStats.retention.passed"),
          t("ankiStats.retention.failed"),
          t("ankiStats.retention.rate"),
        ];
  return (
    <WidgetCard title={title} note={note}>
      <Layout
        controls={
          <ChipGroup
            label={t("ankiStats.retention.mode")}
            options={RETENTION_MODES}
            value={mode}
            onChange={setMode}
            nameOf={(key) => t(`ankiStats.retention.modes.${key}`)}
          />
        }
      >
        <WidgetState status={status} empty={false}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-1 text-left font-medium">
                  {t("ankiStats.retention.range")}
                </th>
                {headings.map((heading) => (
                  <th key={heading} scope="col" className="py-1 text-right font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-line">
                  <th scope="row" className="py-1 text-left font-normal text-muted">
                    {t(`ankiStats.retention.ranges.${row.name}`)}
                  </th>
                  {retentionCells(row, mode, tools).map((cell, index) => (
                    <td
                      key={headings[index]}
                      className="py-1 text-right font-semibold text-text tabular-nums"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </WidgetState>
      </Layout>
    </WidgetCard>
  );
}

function AnkiReviews({ scope }: WidgetProps) {
  const { t } = useFormatters();
  return (
    <Timeline
      view="reviews"
      type="anki-reviews"
      scope={scope}
      option="time"
      optionLabel={t("ankiStats.showTime")}
    />
  );
}

function AnkiFutureDue({ scope }: WidgetProps) {
  const { t } = useFormatters();
  return (
    <Timeline
      view="future-due"
      type="anki-future-due"
      scope={scope}
      option="backlog"
      optionLabel={t("ankiStats.backlog")}
      defaultOption
    />
  );
}

export const ankiWidgets = {
  "anki-today": AnkiToday,
  "anki-future-due": AnkiFutureDue,
  "anki-calendar": AnkiCalendar,
  "anki-reviews": AnkiReviews,
  "anki-card-counts": AnkiCardCounts,
  "anki-intervals": ({ scope }: WidgetProps) => (
    <Histogram view="intervals" type="anki-intervals" scope={scope} ranges={DAY_RANGES} />
  ),
  "anki-stability": ({ scope }: WidgetProps) => (
    <Histogram view="stability" type="anki-stability" scope={scope} ranges={DAY_RANGES} />
  ),
  "anki-difficulty": ({ scope }: WidgetProps) => (
    <Histogram view="difficulty" type="anki-difficulty" scope={scope} ranges={PERCENT_RANGES} />
  ),
  "anki-retrievability": ({ scope }: WidgetProps) => (
    <Histogram
      view="retrievability"
      type="anki-retrievability"
      scope={scope}
      ranges={PERCENT_RANGES}
    />
  ),
  "anki-hours": AnkiHours,
  "anki-buttons": AnkiButtons,
  "anki-added": ({ scope }: WidgetProps) => (
    <Timeline view="added" type="anki-added" scope={scope} />
  ),
  "anki-true-retention": AnkiTrueRetention,
} satisfies Partial<Record<WidgetType, (props: WidgetProps) => ReactNode>>;
