import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../lib/format.ts";
import { richTip, type Tip } from "./tip.ts";

/**
 * Days as rounded squares, a column per week, Monday on top. Months are named above their first
 * week and weekdays on the left. The squares grow with the room they get, and with `weeks: "fit"`
 * the calendar shows as many weeks as fit before `end`.
 */

export type HeatScale =
  /** More is stronger, in the accent color or another color. */
  | { kind: "amount"; color?: string }
  /** From bad over middling to good, `good` and `bad` as values. */
  | { kind: "judged"; bad: number; good: number };

export type HeatDay = {
  /** Null for a day that has no value in this view, such as a day without answers. */
  value: number | null;
  /** A day still to come, drawn quieter. */
  ahead?: boolean;
};

type Props = {
  /** The last day shown, usually today or a few weeks after it. */
  end: string;
  /** A fixed first day, or as many weeks as fit. */
  start?: string;
  today: string;
  days: ReadonlyMap<string, HeatDay>;
  scale: HeatScale;
  locale: string;
  label: string;
  tip: (date: string, day: HeatDay | undefined) => Tip;
  /**
   * The dashboard's range. A longer one leaves the days outside it faint, a single day other
   * than today gets a ring.
   */
  highlight?: { start: string; end: string } | undefined;
  onPick?: ((date: string) => void) | undefined;
  /** Smallest square in pixels, below which fewer weeks are shown. */
  minCell?: number;
};

const GAP = 3;
const LABEL_LEFT = 18;
const LABEL_TOP = 16;
const MAX_CELL = 18;
const AMOUNT_STEPS = [30, 48, 66, 83, 100];
/** A day without a value: visible on light and dark cards alike. */
export const EMPTY_DAY = "color-mix(in oklab, var(--statly-text) 9%, transparent)";

function mondayOf(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

function weeksBetween(start: string, end: string): number {
  const days =
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${mondayOf(start)}T12:00:00Z`)) / 864e5;
  return Math.floor(days / 7) + 1;
}

/** Ranks rather than raw size, so one huge day does not leave every other day pale. */
function amountLevels(values: number[]): (value: number) => number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return () => 0;
  }
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const limits = [at(0.25), at(0.5), at(0.75), at(0.92)];
  return (value) => (value <= 0 ? 0 : 1 + limits.filter((limit) => value > limit).length);
}

function judgedColor(value: number, scale: Extract<HeatScale, { kind: "judged" }>): string {
  const share = Math.max(0, Math.min(1, (value - scale.bad) / (scale.good - scale.bad)));
  if (share < 0.5) {
    const part = Math.round(share * 200);
    return `color-mix(in oklab, var(--statly-warning) ${part}%, var(--statly-danger))`;
  }
  const part = Math.round((share - 0.5) * 200);
  return `color-mix(in oklab, var(--statly-success) ${part}%, var(--statly-warning))`;
}

export function heatColor(value: number, level: number, scale: HeatScale): string {
  if (scale.kind === "judged") {
    return judgedColor(value, scale);
  }
  const color = scale.color ?? "var(--statly-accent)";
  const step = AMOUNT_STEPS[Math.max(0, level - 1)] ?? 100;
  return `color-mix(in oklab, ${color} ${step}%, color-mix(in oklab, var(--statly-text) 9%, var(--statly-card)))`;
}

function shortWeekdays(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 1 + index)));
}

export function CalendarHeatmap({
  end,
  start,
  today,
  days,
  scale,
  locale,
  label,
  tip,
  highlight,
  onPick,
  minCell = 9,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) {
      return;
    }
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const byHeight = Math.min(MAX_CELL, (size.height - LABEL_TOP) / 7 - GAP);
  const available = size.width - LABEL_LEFT;
  let weeks: number;
  let cell: number;
  if (start) {
    weeks = weeksBetween(start, end);
    cell = Math.min(byHeight, available / weeks - GAP);
  } else {
    cell = Math.max(minCell, byHeight);
    weeks = Math.max(1, Math.floor(available / (cell + GAP)));
    cell = Math.min(byHeight, available / weeks - GAP);
  }
  cell = Math.max(4, Math.floor(cell * 2) / 2);
  const step = cell + GAP;
  const firstMonday = addDays(mondayOf(end), -7 * (weeks - 1));
  const level = amountLevels([...days.values()].map((day) => day.value ?? 0));
  const months = new Intl.DateTimeFormat(locale, { month: "short" });
  const weekdayNames = shortWeekdays(locale);

  const squares: ReactNode[] = [];
  const monthLabels: ReactNode[] = [];
  let lastMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const monday = addDays(firstMonday, week * 7);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(monday, weekday);
      if ((start && date < start) || date > end) {
        continue;
      }
      const month = Number(date.slice(5, 7));
      if (month !== lastMonth && Number(date.slice(8, 10)) <= 7 && weekday === 0) {
        lastMonth = month;
        monthLabels.push(
          <text key={`m-${date}`} x={LABEL_LEFT + week * step} y={11} className="statly-heat-label">
            {months
              .format(new Date(`${date}T12:00:00`))
              .replace(".", "")
              .toUpperCase()}
          </text>,
        );
      }
      const day = days.get(date);
      const value = day?.value ?? null;
      const spans = highlight !== undefined && highlight.start !== highlight.end;
      const outside = spans && (date < highlight.start || date > highlight.end);
      const picked = highlight?.start === date && highlight.end === date && date !== today;
      const fill =
        value === null || (scale.kind === "amount" && value <= 0)
          ? EMPTY_DAY
          : heatColor(value, level(value), scale);
      squares.push(
        // biome-ignore lint/a11y/noStaticElementInteractions: the date range filter offers the same.
        <rect
          key={date}
          data-date={date}
          x={LABEL_LEFT + week * step}
          y={LABEL_TOP + weekday * step}
          width={cell}
          height={cell}
          rx={Math.max(2, cell * 0.24)}
          fill={fill}
          opacity={day?.ahead ? 0.45 : outside ? 0.42 : 1}
          className={`statly-heat-cell${date === today ? " statly-heat-today" : ""}${picked ? " statly-heat-picked" : ""}${onPick ? " cursor-pointer" : ""}`}
          data-tooltip={richTip(tip(date, day))}
          onClick={onPick ? () => onPick(date) : undefined}
        />,
      );
    }
  }

  const width = LABEL_LEFT + weeks * step;
  const height = LABEL_TOP + 7 * step;
  return (
    <div ref={frame} className="h-full min-h-0 w-full overflow-hidden">
      {size.width > 0 ? (
        <svg
          role="img"
          aria-label={label}
          width={width}
          height={height}
          className="block overflow-visible"
        >
          {monthLabels}
          {weekdayNames.map((name, index) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: the weekdays never move.
              key={index}
              x={2}
              y={LABEL_TOP + index * step + cell / 2 + 4}
              className="statly-heat-label"
            >
              {name}
            </text>
          ))}
          {squares}
        </svg>
      ) : null}
    </div>
  );
}
