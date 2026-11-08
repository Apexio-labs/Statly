import { dashboardRangePresets } from "@statly/contract";
import { useAppearance } from "../../lib/appearance.tsx";
import { addDays } from "../../lib/format.ts";

export const rangePresets = dashboardRangePresets;
export type RangePreset = (typeof rangePresets)[number];

export type CustomRange = { start: string; end: string };

export const ALL_DECKS = "all";

export type DashboardFilters = {
  preset: RangePreset;
  custom: CustomRange | null;
  deck: string;
  setPreset: (preset: RangePreset) => void;
  setCustom: (range: CustomRange) => void;
  setDeck: (deck: string) => void;
};

/**
 * The range and deck above the dashboard. They are kept in the settings, so the dashboard opens
 * the way it was left, also after closing Statly. A named range such as "Last 7 days" keeps
 * moving with the days, only a custom range stays on its dates.
 */
export function useDashboardFilters(): DashboardFilters {
  const { settings, update } = useAppearance();
  const filter = settings.dashboardFilter;
  const save = (patch: Partial<typeof filter>) =>
    update({ dashboardFilter: { ...filter, ...patch } });
  return {
    preset: filter.preset,
    custom: filter.custom,
    deck: filter.deck,
    setPreset: (preset) => save({ preset }),
    setDeck: (deck) => save({ deck }),
    setCustom: (range) => save({ custom: range, preset: "custom" }),
  };
}

export function deckIdOf(deck: string): number | null {
  return deck === ALL_DECKS ? null : Number(deck);
}

type RangeInput = {
  preset: RangePreset;
  custom: CustomRange | null;
  today: string;
  firstReview: string | null;
};

export function rangeOf({ preset, custom, today, firstReview }: RangeInput): CustomRange {
  switch (preset) {
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { start: yesterday, end: yesterday };
    }
    case "last7":
      return { start: addDays(today, -6), end: today };
    case "last30":
      return { start: addDays(today, -29), end: today };
    case "lastYear":
      return { start: addDays(today, -364), end: today };
    case "all":
      return { start: firstReview ?? today, end: today };
    case "custom":
      return custom ?? { start: today, end: today };
    default:
      return { start: today, end: today };
  }
}
