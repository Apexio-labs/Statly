import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "@statly/i18n";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import {
  addMonths,
  clickDay,
  formatDay,
  monthOf,
  type Selection,
  selectBetween,
} from "../../components/calendar/calendar.ts";
import { DayField } from "../../components/calendar/DayField.tsx";
import { dayAt, type Month, MonthCalendar } from "../../components/calendar/MonthCalendar.tsx";
import { CalendarIcon } from "../../components/icons.tsx";
import {
  type DashboardFilters,
  type RangePreset,
  rangeOf,
  rangePresets,
} from "./useDashboardFilters.ts";

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
        <CalendarIcon size={15} />
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
                <MonthCalendar
                  value={visible}
                  today={today}
                  locale={i18n.language}
                  disabled={(date) => date > today}
                  dayClass={(date, outside) => dayClass(date, selection, outside)}
                />
                <div className="w-px bg-line" />
                <MonthCalendar
                  value={addMonths(visible, 1)}
                  today={today}
                  locale={i18n.language}
                  disabled={(date) => date > today}
                  dayClass={(date, outside) => dayClass(date, selection, outside)}
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
