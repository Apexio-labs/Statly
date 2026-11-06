import type { ExamStatus } from "@statly/contract";

export type GoalDeck = ExamStatus["decks"][number];

/** A ring's slice: a deck, the reviews of the day, or the room a parent's own cards take up. */
export type RingPart = {
  key: string;
  deckId: number | null;
  label: string;
  weight: number;
  target: number;
  done: number;
  inProgress: number;
  /** Whether clicking it opens the decks inside it. */
  opens: boolean;
  /** A parent's own cards: they take room so the subdecks keep their true size, but stay blank. */
  blank?: boolean;
};

export function childrenOf(decks: readonly GoalDeck[], parent: number | null): GoalDeck[] {
  return decks.filter((deck) => deck.parentId === parent);
}

export function deckOf(decks: readonly GoalDeck[], id: number | null): GoalDeck | undefined {
  return id === null ? undefined : decks.find((deck) => deck.deckId === id);
}

/** Red under 40 percent, yellow from 40, green when met, as the owner chose. */
export function toneOfShare(done: number, target: number): "done" | "progress" | "behind" | "rest" {
  if (target === 0) {
    return "rest";
  }
  if (done >= target) {
    return "done";
  }
  return done * 5 >= target * 2 ? "progress" : "behind";
}

function part(deck: GoalDeck, decks: readonly GoalDeck[], byOpen: boolean): RingPart {
  return {
    key: `deck-${deck.deckId}`,
    deckId: deck.deckId,
    label: deck.name.split("::").at(-1) ?? deck.name,
    weight: byOpen ? deck.open : deck.target,
    target: deck.target,
    done: deck.done,
    inProgress: deck.inProgress,
    opens: childrenOf(decks, deck.deckId).some((child) => (byOpen ? child.open : child.target) > 0),
  };
}

/**
 * The slices of one ring. Without a goal for today, as on a day off, slices follow what is still
 * open, so the ring keeps its shape. At the top, the day's reviews get a slice when they count.
 */
export function ringParts(
  status: Pick<ExamStatus, "decks" | "reviews">,
  focus: number | null,
  reviewsLabel: string,
): RingPart[] {
  const decks = status.decks;
  const inside = childrenOf(decks, focus);
  const parent = deckOf(decks, focus);
  const byOpen =
    (parent ? parent.target : inside.reduce((sum, deck) => sum + deck.target, 0)) === 0;
  const parts = inside.map((deck) => part(deck, decks, byOpen));
  if (parent) {
    const own =
      (byOpen ? parent.open : parent.target) - parts.reduce((sum, item) => sum + item.weight, 0);
    if (own > 0) {
      parts.unshift({
        ...part(parent, decks, byOpen),
        key: "own",
        weight: own,
        opens: false,
        blank: true,
      });
    }
  } else if (status.reviews.counted && status.reviews.target > 0) {
    parts.push({
      key: "reviews",
      deckId: null,
      label: reviewsLabel,
      weight: status.reviews.target,
      target: status.reviews.target,
      done: Math.min(status.reviews.done, status.reviews.target),
      inProgress: 0,
      opens: false,
    });
  }
  return parts.filter((item) => item.weight > 0);
}

/** The deck one level up, or null at the top. */
export function parentFocus(decks: readonly GoalDeck[], focus: number | null): number | null {
  return deckOf(decks, focus)?.parentId ?? null;
}
