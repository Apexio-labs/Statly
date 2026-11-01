/** Long durations are read as hours and minutes, short ones as minutes and seconds. */
export function durationParts(milliseconds: number) {
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function monthName(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function fullDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function weekdayName(mondayFirstIndex: number, locale: string): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + mondayFirstIndex)),
  );
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
