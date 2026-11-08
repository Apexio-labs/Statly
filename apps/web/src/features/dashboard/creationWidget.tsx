import { barOption, type Tip } from "@statly/charts";
import { useMemo } from "react";
import { useStatistic } from "../../lib/calls.ts";
import { durationParts, monthName, shortDate } from "../../lib/format.ts";
import { Chart } from "./Chart.tsx";
import { WidgetCard, WidgetState } from "./WidgetCard.tsx";
import { useChartTheme, useFormatters, type WidgetProps } from "./widgetParts.tsx";

/** Within this share of the usual pace a bar counts as usual, not above or below. */
const USUAL_MARGIN = 0.05;

type Pace = "below" | "above" | "usual";

/** Whether a stretch of time took more or less time per card than usual. */
export function paceOf(seconds: number, cards: number, usual: number | null): Pace | null {
  if (cards === 0 || usual === null || usual === 0) {
    return null;
  }
  const ratio = seconds / cards / usual;
  if (ratio > 1 + USUAL_MARGIN) {
    return "above";
  }
  return ratio < 1 - USUAL_MARGIN ? "below" : "usual";
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function useDuration() {
  const { t } = useFormatters();
  return (seconds: number): string => {
    const parts = durationParts(Math.round(seconds) * 1000);
    if (parts.hours > 0) {
      return t("time.hoursMinutes", parts);
    }
    if (parts.minutes > 0) {
      return parts.seconds > 0 && parts.minutes < 10
        ? t("widgets.creation-time.minutesSeconds", parts)
        : t("time.minutes", parts);
    }
    return t("time.seconds", parts);
  };
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p
        className="m-0 truncate text-[clamp(14px,6cqw,20px)] leading-tight font-bold"
        style={{ color: tone ?? "var(--statly-text)" }}
      >
        {value}
      </p>
      <p className="m-0 mt-0.5 truncate text-[11px] text-muted">{label}</p>
    </div>
  );
}

/** Time spent making new cards: one bar per day, week or month, colored by the pace per card. */
export function CreationTime({ scope }: WidgetProps) {
  const { t, number, locale } = useFormatters();
  const { start, end, deckId } = scope;
  const creation = useStatistic("statistics.creation", { start, end, deckId });
  const theme = useChartTheme(scope.themeKey);
  const duration = useDuration();
  const data = creation.data;
  const usual = data?.usualSecondsPerCard ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme key changes the tokens.
  const colors = useMemo(
    () => ({ below: token("--statly-success"), above: token("--statly-warning") }),
    [scope.themeKey],
  );
  const title = t("widgets.creation-time.title");

  const option = useMemo(() => {
    const items = data?.items ?? [];
    const label = data?.granularity === "month" ? monthName : shortDate;
    const tips: Tip[] = items.map((item) => {
      const pace = paceOf(item.seconds, item.cards, usual);
      return {
        title: label(item.date, locale),
        rows: [
          { label: t("widgets.creation-time.time"), value: duration(item.seconds) },
          { label: t("widgets.creation-time.cards"), value: number(item.cards) },
          ...(item.cards > 0
            ? [
                {
                  label: t("widgets.creation-time.perCard"),
                  value: duration(item.seconds / item.cards),
                },
              ]
            : []),
        ],
        lines: pace && usual ? [compare(item.seconds / item.cards, usual)] : [],
      };
    });
    return barOption({
      bars: items.map((item) => ({
        label: label(item.date, locale),
        value: Math.round((item.seconds / 60) * 10) / 10,
      })),
      theme,
      format: (minutes) => t("time.minutes", { minutes: number(minutes) }),
      labelInterval: Math.floor(items.length / 8),
      colors: items.map((item) => {
        const pace = paceOf(item.seconds, item.cards, usual);
        return pace === "above" ? colors.above : pace === "below" ? colors.below : undefined;
      }),
      tips,
    });

    function compare(perCard: number, base: number): string {
      const share = Math.abs(perCard / base - 1);
      const percent = `${number(Math.round(share * 100))} %`;
      if (share <= USUAL_MARGIN) {
        return t("widgets.creation-time.same");
      }
      return t(perCard > base ? "widgets.creation-time.more" : "widgets.creation-time.less", {
        share: percent,
      });
    }
  }, [data, usual, theme, colors, locale, t, number, duration]);

  const total = data?.total;
  const perCard = total && total.cards > 0 ? total.seconds / total.cards : null;
  const pace = total ? paceOf(total.seconds, total.cards, usual) : null;
  const versus =
    perCard !== null && usual
      ? `${perCard > usual ? "+" : "−"}${number(Math.round(Math.abs(perCard / usual - 1) * 100))} %`
      : "–";
  const measured = data?.measuredSince !== null && data?.measuredSince !== undefined;

  return (
    <WidgetCard title={title} note={t("widgets.creation-time.note")}>
      <WidgetState
        status={creation}
        empty={!measured || (total?.notes ?? 0) === 0}
        emptyText={t(measured ? "widgets.creation-time.emptyRange" : "widgets.creation-time.empty")}
      >
        <div
          data-creation-time=""
          className="flex h-full min-h-0 flex-col gap-2 [container-type:inline-size]"
        >
          <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-2 @[420px]:grid-cols-4">
            <Figure label={t("widgets.creation-time.time")} value={duration(total?.seconds ?? 0)} />
            <Figure label={t("widgets.creation-time.cards")} value={number(total?.cards ?? 0)} />
            <Figure
              label={t("widgets.creation-time.perCard")}
              value={perCard === null ? "–" : duration(perCard)}
            />
            <Figure
              label={t("widgets.creation-time.versusUsual")}
              value={versus}
              tone={pace === "above" ? colors.above : pace === "below" ? colors.below : undefined}
            />
          </div>
          <div className="min-h-0 flex-1">
            <Chart option={option} label={title} />
          </div>
          <p className="m-0 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <i
                className="inline-block size-2 rounded-[2px]"
                style={{ background: colors.below }}
              />
              {t("widgets.creation-time.legendLess")}
            </span>
            <span className="flex items-center gap-1">
              <i
                className="inline-block size-2 rounded-[2px]"
                style={{ background: theme.accent }}
              />
              {t("widgets.creation-time.legendSame")}
            </span>
            <span className="flex items-center gap-1">
              <i
                className="inline-block size-2 rounded-[2px]"
                style={{ background: colors.above }}
              />
              {t("widgets.creation-time.legendMore")}
            </span>
            {usual ? (
              <span>{t("widgets.creation-time.usual", { time: duration(usual) })}</span>
            ) : null}
          </p>
        </div>
      </WidgetState>
    </WidgetCard>
  );
}
