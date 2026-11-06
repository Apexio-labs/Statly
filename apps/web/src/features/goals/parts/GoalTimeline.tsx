import type { ExamStatus } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { GraduationCap } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { shortDate } from "../../../lib/format.ts";
import { motivation, studyTime } from "../examText.ts";
import { TONE_COLORS } from "../goalLogic.ts";
import { ringParts, toneOfShare } from "../goalTree.ts";
import { type TimelineDay, timelineDays } from "../timelineLayout.ts";

const MIN_BAR = 0.08;

function share(value: number, target: number): number {
  return target === 0 ? 0 : Math.min(1, value / target);
}

/**
 * A small label above what the pointer is on. `at` is where along the width, from 0 to 1. Near the
 * edges it grows inwards, so it stays inside the card.
 */
function Tip({ text, at }: { text: string; at: number }) {
  const shift = at < 0.25 ? "0%" : at > 0.75 ? "-100%" : "-50%";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full z-10 mb-1.5"
      style={{ left: `${at * 100}%`, transform: `translateX(${shift})` }}
    >
      <div
        key={text}
        className="statly-fade-in rounded-control bg-text px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-page shadow-card"
      >
        {text}
      </div>
    </div>
  );
}

function DayBar({ day, tone }: { day: TimelineDay; tone: ExamStatus["tone"] }) {
  const height = `${Math.max(MIN_BAR, day.height) * 100}%`;
  switch (day.kind) {
    case "met":
      return <div className="w-full rounded-t-[2px] bg-success" style={{ height }} />;
    case "missed":
      return <div className="w-full rounded-t-[2px] bg-danger opacity-80" style={{ height }} />;
    case "today":
      return (
        <div
          className="relative w-full overflow-hidden rounded-t-[2px] bg-hover outline-2 outline-offset-1 outline-accent outline-solid"
          style={{ height }}
        >
          <div
            className="absolute inset-x-0 bottom-0"
            style={{
              height: `${share(day.done, day.target) * 100}%`,
              background: TONE_COLORS[tone],
            }}
          />
        </div>
      );
    case "study":
      return (
        <div className="flex w-full flex-col overflow-hidden rounded-t-[2px]" style={{ height }}>
          <div className="w-full bg-accent opacity-20" style={{ flexGrow: day.reviewShare }} />
          <div className="w-full bg-accent opacity-40" style={{ flexGrow: 1 - day.reviewShare }} />
        </div>
      );
    case "review":
      // After the last day for new cards: only seeing learned cards again.
      return (
        <div
          className="w-full rounded-t-[2px] border-2 border-b-0 border-dashed border-accent/60 bg-accent/10"
          style={{ height: day.reviewShare > 0 ? height : "35%" }}
        />
      );
    case "buffer":
      return <div className="statly-buffer-day h-[30%] w-full rounded-t-[2px]" />;
    case "exam":
      return (
        <div className="grid h-full w-full place-items-end justify-center text-accent-strong">
          <GraduationCap size={14} aria-hidden="true" />
        </div>
      );
    default:
      return <div className="h-[3px] w-full rounded-full bg-line" />;
  }
}

/**
 * The day as a bar split by decks, and below it the way to the exam: the last two weeks as they
 * went, today framed, then every day as planned, the buffer striped and the exam at the end.
 */
export function GoalTimeline({ status }: { status: ExamStatus }) {
  const { t, i18n } = useTranslation();
  const days = timelineDays(status);
  const line = motivation(status);
  const parts = ringParts(status, null, t("goals.widget.reviews"));
  const first = days[0];
  const [day, setDay] = useState<number | null>(null);
  const [part, setPart] = useState<string | null>(null);
  const dayText = (index: number) => {
    const item = days[index];
    if (!item) {
      return "";
    }
    const values = {
      date: shortDate(item.date, i18n.language),
      kind: t(`goals.timeline.kinds.${item.kind}`),
      count: item.target,
      reviews: item.reviews,
    };
    const key =
      item.reviews === 0
        ? "goals.timeline.day"
        : item.target === 0
          ? "goals.timeline.dayOnlyReviews"
          : "goals.timeline.dayWithReviews";
    return t(key, values);
  };
  const weights = parts.reduce((sum, item) => sum + item.weight, 0);
  const partAt = (key: string) => {
    let before = 0;
    for (const item of parts) {
      if (item.key === key) {
        return weights === 0 ? 0.5 : (before + item.weight / 2) / weights;
      }
      before += item.weight;
    }
    return 0.5;
  };
  const pointed = parts.find((item) => item.key === part);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[22px] font-bold leading-none text-text">
            {status.target > 0 ? `${status.done} / ${status.target}` : "–"}
          </span>
          <span className="flex flex-col items-end">
            <span
              data-tone={status.tone}
              className="text-xs font-semibold"
              style={{ color: TONE_COLORS[status.tone] }}
            >
              {t(line.key, line.values)}
            </span>
            {status.time && status.time.left.seconds >= 30 ? (
              <span data-time-left className="text-[11px] text-muted">
                {t("goals.time.left", { time: studyTime(status.time.left.seconds, t) })}
              </span>
            ) : null}
          </span>
        </div>
        <div className="relative mt-2">
          {pointed ? (
            <Tip
              text={`${pointed.label}: ${pointed.done} / ${pointed.target}`}
              at={partAt(pointed.key)}
            />
          ) : null}
          <div
            role="img"
            aria-label={t("goals.widget.ringLabel", { done: status.done, target: status.target })}
            className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
            onPointerLeave={() => setPart(null)}
          >
            {parts.map((part) => {
              const color = TONE_COLORS[toneOfShare(part.done, part.target)];
              return (
                <div
                  key={part.key}
                  data-part={part.key}
                  className="relative h-full overflow-hidden bg-hover transition-opacity duration-150"
                  style={{
                    flexGrow: part.weight,
                    flexBasis: 0,
                    opacity: pointed && pointed.key !== part.key ? 0.45 : 1,
                  }}
                  onPointerEnter={() => setPart(part.key)}
                >
                  <div
                    className="absolute inset-y-0 left-0 opacity-35"
                    style={{
                      width: `${share(part.done + part.inProgress, part.target) * 100}%`,
                      background: color,
                    }}
                  />
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${share(part.done, part.target) * 100}%`, background: color }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {parts.length > 1 && parts.length <= 4 ? (
          <div className="mt-1 flex gap-[2px] text-[10px] text-muted">
            {parts.map((part) => (
              <span
                key={part.key}
                className="min-w-0 truncate"
                style={{ flexGrow: part.weight, flexBasis: 0 }}
              >
                {part.label} {part.done}/{part.target}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {day !== null ? <Tip text={dayText(day)} at={(day + 0.5) / days.length} /> : null}
        <ol
          aria-label={t("goals.timeline.label")}
          className={`m-0 flex min-h-[36px] flex-1 list-none items-end p-0 ${days.length > 40 ? "gap-px" : "gap-[3px]"}`}
          onPointerLeave={() => setDay(null)}
        >
          {days.map((item, index) => (
            <li
              key={item.date}
              data-day-kind={item.kind}
              data-lit={day === index || undefined}
              data-dim={(day !== null && day !== index) || undefined}
              className="statly-day flex h-full min-w-[2px] flex-1 flex-col justify-end"
              onPointerEnter={() => setDay(index)}
            >
              <span className="sr-only">{dayText(index)}</span>
              <div
                className="statly-rise flex h-full flex-col justify-end"
                style={{ "--i": index } as CSSProperties}
              >
                <div className="statly-bar flex h-full flex-col justify-end">
                  <DayBar day={item} tone={status.tone} />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted">
          <span>{first ? shortDate(first.date, i18n.language) : ""}</span>
          <span>
            {t("goals.timeline.exam", { date: shortDate(status.examDate, i18n.language) })}
          </span>
        </div>
      </div>
    </div>
  );
}
