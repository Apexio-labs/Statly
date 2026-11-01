/** Anki writes nested decks as Parent::Child. Nobody should have to read that. */
export type Deck = { id: number; name: string };

export type DeckNode = {
  /** The full Anki name, unique among all decks. */
  path: string;
  label: string;
  /** Null for a parent that exists only through its children. */
  id: number | null;
  children: DeckNode[];
};

export type DeckMatch = { id: number; label: string; parents: string[] };

const SEPARATOR = "::";

export function deckTree(decks: Deck[]): DeckNode[] {
  const roots: DeckNode[] = [];
  const nodes = new Map<string, DeckNode>();
  for (const deck of [...decks].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = deck.name.split(SEPARATOR);
    let siblings = roots;
    parts.forEach((label, index) => {
      const path = parts.slice(0, index + 1).join(SEPARATOR);
      let node = nodes.get(path);
      if (!node) {
        node = { path, label, id: null, children: [] };
        nodes.set(path, node);
        siblings.push(node);
      }
      if (index === parts.length - 1) {
        node.id = deck.id;
      }
      siblings = node.children;
    });
  }
  return roots;
}

/** The parents of a deck, so the list can open around the current choice. */
export function pathsTo(name: string): string[] {
  const parts = name.split(SEPARATOR);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join(SEPARATOR));
}

export function deckLabel(name: string): string {
  return name.split(SEPARATOR).at(-1) ?? name;
}

function rank(parts: string[], words: string[]): number {
  const leaf = (parts.at(-1) ?? "").toLowerCase();
  const first = words[0] ?? "";
  if (leaf === first) {
    return 0;
  }
  return leaf.startsWith(first) ? 1 : leaf.includes(first) ? 2 : 3;
}

/** Every word must appear somewhere in the path. Decks named like the search come first. */
export function searchDecks(decks: Deck[], search: string): DeckMatch[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const found: (DeckMatch & { score: number })[] = [];
  for (const deck of decks) {
    const parts = deck.name.split(SEPARATOR);
    const path = parts.join(" ").toLowerCase();
    if (words.every((word) => path.includes(word))) {
      found.push({
        id: deck.id,
        label: parts.at(-1) ?? deck.name,
        parents: parts.slice(0, -1),
        score: rank(parts, words),
      });
    }
  }
  return found
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
    .map(({ score: _score, ...match }) => match);
}
