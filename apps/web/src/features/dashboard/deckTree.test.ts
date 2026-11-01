import { describe, expect, it } from "vitest";
import { deckLabel, deckTree, pathsTo, searchDecks } from "./deckTree.ts";

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
