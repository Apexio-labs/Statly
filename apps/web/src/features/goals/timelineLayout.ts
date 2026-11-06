import type { ExamStatus } from "@statly/contract";

export type DayKind =
  | "met"
  | "missed"
  | "rest"
  | "today"
  | "study"
  | "review"
  | "free"
  | "buffer"
  | "exam";

export type TimelineDay = {
  date: string;
  kind: DayKind;
  target: number;
  done: number;
  /** Reviews expected on a coming day. Part of the bar when the goal counts them. */
  reviews: number;
  /** Bar height from 0 to 1, against the busiest day shown. */
  height: number;
  /** The part of the bar that is reviews, from 0 to 1 of the bar. */
  reviewShare: number;
};

const PAST_DAYS = 14;

/**
 * The way to the exam: the last two weeks as they went, today, and every day until the exam as
 * planned. Days off stay as gaps, so the rhythm of the week shows.
 */
export function timelineDays(
  status: Pick<ExamStatus, "history" | "plan" | "today" | "target" | "done" | "reviews">,
): TimelineDay[] {
  const counted = status.reviews.counted;
  const past = status.history.filter((day) => day.date < status.today).slice(-PAST_DAYS);
  // Past days and today already count their reviews in their target when the goal does.
  const days: Omit<TimelineDay, "height" | "reviewShare">[] = [
    ...past.map((day) => ({
      date: day.date,
      kind: (day.result === "pending" ? "missed" : day.result) as DayKind,
      target: day.target,
      done: day.done,
      reviews: 0,
    })),
    {
      date: status.today,
      kind: "today" as DayKind,
      target: status.target,
      done: status.done,
      reviews: 0,
    },
    ...status.plan
      .filter((day) => day.date > status.today)
      .map((day) => ({
        date: day.date,
        kind: (day.kind === "rest" ? "free" : day.kind) as DayKind,
        target: day.target,
        done: 0,
        reviews: day.kind === "rest" || day.kind === "buffer" ? 0 : day.reviews,
      })),
  ];
  const size = (day: Omit<TimelineDay, "height" | "reviewShare">) =>
    day.target + (counted ? day.reviews : 0);
  const highest = Math.max(1, ...days.map(size));
  return days.map((day) => ({
    ...day,
    height: size(day) / highest,
    reviewShare: counted && size(day) > 0 ? day.reviews / size(day) : 0,
  }));
}
