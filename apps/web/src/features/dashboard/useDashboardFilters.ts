import { useState } from "react";
import { addDays } from "../../lib/format.ts";

export const rangePresets = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "lastYear",
  "all",
  "custom",
] as const;
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

export function useDashboardFilters(): DashboardFilters {
  const [preset, setPreset] = useState<RangePreset>("today");
  const [custom, setCustomRange] = useState<CustomRange | null>(null);
  const [deck, setDeck] = useState(ALL_DECKS);
  return {
    preset,
    custom,
    deck,
    setPreset,
    setDeck,
    setCustom: (range) => {
      setCustomRange(range);
      setPreset("custom");
    },
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
