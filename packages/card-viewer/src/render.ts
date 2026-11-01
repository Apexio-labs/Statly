import type { Cells, MobileSnapshot, WidgetElement } from "@statly/contract";
import {
  backgroundStyle,
  boxStyle,
  designAspect,
  isVisibleAt,
  layoutAt,
  paintValue,
  textStyle,
} from "@statly/widget-runtime";

export type Snapshot = MobileSnapshot;
export type Block = Snapshot["blocks"][string];
type Device = "tablet" | "phone";
type Bars = Extract<Block, { kind: "bars" }>;
type Heatmap = Extract<Block, { kind: "heatmap" }>;
type Custom = Extract<Block, { kind: "custom" }>;
type Point = Bars["bars"][number];
type Open = (block: Block, selected?: number) => void;
type Words = Snapshot["words"];

const SVG_NS = "http://www.w3.org/2000/svg";
const TABLET_FROM_PX = 700;
const COLUMNS: Record<Device, number> = { tablet: 8, phone: 4 };

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function svgNode(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

function rows(bars: Point[], onPick?: (index: number) => void): HTMLElement {
  const highest = Math.max(1, ...bars.map((bar) => bar.value));
  const list = element("div", "statly-rows");
  bars.forEach((bar, index) => {
    const row = element("div", "statly-row");
    if (onPick) {
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        onPick(index);
      });
    }
    row.append(element("span", "statly-row-label", bar.label));
    const track = element("span", "statly-row-track");
    const fill = element("span", "statly-row-fill");
    fill.style.width = `${(bar.value / highest) * 100}%`;
    track.append(fill);
    row.append(track, element("span", "statly-row-value", bar.value.toLocaleString()));
    list.append(row);
  });
  return list;
}

/** Stretches with its cell, because a phone decides the room and not the data. */
function columnChart(bars: Point[], label: string, color?: string): SVGElement {
  const width = 320;
  const height = 110;
  const highest = Math.max(1, ...bars.map((bar) => bar.value));
  const step = width / Math.max(1, bars.length);
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    preserveAspectRatio: "none",
  });
  svg.setAttribute("aria-label", label);
  bars.forEach((bar, index) => {
    const barHeight = Math.max(bar.value > 0 ? 2 : 0, (bar.value / highest) * (height - 2));
    const rect = svgNode("rect", {
      x: index * step + step * 0.12,
      y: height - barHeight,
      width: step * 0.76,
      height: barHeight,
      rx: 2,
      class: "statly-bar",
    });
    if (color) {
      rect.style.fill = color;
    }
    svg.append(rect);
  });
  return svg;
}

function lineChart(bars: Point[], label: string, color: string): SVGElement {
  const width = 320;
  const height = 110;
  const highest = Math.max(1, ...bars.map((bar) => bar.value));
  const step = width / Math.max(1, bars.length - 1);
  const points = bars
    .map((bar, index) => `${index * step},${height - (bar.value / highest) * (height - 4) - 2}`)
    .join(" ");
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    preserveAspectRatio: "none",
  });
  svg.setAttribute("aria-label", label);
  const line = svgNode("polyline", {
    points,
    fill: "none",
    "stroke-width": 2,
    "vector-effect": "non-scaling-stroke",
  });
  line.style.stroke = color;
  svg.append(line);
  return svg;
}

function barAt(svg: SVGElement, event: Event, count: number): number {
  const bounds = svg.getBoundingClientRect();
  const share = ((event as MouseEvent).clientX - bounds.left) / bounds.width;
  return Math.max(0, Math.min(count - 1, Math.floor(share * count)));
}

function axisOf(bars: Point[]): HTMLElement {
  const axis = element("div", "statly-axis");
  axis.append(
    element("span", "", bars[0]?.label ?? ""),
    element("span", "", bars[bars.length - 1]?.label ?? ""),
  );
  return axis;
}

function renderBars(block: Bars, onPick?: (index: number) => void): Element {
  if (block.horizontal) {
    return rows(block.bars, onPick);
  }
  const svg = columnChart(block.bars, block.label);
  if (onPick) {
    svg.addEventListener("click", (event) => {
      event.stopPropagation();
      onPick(barAt(svg, event, block.bars.length));
    });
  }
  const wrapper = element("div", "statly-chart");
  wrapper.append(svg as unknown as HTMLElement, axisOf(block.bars));
  return wrapper;
}

function heatGrid(levels: number[], label: string): SVGElement {
  const size = 11;
  const weeks = Math.ceil(levels.length / 7);
  const svg = svgNode("svg", { viewBox: `0 0 ${weeks * size} ${7 * size}`, role: "img" });
  svg.setAttribute("aria-label", label);
  levels.forEach((level, index) => {
    svg.append(
      svgNode("rect", {
        x: Math.floor(index / 7) * size,
        y: (index % 7) * size,
        width: size - 2,
        height: size - 2,
        rx: 2,
        class: `statly-heat statly-heat-${level}`,
      }),
    );
  });
  return svg;
}

function renderHeatmap(block: Heatmap): Element {
  const wrapper = element("div", "statly-chart");
  wrapper.append(
    heatGrid(block.levels, block.label) as unknown as HTMLElement,
    element("p", "statly-note", block.note),
  );
  return wrapper;
}

function fitText(text: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const box = element("div", "statly-fit");
  Object.assign(box.style, style);
  box.append(element("span", "", text));
  return box;
}

function progress(element_: Extract<WidgetElement, { kind: "progress" }>, block: Custom): Element {
  const value = block.values[element_.id];
  const share = value?.share ?? 0;
  const color = paintValue(element_.color);
  if (element_.style === "bar") {
    const track = element("div", "statly-progress");
    const fill = element("div", "statly-progress-fill");
    fill.style.width = `${share * 100}%`;
    fill.style.background = color;
    track.append(fill);
    return track;
  }
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const svg = svgNode("svg", { viewBox: "0 0 100 100", role: "img", class: "statly-ring" });
  svg.setAttribute("aria-label", element_.source);
  const circle = { cx: 50, cy: 50, r: radius, fill: "none", "stroke-width": 10 };
  const track = svgNode("circle", circle);
  track.style.stroke = "var(--statly-hover)";
  const arc = svgNode("circle", {
    ...circle,
    "stroke-linecap": "round",
    "stroke-dasharray": `${share * circumference} ${circumference}`,
    transform: "rotate(-90 50 50)",
  });
  arc.style.stroke = color;
  const label = svgNode("text", {
    x: 50,
    y: 50,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-size": 16,
    "font-weight": 700,
  });
  label.style.fill = "var(--statly-text)";
  label.textContent = value?.text ?? "";
  svg.append(track, arc, label);
  return svg;
}

function media(
  item: Extract<WidgetElement, { kind: "media" }>,
  block: Custom,
  words: Words,
): Element | null {
  const url = block.media[item.asset.id];
  if (item.asset.type.startsWith("video/")) {
    return element("div", "statly-video-note", words.videoHere);
  }
  if (!url) {
    return null;
  }
  const image = document.createElement("img");
  image.src = url;
  image.alt = "";
  image.className = "statly-media";
  image.style.objectFit = item.fit;
  image.style.borderRadius = `${item.radius}%`;
  return image;
}

function shape(item: Extract<WidgetElement, { kind: "shape" }>): Element {
  const box = element("div", "statly-fill");
  box.style.background = paintValue(item.fill);
  box.style.borderRadius = item.shape === "ellipse" ? "50%" : `${item.radius}%`;
  return box;
}

function elementContent(
  item: WidgetElement,
  block: Custom,
  aspect: number,
  words: Words,
): Element | null {
  const value = block.values[item.id];
  switch (item.kind) {
    case "text":
      return fitText(item.text, textStyle(item, aspect) as Partial<CSSStyleDeclaration>);
    case "metric":
      return fitText(value?.text ?? "", textStyle(item, aspect) as Partial<CSSStyleDeclaration>);
    case "chart": {
      const color = paintValue(item.color);
      const bars = value?.bars ?? [];
      const draw = item.chart === "line" ? lineChart : columnChart;
      return draw(bars, item.source, color);
    }
    case "progress":
      return progress(item, block);
    case "heatmap":
      return heatGrid(value?.levels ?? [], "heatmap");
    case "media":
      return media(item, block, words);
    case "shape":
      return shape(item);
    default:
      // Only a card older than its desktop meets this, and a gap beats a wrong drawing.
      return null;
  }
}

/** The same rules as on the desktop, so one widget fits every device. */
function renderCustom(block: Custom, cells: Cells, words: Words): Element {
  const { widget } = block;
  const background = widget.background;
  const picture = background.kind === "media" ? block.media[background.asset.id] : undefined;
  const frame = element("section", "statly-custom");
  Object.assign(frame.style, backgroundStyle(background, picture));
  const aspect = designAspect(widget.size);
  for (const item of widget.elements) {
    if (isVisibleAt(item, cells)) {
      const content = elementContent(item, block, aspect, words);
      if (content) {
        const box = document.createElement("div");
        Object.assign(
          box.style,
          boxStyle(layoutAt(item, widget.size, cells), item.opacity, item.rotation),
        );
        box.append(content);
        frame.append(box);
      }
    }
  }
  return frame;
}

export function renderBlock(block: Block, cells: Cells, words: Words, open?: Open): Element {
  if (block.kind === "custom") {
    return renderCustom(block, cells, words);
  }
  const card = element("section", "statly-block");
  card.append(element("h2", "statly-label", block.label));
  if (block.kind === "tile") {
    const tile = element("div", "statly-tile");
    tile.append(
      element("div", "statly-value", block.value),
      element("p", "statly-note", block.note),
    );
    card.append(tile);
  } else if (block.kind === "bars") {
    if (block.note) {
      card.append(element("p", "statly-note statly-period", block.note));
    }
    card.append(renderBars(block, open && ((index) => open(block, index))));
  } else {
    card.append(renderHeatmap(block));
  }
  if (open) {
    card.addEventListener("click", () => open(block));
  }
  return card;
}

function factRow(label: string, value: string): HTMLElement {
  const row = element("div", "statly-fact");
  row.append(element("span", "", label), element("strong", "", value));
  return row;
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))} %`;
}

/** What one bar means next to all the others. */
function barFacts(block: Bars, selected: number, words: Words): HTMLElement {
  const box = element("div", "statly-facts");
  const bar = block.bars[selected];
  const total = block.bars.reduce((sum, item) => sum + item.value, 0);
  const average = total / Math.max(1, block.bars.length);
  if (bar) {
    box.append(element("h3", "statly-selected", `${bar.label}: ${bar.value.toLocaleString()}`));
    box.append(factRow(words.share, percent(total ? bar.value / total : 0)));
    box.append(factRow(words.comparedTo, signedPercent(average ? bar.value / average - 1 : 0)));
  }
  return box;
}

function barSummary(block: Bars, words: Words): HTMLElement {
  const box = element("div", "statly-facts");
  const total = block.bars.reduce((sum, item) => sum + item.value, 0);
  const best = block.bars.reduce<Point | undefined>(
    (top, item) => (top && top.value >= item.value ? top : item),
    undefined,
  );
  box.append(factRow(words.total, total.toLocaleString()));
  box.append(
    factRow(
      words.average,
      (total / Math.max(1, block.bars.length)).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      }),
    ),
  );
  if (best) {
    box.append(factRow(words.best, `${best.label}: ${best.value.toLocaleString()}`));
  }
  return box;
}

function highlightBar(chart: Element, selected: number): void {
  chart.querySelectorAll(".statly-bar").forEach((bar, index) => {
    bar.classList.toggle("statly-bar-dim", index !== selected);
  });
}

function sheetBody(block: Exclude<Block, Custom>, selected: number, words: Words): HTMLElement {
  const body = document.createElement("div");
  if (block.kind === "tile") {
    body.append(element("div", "statly-value statly-sheet-value", block.value));
    const facts = element("div", "statly-facts");
    facts.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
    body.append(facts);
  } else if (block.kind === "heatmap") {
    body.append(heatGrid(block.levels, block.label) as unknown as HTMLElement);
    const facts = element("div", "statly-facts");
    facts.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
    body.append(facts);
  } else {
    const details = barFacts(block, selected, words);
    const redraw = (index: number) => {
      details.replaceChildren(...barFacts(block, index, words).childNodes);
      highlightBar(body, index);
    };
    const chart = element("div", "statly-sheet-chart");
    chart.append(renderBars({ ...block, horizontal: false }, redraw));
    const list = rows(block.bars, redraw);
    const extra = element("div", "statly-facts");
    extra.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
    body.append(chart, details, barSummary(block, words), extra, list);
    highlightBar(body, selected);
  }
  return body;
}

/** A closer look at one block, on the whole screen. */
function openSheet(root: Element, block: Block, selected: number, words: Words): void {
  if (block.kind === "custom") {
    return;
  }
  const sheet = element("section", "statly-sheet");
  const back = element("button", "statly-back", `‹ ${words.back}`);
  back.setAttribute("type", "button");
  back.addEventListener("click", () => sheet.remove());
  sheet.append(back, element("h2", "statly-title", block.label));
  if (block.note) {
    sheet.append(element("p", "statly-note", block.note));
  }
  sheet.append(sheetBody(block, selected, words));
  root.append(sheet);
}

function deviceFor(width: number): Device {
  return width >= TABLET_FROM_PX ? "tablet" : "phone";
}

function draw(root: Element, snapshot: Snapshot, device: Device): void {
  root.textContent = "";
  const background = snapshot.backgrounds[device];
  const page = root.parentElement;
  if (page) {
    page.style.backgroundImage = background ? `url("${background}")` : "";
    page.classList.toggle("statly-has-background", Boolean(background));
  }
  const header = element("header", "statly-header");
  header.append(
    element("h1", "statly-title", snapshot.title),
    element("p", "statly-note", snapshot.updated),
  );
  const grid = element("div", "statly-grid");
  grid.style.setProperty("--statly-columns", String(COLUMNS[device]));
  for (const { block: key, x, y, w, h } of snapshot[device]) {
    const block = snapshot.blocks[key];
    if (block) {
      const cell = document.createElement("div");
      cell.className = "statly-cell";
      cell.style.gridColumn = `${x + 1} / span ${w}`;
      cell.style.gridRow = `${y + 1} / span ${h}`;
      cell.append(
        renderBlock(block, { w, h }, snapshot.words, (chosen, selected = 0) =>
          openSheet(root, chosen, selected, snapshot.words),
        ),
      );
      grid.append(cell);
    }
  }
  root.append(header, grid, element("p", "statly-hint", snapshot.hint));
}

/** Phones and tablets each get their layout, and turning a device can change which one fits. */
export function render(root: Element, snapshot: Snapshot): void {
  let device = deviceFor(root.clientWidth);
  draw(root, snapshot, device);
  addEventListener("resize", () => {
    const next = deviceFor(root.clientWidth);
    if (next !== device) {
      device = next;
      draw(root, snapshot, device);
    }
  });
}

export function decode(encoded: string): Snapshot {
  const bytes = Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
}
