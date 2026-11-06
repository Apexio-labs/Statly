import { describe, expect, it } from "vitest";
import {
  coveringDeck,
  deckLabel,
  deckTree,
  normalizeRoots,
  pathsTo,
  searchDecks,
  toggleDeck,
} from "./deckTree.ts";

const decks = [
  { id: 3, name: "Sprachen::Spanisch::Verben" },
  { id: 1, name: "Sprachen" },
  { id: 2, name: "Sprachen::Spanisch" },
  { id: 4, name: "Medizin" },
  { id: 5, name: "Waise::Kind" },
];

describe("deck tree", () => {
  it("turns Anki's names into a tree", () => {
    const [medizin, sprachen] = deckTree(decks);
    expect(medizin?.label).toBe("Medizin");
    expect(sprachen?.children[0]?.label).toBe("Spanisch");
    expect(sprachen?.children[0]?.children[0]).toMatchObject({ label: "Verben", id: 3 });
  });

  it("keeps a parent that only exists through its children", () => {
    const parent = deckTree(decks).find((node) => node.label === "Waise");
    expect(parent?.id).toBeNull();
    expect(parent?.children[0]?.id).toBe(5);
  });

  it("knows the way to a deck", () => {
    expect(pathsTo("Sprachen::Spanisch::Verben")).toEqual(["Sprachen", "Sprachen::Spanisch"]);
    expect(deckLabel("Sprachen::Spanisch::Verben")).toBe("Verben");
  });
});

describe("deck search", () => {
  it("finds a deck by any part of its path", () => {
    expect(searchDecks(decks, "verben")[0]).toEqual({
      id: 3,
      label: "Verben",
      parents: ["Sprachen", "Spanisch"],
    });
    expect(searchDecks(decks, "sprachen verben").map((match) => match.id)).toEqual([3]);
  });

  it("puts the deck named like the search first", () => {
    expect(searchDecks(decks, "spanisch").map((match) => match.id)).toEqual([2, 3]);
  });

  it("finds nothing without a match", () => {
    expect(searchDecks(decks, "zzz")).toEqual([]);
  });
});

describe("choosing several decks", () => {
  const decks = [
    { id: 1, name: "Medizin" },
    { id: 2, name: "Medizin::Anatomie" },
    { id: 3, name: "Medizin::Anatomie::Knochen" },
    { id: 4, name: "Medizinball" },
  ];

  it("lets a ticked parent take its subdecks along", () => {
    expect(toggleDeck(decks, [2, 4], 1)).toEqual([4, 1]);
  });

  it("keeps a subdeck out while its parent is ticked", () => {
    expect(toggleDeck(decks, [1], 3)).toEqual([1]);
    expect(coveringDeck(decks, [1], 3)).toBe(1);
  });

  it("does not take a deck with a similar name for a subdeck", () => {
    expect(coveringDeck(decks, [1], 4)).toBeNull();
    expect(toggleDeck(decks, [1], 4)).toEqual([1, 4]);
  });

  it("unticks and forgets decks that are gone", () => {
    expect(toggleDeck(decks, [1, 4], 1)).toEqual([4]);
    expect(normalizeRoots(decks, [99, 2, 2])).toEqual([2]);
  });
});
