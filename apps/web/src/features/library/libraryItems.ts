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

/** How many tiles a section shows before it offers "show all". */
export const SECTION_LIMIT = 8;

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
