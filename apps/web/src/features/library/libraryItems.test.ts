import { describe, expect, it } from "vitest";
import {
  belongsTo,
  columnsFor,
  favoriteKey,
  groupOf,
  type LibraryItem,
  matchesSearch,
  sectionLimit,
  sectionsFor,
  stepThrough,
  widthName,
} from "./libraryItems.ts";

const statistic: LibraryItem = {
  kind: "statistic",
  key: "due-forecast",
  type: "due-forecast",
  group: "collection",
  title: "Due reviews, next 7 days",
  text: "Plan your reviews for the coming days.",
  tag: "Forecast",
};
const template: LibraryItem = {
  kind: "template",
  key: "streak",
  title: "Streak",
  text: "Days",
  tag: "Template",
};

describe("library filters", () => {
  it("sorts every statistic into its group", () => {
    expect(groupOf("review-heatmap")).toBe("habits");
    expect(groupOf("due-forecast")).toBe("collection");
  });

  it("keeps templates and statistics apart", () => {
    expect(belongsTo(statistic, "collection")).toBe(true);
    expect(belongsTo(statistic, "templates")).toBe(false);
    expect(belongsTo(template, "templates")).toBe(true);
    expect(belongsTo(template, "all")).toBe(true);
  });

  it("collects favorites from every kind of tile", () => {
    expect(favoriteKey(statistic)).toBe("due-forecast");
    expect(favoriteKey(template)).toBe("template:streak");
    expect(belongsTo(statistic, "favorites", ["due-forecast"])).toBe(true);
    expect(belongsTo(template, "favorites", ["due-forecast"])).toBe(false);
  });

  it("finds a tile from any word in any order", () => {
    expect(matchesSearch(statistic, "plan due")).toBe(true);
    expect(matchesSearch(statistic, "forecast")).toBe(true);
    expect(matchesSearch(statistic, "heatmap")).toBe(false);
    expect(matchesSearch(statistic, "   ")).toBe(true);
  });

  it("limits sections only in the overview", () => {
    expect(sectionsFor("all", false).every((section) => section.limited)).toBe(true);
    expect(sectionsFor("all", true).some((section) => section.limited)).toBe(false);
    expect(sectionsFor("habits", false)).toEqual([{ filter: "habits", limited: false }]);
  });

  it("fills whole rows of at most six tiles", () => {
    expect(columnsFor(0)).toBe(6);
    expect(columnsFor(200)).toBe(1);
    expect(columnsFor(1030)).toBe(4);
    expect(columnsFor(2500)).toBe(6);
    expect(sectionLimit(columnsFor(1030))).toBe(8);
  });

  it("names a widget's width in plain words", () => {
    expect(widthName(12)).toBe("full");
    expect(widthName(6)).toBe("half");
    expect(widthName(3)).toBe("quarter");
    expect(widthName(5)).toBeNull();
  });

  it("steps through the tiles with the arrow keys and wraps around", () => {
    const keys = ["a", "b", "c"];
    expect(stepThrough(keys, "a", 1)).toBe("b");
    expect(stepThrough(keys, "c", 1)).toBe("a");
    expect(stepThrough(keys, "a", -1)).toBe("c");
    expect(stepThrough(keys, "gone", 1)).toBe("a");
    expect(stepThrough([], "a", 1)).toBe("a");
  });
});
