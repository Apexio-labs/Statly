import {
  type CustomWidget,
  customWidgetPrefix,
  type WidgetType,
  widgetGroups,
  widgetTypes,
} from "@statly/contract";

export const libraryFilters = [
  "all",
  "favorites",
  "progress",
  "collection",
  "habits",
  "anki",
  "templates",
  "custom",
] as const;
export type LibraryFilter = (typeof libraryFilters)[number];

/** How many full rows a section shows before it offers "show all". */
export const SECTION_ROWS = 2;
/** The narrowest a tile gets, the gap between tiles and the most tiles in one row. */
export const TILE_MIN_PX = 210;
export const TILE_GAP_PX = 12;
export const MAX_COLUMNS = 6;

/** How many tiles fit in one row, the same count the grid's CSS arrives at. */
export function columnsFor(width: number): number {
  if (width <= 0) {
    return MAX_COLUMNS;
  }
  const fit = Math.floor((width + TILE_GAP_PX) / (TILE_MIN_PX + TILE_GAP_PX));
  return Math.max(1, Math.min(MAX_COLUMNS, fit));
}

/** How many tiles a shortened section shows: whole rows only, so no tile stands alone. */
export function sectionLimit(columns: number): number {
  return columns * SECTION_ROWS;
}

const widthNames = {
  12: "full",
  9: "threeQuarters",
  8: "twoThirds",
  6: "half",
  4: "third",
  3: "quarter",
  2: "sixth",
} as const;

/** The plain name for a widget's width on the twelve-column dashboard, or null for odd counts. */
export function widthName(columns: number): (typeof widthNames)[keyof typeof widthNames] | null {
  return widthNames[columns as keyof typeof widthNames] ?? null;
}

export type LibraryItem =
  | {
      kind: "statistic";
      key: string;
      type: WidgetType;
      group: keyof typeof widgetGroups;
      title: string;
      text: string;
      tag: string;
    }
  | { kind: "template"; key: string; title: string; text: string; tag: string }
  | { kind: "custom"; key: string; widget: CustomWidget; title: string; text: string; tag: string };

export function groupOf(type: WidgetType): keyof typeof widgetGroups {
  const groups = Object.keys(widgetGroups) as (keyof typeof widgetGroups)[];
  return (
    groups.find((group) => (widgetGroups[group] as readonly string[]).includes(type)) ?? "progress"
  );
}

export function statisticsInOrder(): WidgetType[] {
  return [...widgetTypes];
}

/** The same name a dashboard uses, so a star means the same thing everywhere. */
export function favoriteKey(item: LibraryItem): string {
  switch (item.kind) {
    case "statistic":
      return item.type;
    case "custom":
      return `${customWidgetPrefix}${item.widget.id}`;
    default:
      return `template:${item.key}`;
  }
}

export function belongsTo(
  item: LibraryItem,
  filter: LibraryFilter,
  favorites: readonly string[] = [],
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "favorites":
      return favorites.includes(favoriteKey(item));
    case "templates":
      return item.kind === "template";
    case "custom":
      return item.kind === "custom";
    default:
      return item.kind === "statistic" && item.group === filter;
  }
}

/** Every word must appear, so "due week" still finds a forecast. */
export function matchesSearch(item: LibraryItem, search: string): boolean {
  const haystack = `${item.title} ${item.text} ${item.tag}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The sections to draw for a filter. A chosen filter and a search show everything at once. */
export function sectionsFor(filter: LibraryFilter, searching: boolean) {
  if (filter !== "all") {
    return [{ filter, limited: false }];
  }
  const order: LibraryFilter[] = [
    "favorites",
    "custom",
    "progress",
    "collection",
    "habits",
    "anki",
    "templates",
  ];
  return order.map((section) => ({ filter: section, limited: !searching }));
}

/**
 * The tile before or after `current`, wrapping around at either end. A key that is no longer on
 * the page starts over at the first tile.
 */
export function stepThrough(
  keys: readonly string[],
  current: string | null,
  direction: -1 | 1,
): string | null {
  if (keys.length === 0) {
    return current;
  }
  const index = current === null ? -1 : keys.indexOf(current);
  if (index === -1) {
    return keys[0] ?? null;
  }
  return keys[(index + direction + keys.length) % keys.length] ?? null;
}

/** True where a key press belongs to a field, so Space and the arrows must not be taken. */
export function takesKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !["button", "checkbox", "radio"].includes(target.type))
  );
}
