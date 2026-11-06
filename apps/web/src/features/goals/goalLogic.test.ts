import { describe, expect, it } from "vitest";
import {
  deadlineOf,
  goalWidgetType,
  isBufferDay,
  isDayOff,
  newExamConfig,
  parseGoalWidget,
  progressOf,
  toggleFreeDate,
  weekdayOf,
} from "./goalLogic.ts";

describe("exam goal settings", () => {
  it("start four weeks out with three days of buffer and every day for studying", () => {
    const config = newExamConfig("2026-11-05");
    expect(config.examDate).toBe("2026-12-03");
    expect(config.bufferDays).toBe(3);
    expect(config.counts).toBe("newAndDue");
    expect(config.studyWeekdays).toHaveLength(7);
  });

  it("keep the buffer right before the exam, as Python does", () => {
    expect(deadlineOf("2027-01-20", 7)).toBe("2027-01-12");
    expect(isBufferDay("2027-01-13", "2027-01-20", 7)).toBe(true);
    expect(isBufferDay("2027-01-12", "2027-01-20", 7)).toBe(false);
    expect(isBufferDay("2027-01-20", "2027-01-20", 7)).toBe(false);
  });

  it("know free weekdays and single days off", () => {
    expect(weekdayOf("2026-11-09")).toBe(0);
    expect(weekdayOf("2026-11-08")).toBe(6);
    const config = { studyWeekdays: [0, 1, 2, 3, 4], freeDates: ["2026-11-11"] };
    expect(isDayOff("2026-11-08", config)).toBe(true);
    expect(isDayOff("2026-11-11", config)).toBe(true);
    expect(isDayOff("2026-11-10", config)).toBe(false);
  });

  it("toggle a day off and keep the list in order", () => {
    expect(toggleFreeDate(["2026-11-20"], "2026-11-11")).toEqual(["2026-11-11", "2026-11-20"]);
    expect(toggleFreeDate(["2026-11-11"], "2026-11-11")).toEqual([]);
  });
});

describe("goal widgets", () => {
  it("name a goal and its view in the widget type", () => {
    const type = goalWidgetType("exam-3f9a1c2b", "ring");
    expect(type).toBe("goal:exam-3f9a1c2b:ring");
    expect(parseGoalWidget(type)).toEqual({ id: "exam-3f9a1c2b", view: "ring" });
    expect(parseGoalWidget("custom:mine")).toBeNull();
    expect(parseGoalWidget("goal:exam-3f9a1c2b:pie")).toBeNull();
  });

  it("count more than the goal as done, not as more", () => {
    expect(progressOf({ target: 10, done: 4 })).toBe(0.4);
    expect(progressOf({ target: 10, done: 25 })).toBe(1);
    expect(progressOf({ target: 0, done: 0 })).toBe(1);
  });
});
