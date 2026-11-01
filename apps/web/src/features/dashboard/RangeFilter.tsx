import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "@statly/i18n";
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { fullDate, weekdayName } from "../../lib/format.ts";
import {
  addMonths,
  clickDay,
  formatDay,
  monthGrid,
  monthOf,
  parseDay,
  type Selection,
  selectBetween,
  typedDay,
} from "./calendar.ts";
import {
  type DashboardFilters,
  type RangePreset,
  rangeOf,
  rangePresets,
} from "./useDashboardFilters.ts";

const FIELD =
  "h-9 w-full rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type Month = { year: number; month: number };

function dayAt(x: number, y: number): string | null {
  const button = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-date]");
  return button && !button.disabled ? (button.dataset.date ?? null) : null;
}

/** Days of the neighboring month stay plain, or a range would show up twice. */
function dayClass(date: string, selection: Selection, outside: boolean): string {
  if (outside) {
    return "bg-transparent text-muted/50 hover:bg-hover";
  }
  if (date === selection.start || date === selection.end) {
    return "bg-primary font-semibold text-on-primary";
  }
  if (date > selection.start && date < selection.end) {
    return "bg-selected text-text";
  }
  return "bg-transparent text-text hover:bg-hover";
}

function Calendar({
  value,
  selection,
  today,
  locale,
}: {
  value: Month;
  selection: Selection;
  today: string;
  locale: string;
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
            disabled={date > today}
            aria-label={`${Number(date.slice(8))} ${fullDate(date, locale)}`}
            aria-current={date === today ? "date" : undefined}
            className={`h-8 cursor-pointer rounded-control border-0 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-30 ${dayClass(date, selection, outside)}`}
          >
            {Number(date.slice(8))}
          </button>
        ))}
      </div>
    </section>
  );
}

function DayField({
  label,
  value,
  invalidNote,
  onChange,
}: {
  label: string;
  value: string;
  invalidNote: (shown: boolean) => void;
  onChange: (date: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const invalid = text !== null && text.length === 10 && parseDay(text) === null;

  function confirm() {
    if (text !== null) {
      const parsed = parseDay(text);
      invalidNote(parsed === null);
      if (parsed) {
        onChange(parsed);
        setText(null);
      }
    }
  }

  return (
    <input
      aria-label={label}
      aria-invalid={invalid}
      inputMode="numeric"
      maxLength={10}
      placeholder="tt.mm.jjjj"
      value={text ?? formatDay(value)}
      className={`${FIELD} ${invalid ? "border-danger" : ""}`}
      onChange={(event) => {
        const typed = typedDay(event.target.value);
        setText(typed);
        const parsed = parseDay(typed);
        if (parsed) {
          invalidNote(false);
          onChange(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          confirm();
        }
      }}
      onBlur={confirm}
    />
  );
}

export function RangeFilter({
  filters,
  today,
  firstReview,
}: {
  filters: DashboardFilters;
  today: string;
  firstReview: string | null;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = rangeOf({
    preset: filters.preset,
    custom: filters.custom,
    today,
    firstReview,
  });
  const [preset, setPreset] = useState<RangePreset>(filters.preset);
  const [selection, setSelection] = useState<Selection>({ ...current, anchor: null });
  const [visible, setVisible] = useState<Month>(monthOf(current.start));
  const [badDate, setBadDate] = useState(false);
  const dragFrom = useRef<string | null>(null);
  const dragged = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  function show(next: Selection, from: RangePreset = "custom") {
    setSelection(next);
    setPreset(from);
  }

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setPreset(filters.preset);
      setSelection({ ...current, anchor: null });
      setVisible(monthOf(current.start));
      setBadDate(false);
    }
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const day = dayAt(event.clientX, event.clientY);
    if (day && event.button === 0) {
      dragFrom.current = day;
      dragged.current = false;
      event.preventDefault();
    }
  }

  // The pointer may leave the calendars during a drag, so the whole page has to listen.
  useEffect(() => {
    if (!open) {
      return;
    }
    function follow(event: globalThis.PointerEvent) {
      const anchor = dragFrom.current;
      const day = dayAt(event.clientX, event.clientY);
      if (anchor && day && (dragged.current || day !== anchor)) {
        dragged.current = true;
        setSelection(selectBetween(anchor, day));
        setPreset("custom");
      }
    }
    function finish(event: globalThis.PointerEvent) {
      const anchor = dragFrom.current;
      dragFrom.current = null;
      if (anchor && !dragged.current) {
        setSelection(clickDay(selectionRef.current, dayAt(event.clientX, event.clientY) ?? anchor));
        setPreset("custom");
      }
    }
    addEventListener("pointermove", follow);
    addEventListener("pointerup", finish);
    return () => {
      removeEventListener("pointermove", follow);
      removeEventListener("pointerup", finish);
    };
  }, [open]);

  /** A quick choice shows up in the calendars first, and Apply is what takes it over. */
  function choosePreset(next: RangePreset) {
    if (next === "custom") {
      setPreset("custom");
      return;
    }
    const range = rangeOf({ preset: next, custom: null, today, firstReview });
    show({ ...range, anchor: null }, next);
    setVisible(monthOf(range.start));
  }

  function apply() {
    if (preset === "custom") {
      filters.setCustom({ start: selection.start, end: selection.end });
    } else {
      filters.setPreset(preset);
    }
    setOpen(false);
  }

  function typed(field: "start" | "end", date: string) {
    const other = field === "start" ? selection.end : selection.start;
    show(field === "start" ? selectBetween(date, other) : selectBetween(other, date));
    setVisible(monthOf(field === "start" ? date : other));
  }

  const label =
    filters.preset === "custom" && filters.custom
      ? `${formatDay(filters.custom.start)} – ${formatDay(filters.custom.end)}`
      : t(`dashboard.ranges.${filters.preset}`);

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger
        aria-label={t("dashboard.range")}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <CalendarDays size={15} />
        {label}
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 flex overflow-hidden rounded-popover border border-line bg-card text-text shadow-card"
        >
          <nav
            className="flex w-[170px] flex-col gap-0.5 bg-hover p-2.5"
            aria-label={t("dashboard.quickRanges")}
          >
            <span className="px-2.5 py-2 text-[11px] font-semibold text-muted">
              {t("dashboard.quickRanges")}
            </span>
            {rangePresets.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={preset === name}
                onClick={() => choosePreset(name)}
                className="cursor-pointer rounded-control border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-text hover:bg-card aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-accent-strong"
              >
                {t(`dashboard.ranges.${name}`)}
              </button>
            ))}
          </nav>
          <div className="flex flex-col">
            <div className="flex flex-col gap-3 p-4">
              <h2 className="m-0 text-[13px] font-bold">{t("calendar.selectRange")}</h2>
              <div className="flex items-center gap-2">
                <DayField
                  label={t("dashboard.start")}
                  value={selection.start}
                  invalidNote={setBadDate}
                  onChange={(date) => typed("start", date)}
                />
                <ArrowRight size={15} className="shrink-0 text-muted" />
                <DayField
                  label={t("dashboard.end")}
                  value={selection.end}
                  invalidNote={setBadDate}
                  onChange={(date) => typed("end", date)}
                />
              </div>
              {badDate ? (
                <p role="alert" className="m-0 text-xs text-danger">
                  {t("calendar.invalid")}
                </p>
              ) : null}
              <div className="relative flex touch-none gap-5 select-none" onPointerDown={startDrag}>
                <button
                  type="button"
                  aria-label={t("calendar.previous")}
                  onClick={() => setVisible(addMonths(visible, -1))}
                  className="absolute top-0 left-0 grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
                >
                  <ChevronLeft size={15} />
                </button>
                <Calendar
                  value={visible}
                  selection={selection}
                  today={today}
                  locale={i18n.language}
                />
                <div className="w-px bg-line" />
                <Calendar
                  value={addMonths(visible, 1)}
                  selection={selection}
                  today={today}
                  locale={i18n.language}
                />
                <button
                  type="button"
                  aria-label={t("calendar.next")}
                  onClick={() => setVisible(addMonths(visible, 1))}
                  className="absolute top-0 right-0 grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-line p-3">
              <Button onClick={() => setOpen(false)}>{t("dashboard.cancel")}</Button>
              <Button primary onClick={apply}>
                {t("dashboard.apply")}
              </Button>
            </footer>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
