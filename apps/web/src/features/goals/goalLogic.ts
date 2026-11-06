import {
  type ExamConfig,
  type GoalDraft,
  type GoalStatus,
  type GoalView,
  goalWidgetPrefix,
} from "@statly/contract";
import { addDays } from "../../lib/format.ts";

/** Red, yellow, green, as the owner chose, and calm on a day off. Text says the same. */
export const TONE_COLORS: Record<GoalStatus["tone"], string> = {
  done: "var(--statly-success)",
  progress: "var(--statly-warning)",
  behind: "var(--statly-danger)",
  rest: "var(--statly-accent)",
};

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_WEEKS = 4;
const DEFAULT_BUFFER = 3;

/** A new exam goal: four weeks from today, three days of buffer, every day a study day. */
export function newExamConfig(today: string): ExamConfig {
  return {
    kind: "exam",
    decks: [],
    examDate: addDays(today, DEFAULT_WEEKS * 7),
    bufferDays: DEFAULT_BUFFER,
    mode: "learned",
    counts: "newAndDue",
    studyWeekdays: ALL_WEEKDAYS,
    freeDates: [],
  };
}

/** The last day for new cards. The buffer days before the exam stay free for revision. */
export function deadlineOf(examDate: string, bufferDays: number): string {
  return addDays(examDate, -(bufferDays + 1));
}

export function isBufferDay(day: string, examDate: string, bufferDays: number): boolean {
  return day > deadlineOf(examDate, bufferDays) && day < examDate;
}

/** 0 for Monday, as in the contract. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function isDayOff(day: string, config: Pick<ExamConfig, "studyWeekdays" | "freeDates">) {
  return !config.studyWeekdays.includes(weekdayOf(day)) || config.freeDates.includes(day);
}

export function toggleFreeDate(freeDates: string[], day: string): string[] {
  return freeDates.includes(day)
    ? freeDates.filter((other) => other !== day)
    : [...freeDates, day].sort();
}

/** How much of the day's goal is done, from 0 to 1. More than the goal does not count twice. */
export function progressOf(status: Pick<GoalStatus, "target" | "done">): number {
  return status.target === 0 ? 1 : Math.min(1, status.done / status.target);
}

export function goalWidgetType(id: string, view: GoalView): string {
  return `${goalWidgetPrefix}${id}:${view}`;
}

export function parseGoalWidget(type: string): { id: string; view: GoalView } | null {
  if (!type.startsWith(goalWidgetPrefix)) {
    return null;
  }
  const [id, view] = type.slice(goalWidgetPrefix.length).split(":");
  return id && (view === "ring" || view === "timeline") ? { id, view } : null;
}

/** Whether two drafts would save the same goal, so leaving asks only when something changed. */
export function sameDraft(first: GoalDraft, second: GoalDraft): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}
