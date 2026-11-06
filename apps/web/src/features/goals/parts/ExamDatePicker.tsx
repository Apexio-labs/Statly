import * as Popover from "@radix-ui/react-popover";
import type { ExamConfig } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { addMonths, monthOf } from "../../../components/calendar/calendar.ts";
import { DayField } from "../../../components/calendar/DayField.tsx";
import { type Month, MonthCalendar } from "../../../components/calendar/MonthCalendar.tsx";
import { CalendarIcon } from "../../../components/icons.tsx";
import { addDays, fullDate, weekdayName } from "../../../lib/format.ts";
import { ALL_WEEKDAYS, isBufferDay, isDayOff, toggleFreeDate } from "../goalLogic.ts";

type Dates = Pick<ExamConfig, "examDate" | "bufferDays" | "studyWeekdays" | "freeDates">;
type Mode = "exam" | "free";

const MAX_BUFFER = 60;

function dayClass(day: string, dates: Dates, outside: boolean): string {
  if (outside) {
    return "bg-transparent text-muted/50 hover:bg-hover";
  }
  if (day === dates.examDate) {
    return "bg-primary font-semibold text-on-primary";
  }
  if (isBufferDay(day, dates.examDate, dates.bufferDays)) {
    return "statly-buffer-day text-text hover:bg-hover";
  }
  if (isDayOff(day, dates)) {
    return "bg-transparent text-muted line-through hover:bg-hover";
  }
  return "bg-transparent text-text hover:bg-hover";
}

/** The exam day, the buffer before it and the days off, in one calendar like the dashboard's. */
export function ExamDatePicker({
  value,
  today,
  onChange,
}: {
  value: Dates;
  today: string;
  onChange: (dates: Dates) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<Mode>("exam");
  const [visible, setVisible] = useState<Month>(monthOf(value.examDate));
  const [badDate, setBadDate] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstDay = addDays(today, 1);

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      // Two months are tall, so the field moves up first and the calendar opens below it.
      trigger.current?.scrollIntoView({ block: "start", behavior: "instant" });
      setDraft(value);
      setMode("exam");
      setVisible(monthOf(value.examDate));
      setBadDate(false);
    }
  }

  function pick(day: string) {
    if (mode === "exam") {
      setDraft({
        ...draft,
        examDate: day,
        freeDates: draft.freeDates.filter((free) => free < day),
      });
    } else {
      setDraft({ ...draft, freeDates: toggleFreeDate(draft.freeDates, day) });
    }
  }

  function toggleWeekday(day: number) {
    const next = draft.studyWeekdays.includes(day)
      ? draft.studyWeekdays.filter((other) => other !== day)
      : [...draft.studyWeekdays, day].sort();
    if (next.length > 0) {
      setDraft({ ...draft, studyWeekdays: next });
    }
  }

  const disabled = (day: string) =>
    mode === "exam" ? day < firstDay : day < today || day >= draft.examDate;
  const label = t("goals.calendar.trigger", {
    date: fullDate(value.examDate, i18n.language),
    count: value.bufferDays,
  });

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger
        ref={trigger}
        aria-label={t("goals.setup.exam")}
        className="flex h-10 w-full scroll-mt-[110px] cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-left text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <CalendarIcon size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
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
            className="flex w-[190px] flex-col gap-4 bg-hover p-3"
            aria-label={t("goals.setup.exam")}
          >
            <section className="flex flex-col gap-1.5">
              <h3 className="m-0 text-[11px] font-semibold text-muted">
                {t("goals.calendar.pick")}
              </h3>
              {(["exam", "free"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={mode === name}
                  onClick={() => setMode(name)}
                  className="cursor-pointer rounded-control border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-text hover:bg-card aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-accent-strong"
                >
                  {t(name === "exam" ? "goals.calendar.pickExam" : "goals.calendar.pickFree")}
                </button>
              ))}
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="m-0 text-[11px] font-semibold text-muted">
                {t("goals.calendar.buffer")}
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t("goals.calendar.less")}
                  disabled={draft.bufferDays === 0}
                  onClick={() => setDraft({ ...draft, bufferDays: draft.bufferDays - 1 })}
                  className="grid size-8 cursor-pointer place-items-center rounded-control border border-line bg-control text-text hover:bg-card disabled:cursor-default disabled:opacity-40"
                >
                  <Minus size={14} />
                </button>
                <span
                  className="min-w-0 flex-1 text-center text-[13px] font-semibold"
                  aria-live="polite"
                >
                  {t("goals.calendar.bufferDays", { count: draft.bufferDays })}
                </span>
                <button
                  type="button"
                  aria-label={t("goals.calendar.more")}
                  disabled={draft.bufferDays >= MAX_BUFFER}
                  onClick={() => setDraft({ ...draft, bufferDays: draft.bufferDays + 1 })}
                  className="grid size-8 cursor-pointer place-items-center rounded-control border border-line bg-control text-text hover:bg-card disabled:cursor-default disabled:opacity-40"
                >
                  <Plus size={14} />
                </button>
              </div>
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="m-0 text-[11px] font-semibold text-muted">
                {t("goals.calendar.studyDays")}
              </h3>
              <div className="grid grid-cols-7 gap-1">
                {ALL_WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={draft.studyWeekdays.includes(day)}
                    aria-label={weekdayName(day, i18n.language)}
                    onClick={() => toggleWeekday(day)}
                    className="h-7 cursor-pointer rounded-control border border-line bg-control p-0 text-[11px] text-muted aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-on-primary"
                  >
                    {weekdayName(day, i18n.language).slice(0, 2)}
                  </button>
                ))}
              </div>
            </section>
          </nav>
          <div className="flex flex-col">
            <div className="flex flex-col gap-3 p-4">
              <h2 className="m-0 text-[13px] font-bold">
                {t(mode === "exam" ? "goals.calendar.examHint" : "goals.calendar.freeHint")}
              </h2>
              <DayField
                label={t("goals.calendar.examField")}
                value={draft.examDate}
                invalidNote={setBadDate}
                onChange={(day) => {
                  if (day >= firstDay) {
                    setDraft({ ...draft, examDate: day });
                    setVisible(monthOf(day));
                  } else {
                    setBadDate(true);
                  }
                }}
              />
              {badDate ? (
                <p role="alert" className="m-0 text-xs text-danger">
                  {t("goals.calendar.future")}
                </p>
              ) : null}
              <div className="relative flex gap-5">
                <button
                  type="button"
                  aria-label={t("calendar.previous")}
                  onClick={() => setVisible(addMonths(visible, -1))}
                  className="absolute top-0 left-0 grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
                >
                  <ChevronLeft size={15} />
                </button>
                {[visible, addMonths(visible, 1)].map((month, index) => (
                  <div key={`${month.year}-${month.month}`} className="flex gap-5">
                    {index === 1 ? <div className="w-px bg-line" /> : null}
                    <MonthCalendar
                      value={month}
                      today={today}
                      locale={i18n.language}
                      disabled={disabled}
                      dayClass={(day, outside) => dayClass(day, draft, outside)}
                      onDay={pick}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  aria-label={t("calendar.next")}
                  onClick={() => setVisible(addMonths(visible, 1))}
                  className="absolute top-0 right-0 grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11px] text-muted">
                <li className="flex items-center gap-1.5">
                  <span className="size-3 rounded-[3px] bg-primary" />
                  {t("goals.calendar.legendExam")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="statly-buffer-day size-3 rounded-[3px]" />
                  {t("goals.calendar.legendBuffer")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-muted line-through">17</span>
                  {t("goals.calendar.legendFree")}
                </li>
              </ul>
            </div>
            <footer className="flex justify-end gap-2 border-t border-line p-3">
              <Button onClick={() => setOpen(false)}>{t("dashboard.cancel")}</Button>
              <Button
                primary
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                {t("dashboard.apply")}
              </Button>
            </footer>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
