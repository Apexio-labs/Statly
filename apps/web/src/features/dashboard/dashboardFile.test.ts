import { defaultLayout } from "@statly/contract";
import { describe, expect, it } from "vitest";
import { createDashboardFile, readDashboardFile } from "./dashboardFile.ts";

describe("dashboard files", () => {
  it("reads back what it wrote", () => {
    expect(readDashboardFile(createDashboardFile(defaultLayout))).toEqual(defaultLayout);
  });

  it("reads files from earlier versions", () => {
    const widget = { id: "a", type: "due-cards", x: 0, y: 0, w: 3, h: 4 };
    const file = { format: "statly-dashboard", version: 3, dashboard: { widgets: [widget] } };
    expect(readDashboardFile(JSON.stringify(file))?.widgets).toEqual([widget]);
  });

  it.each(["not json", "{}", '{"format":"other"}', '{"format":"statly-dashboard","version":4}'])(
    "refuses %s",
    (text) => {
      expect(readDashboardFile(text)).toBeNull();
    },
  );

  it("fits sizes a statistic does not allow", () => {
    const widget = { id: "a", type: "due-cards", x: 0, y: 0, w: 12, h: 99 };
    const file = { format: "statly-dashboard", version: 4, layout: { widgets: [widget] } };
    expect(readDashboardFile(JSON.stringify(file))?.widgets[0]).toMatchObject({ w: 6, h: 8 });
  });
});
