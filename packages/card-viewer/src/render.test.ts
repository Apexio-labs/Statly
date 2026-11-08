import { describe, expect, it } from "vitest";
import { type Block, decode, render, renderBlock, type Snapshot } from "./render.ts";

const place = (block: string, y: number, w = 4) => ({ block, x: 0, y, w, h: 6 });

const words = {
  back: "Back",
  total: "Total",
  average: "Average",
  best: "Highest",
  share: "Share",
  comparedTo: "Compared",
  videoHere: "Video on the desktop",
};

const snapshot: Snapshot = {
  title: "Statly",
  updated: "Updated today",
  hint: "Please do not rate",
  blocks: {
    tile: {
      kind: "tile",
      label: "Reviews",
      value: "128",
      note: "Today",
      facts: [{ label: "Last 7 days", value: "900" }],
    },
    timeline: {
      kind: "bars",
      facts: [],
      label: "Timeline",
      note: "Last 30 days",
      horizontal: false,
      bars: [
        { label: "Oct 1", value: 3 },
        { label: "Oct 2", value: 0 },
      ],
    },
    decks: {
      kind: "bars",
      facts: [],
      label: "Decks",
      note: "",
      horizontal: true,
      bars: [{ label: "<b>Spanish</b>", value: 9 }],
    },
    year: {
      kind: "heatmap",
      label: "Year",
      note: "Streak 3",
      levels: [0, 1, 2, 3, 4, 0, 1],
      facts: [{ label: "Longest", value: "12" }],
    },
    own: {
      kind: "custom",
      label: "Mine",
      widget: {
        id: "mine",
        name: "Mine",
        description: "",
        size: { w: 4, h: 6 },
        background: { kind: "card" },
        elements: [
          {
            id: "t",
            kind: "text",
            text: "<i>Hello</i>",
            x: 0,
            y: 0,
            w: 50,
            h: 50,
            opacity: 1,
            rotation: 30,
            size: 12,
            bold: true,
            align: "left",
            color: "text",
          },
          {
            id: "m",
            kind: "metric",
            source: "reviews",
            range: "today",
            x: 50,
            y: 0,
            w: 50,
            h: 50,
            opacity: 1,
            size: 12,
            bold: true,
            align: "left",
            color: "text",
          },
          {
            id: "later",
            kind: "text",
            text: "Only when large",
            showFrom: { w: 8, h: 8 },
            x: 0,
            y: 50,
            w: 50,
            h: 50,
            opacity: 1,
            size: 12,
            bold: true,
            align: "left",
            color: "text",
          },
          {
            id: "p",
            kind: "progress",
            source: "reviews",
            range: "today",
            goal: 10,
            style: "ring",
            color: "accent",
            x: 50,
            y: 50,
            w: 50,
            h: 50,
            opacity: 1,
          },
        ],
      },
      values: { m: { text: "412" }, p: { text: "412", share: 0.5 } },
      media: {},
    },
  },
  backgrounds: { tablet: null, phone: null },
  words,
  tablet: [place("tile", 0, 8)],
  phone: [
    place("tile", 0),
    place("timeline", 6),
    place("decks", 12),
    place("year", 18),
    place("own", 24),
  ],
};

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes));
}

describe("card viewer", () => {
  it("draws every kind of block", () => {
    const root = document.createElement("div");
    render(root, snapshot);
    expect(root.textContent).toContain("128");
    expect(root.textContent).toContain("Please do not rate");
    expect(root.querySelectorAll(".statly-bar")).toHaveLength(2);
    expect(root.querySelectorAll(".statly-heat")).toHaveLength(7);
  });

  it("shows deck names as text, never as markup", () => {
    const root = document.createElement("div");
    render(root, snapshot);
    expect(root.querySelector("b")).toBeNull();
    expect(root.textContent).toContain("<b>Spanish</b>");
  });

  it("draws custom widgets with the rules they have on the desktop", () => {
    const root = document.createElement("div");
    render(root, snapshot);
    const widget = root.querySelector(".statly-custom");
    expect(widget?.textContent).toContain("412");
    expect(widget?.textContent).not.toContain("Only when large");
    expect(widget?.querySelector("i")).toBeNull();
    expect(widget?.textContent).toContain("<i>Hello</i>");
    const rotated = [...(widget?.children ?? [])].find((child) =>
      (child as HTMLElement).style.transform.includes("rotate(30deg)"),
    );
    expect(rotated).toBeDefined();
    expect(widget?.querySelector(".statly-ring")).not.toBeNull();
  });

  it("opens a closer look when a block is tapped", () => {
    const root = document.createElement("div");
    render(root, snapshot);
    root.querySelector<HTMLElement>(".statly-block")?.click();
    const sheet = root.querySelector(".statly-sheet");
    expect(sheet?.textContent).toContain("Last 7 days");
    expect(sheet?.textContent).toContain("900");
    sheet?.querySelector<HTMLElement>(".statly-back")?.click();
    expect(root.querySelector(".statly-sheet")).toBeNull();
  });

  it("explains a single bar next to all the others", () => {
    const root = document.createElement("div");
    render(root, snapshot);
    const row = [...root.querySelectorAll<HTMLElement>(".statly-block")].find((block) =>
      block.textContent?.includes("Timeline"),
    );
    row?.click();
    const sheet = root.querySelector(".statly-sheet");
    expect(sheet?.textContent).toContain("Oct 1: 3");
    expect(sheet?.textContent).toContain("100 %");
    expect(sheet?.textContent).toContain("Total");
    sheet?.querySelectorAll<HTMLElement>(".statly-row")[1]?.click();
    expect(sheet?.textContent).toContain("Oct 2: 0");
    expect(sheet?.querySelectorAll(".statly-bar-dim")).toHaveLength(1);
  });

  it("draws a pie chart as one slice per share", () => {
    const pie = {
      id: "c",
      kind: "chart",
      source: "cardStates",
      chart: "pie",
      range: "dashboard",
      color: "accent",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      opacity: 1,
    } as const;
    const block = snapshot.blocks.own as Extract<Block, { kind: "custom" }>;
    const bars = [
      { label: "New", value: 3 },
      { label: "Young", value: 1 },
      { label: "Empty", value: 0 },
    ];
    const drawn = renderBlock(
      { ...block, widget: { ...block.widget, elements: [pie] }, values: { c: { bars } } },
      { w: 4, h: 6 },
      words,
    );
    const slices = drawn.querySelectorAll(".statly-pie path");
    expect(slices).toHaveLength(2);
    expect(slices[0]?.textContent).toBe("New: 3");
  });

  it("says where a video went", () => {
    const video = {
      id: "v",
      kind: "media",
      asset: { id: "a".repeat(64), type: "video/webm" },
      fit: "cover",
      radius: 0,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      opacity: 1,
    } as const;
    const block = snapshot.blocks.own as Extract<Block, { kind: "custom" }>;
    const drawn = renderBlock(
      { ...block, widget: { ...block.widget, elements: [video] } },
      { w: 4, h: 6 },
      words,
    );
    expect(drawn.textContent).toContain("Video on the desktop");
  });

  it("shows a background only where one was chosen", () => {
    const page = document.createElement("div");
    const root = document.createElement("div");
    page.append(root);
    render(root, { ...snapshot, backgrounds: { tablet: null, phone: "data:image/jpeg;base64,A" } });
    expect(page.style.backgroundImage).toContain("data:image/jpeg");
    expect(page.classList.contains("statly-has-background")).toBe(true);
  });

  it("uses the tablet layout where there is room", () => {
    const root = document.createElement("div");
    Object.defineProperty(root, "clientWidth", { value: 800 });
    render(root, snapshot);
    const grid = root.querySelector<HTMLElement>(".statly-grid");
    expect(grid?.style.getPropertyValue("--statly-columns")).toBe("8");
    expect(root.querySelectorAll(".statly-cell")).toHaveLength(1);
  });

  it("switches layouts when a device turns", () => {
    const root = document.createElement("div");
    let width = 390;
    Object.defineProperty(root, "clientWidth", { get: () => width });
    render(root, snapshot);
    expect(root.querySelectorAll(".statly-cell")).toHaveLength(5);
    width = 900;
    dispatchEvent(new Event("resize"));
    expect(root.querySelectorAll(".statly-cell")).toHaveLength(1);
  });

  it("decodes non-ASCII text", () => {
    expect(decode(encode({ title: "Äöü ß" })).title).toBe("Äöü ß");
  });
});

describe("tables", () => {
  const table: Block = {
    kind: "table",
    label: "Decks",
    note: "Last 30 days",
    columns: ["Stability", "Reviews"],
    rows: [
      { label: "<b>Anatomy</b>", sub: "School", cells: ["+20 %", "7,783"], tone: "good" },
      { label: "Chemistry", sub: "", cells: ["-", "93"], tone: null },
    ],
    facts: [],
  };

  it("draws names as text, values in their columns and the tone on the first value", () => {
    const block = renderBlock(table, { w: 4, h: 6 }, words);
    const rows = block.querySelectorAll(".statly-table-row");
    expect(rows).toHaveLength(3);
    expect(block.querySelector(".statly-table-name span")?.textContent).toBe("<b>Anatomy</b>");
    expect(block.querySelector("b")).toBeNull();
    expect(block.querySelector(".statly-tone-good")?.textContent).toBe("+20 %");
  });

  it("shows only as many rows as the cell has room for", () => {
    const block = renderBlock(table, { w: 4, h: 3 }, words);
    expect(block.querySelectorAll(".statly-table-row:not(.statly-table-head)")).toHaveLength(1);
  });
});

describe("combined charts on the card", () => {
  const points = (values: number[]) =>
    values.map((value, index) => ({ label: String(index), value }));

  it("draws every kind the editor can combine", async () => {
    const { combinableChartKinds } = await import("@statly/contract/charts");
    const { combinedChart } = await import("./render.ts");
    for (const kind of combinableChartKinds) {
      const svg = combinedChart(
        [{ id: "a", kind, source: "hours", color: "accent", axis: "auto" }],
        [points([1, 2, 3])],
        "hours",
      );
      expect(svg.children.length, kind).toBeGreaterThan(0);
    }
  });

  it("puts bars side by side and a line on top, leaving out layers along another axis", async () => {
    const { combinedChart } = await import("./render.ts");
    const svg = combinedChart(
      [
        { id: "a", kind: "line", source: "focusHours", color: "muted", axis: "auto" },
        { id: "b", kind: "bar", source: "hours", color: "accent", axis: "auto" },
        { id: "c", kind: "bar", source: "sessionHours", color: "#ff0000", axis: "auto" },
        { id: "d", kind: "bar", source: "weekdays", color: "#00ff00", axis: "auto" },
      ],
      [points([50, 80]), points([4, 2]), points([1, 3]), points([9, 9])],
      "hours",
    );
    expect(svg.querySelectorAll("rect")).toHaveLength(4);
    expect(svg.lastElementChild?.tagName).toBe("polyline");
  });
});
