function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Six weeks starting on a Monday, so months keep their height when paging through them. */
export function monthGrid(year: number, month: number): { date: string; outside: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - lead + index));
    return { date: date.toISOString().slice(0, 10), outside: date.getUTCMonth() !== month };
  });
}

export function addMonths(value: { year: number; month: number }, months: number) {
  const date = new Date(Date.UTC(value.year, value.month + months, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function monthOf(date: string) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 };
}

/** A range always stays usable. `anchor` is the day a following click would complete. */
export type Selection = { start: string; end: string; anchor: string | null };

export function selectBetween(first: string, second: string): Selection {
  return first <= second
    ? { start: first, end: second, anchor: null }
    : { start: second, end: first, anchor: null };
}

/** One click already means that day. A second click stretches the range to the clicked day. */
export function clickDay(selection: Selection, day: string): Selection {
  return selection.anchor
    ? selectBetween(selection.anchor, day)
    : { start: day, end: day, anchor: day };
}

export function formatDay(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

/** Adds the dots while someone types, so 31102026 becomes 31.10.2026. */
export function typedDay(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
}

/** Reads dd.mm.yyyy. Returns null unless it is a real date. */
export function parseDay(text: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = iso(year, month - 1, day);
  return value === `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    ? value
    : null;
}
