import { fullDate, weekdayName } from "../../lib/format.ts";
import { monthGrid } from "./calendar.ts";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export type Month = { year: number; month: number };

/** The enabled day under a point, so a drag can follow the pointer across months. */
export function dayAt(x: number, y: number): string | null {
  const button = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-date]");
  return button && !button.disabled ? (button.dataset.date ?? null) : null;
}

/**
 * One month as a grid of day buttons. What a day means is up to the caller: it decides which days
 * can be picked and how each one looks, so the same month works for a range and for a single date.
 */
export function MonthCalendar({
  value,
  today,
  locale,
  disabled,
  dayClass,
  onDay,
}: {
  value: Month;
  today: string;
  locale: string;
  disabled: (date: string) => boolean;
  dayClass: (date: string, outside: boolean) => string;
  /** Without it, clicks are left to a parent that listens to the pointer, as the range does. */
  onDay?: (date: string) => void;
}) {
  const heading = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(value.year, value.month, 1)));
  return (
    <section className="w-[252px]">
      <h3 className="m-0 mb-3 h-5 text-center text-[13px] font-bold">{heading}</h3>
      {/* biome-ignore lint/a11y/useSemanticElements: days are buttons in a seven-column layout. */}
      <div role="grid" aria-label={heading} className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((day) => (
          <span key={day} className="h-7 text-[11px] leading-7 text-muted">
            {weekdayName(day, locale)}
          </span>
        ))}
        {monthGrid(value.year, value.month).map(({ date, outside }) => (
          <button
            key={date}
            type="button"
            data-date={date}
            disabled={disabled(date)}
            onClick={onDay ? () => onDay(date) : undefined}
            aria-label={`${Number(date.slice(8))} ${fullDate(date, locale)}`}
            aria-current={date === today ? "date" : undefined}
            className={`h-8 cursor-pointer rounded-control border-0 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-30 ${dayClass(date, outside)}`}
          >
            {Number(date.slice(8))}
          </button>
        ))}
      </div>
    </section>
  );
}
