/** How long Statly remembers where someone was in the settings, counted from leaving them. */
export const REMEMBER_MS = 3 * 60 * 1000;

type Left = { section: string; scroll: number; at: number };

let left: Left | null = null;

export function rememberSection(section: string, scroll: number, now = Date.now()) {
  left = { section, scroll, at: now };
}

/** The section someone left a moment ago, so quick comparisons land right back in it. */
export function recentSection(now = Date.now()): Left | null {
  return left && now - left.at < REMEMBER_MS ? left : null;
}

export function forgetSection() {
  left = null;
}
