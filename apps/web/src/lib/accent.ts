/**
 * A person's own accent color, turned into every token that carries the theme's accent. Charts read
 * these tokens and add alpha to them, so all of them stay plain #rrggbb.
 */

export const ACCENT_TOKENS = [
  "--statly-accent",
  "--statly-accent-strong",
  "--statly-primary",
  "--statly-primary-hover",
  "--statly-on-primary",
  "--statly-selected",
  "--statly-sequence-1",
  "--statly-sequence-2",
  "--statly-sequence-3",
  "--statly-sequence-4",
  "--statly-sequence-5",
  "--statly-series-1",
] as const;

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_SURFACE: Rgb = [34, 42, 54];
const LIGHT_EMPTY: Rgb = [238, 241, 243];
const DARK_EMPTY: Rgb = [44, 54, 68];
const DARK_TEXT = "#11182f";

function parse(hex: string): Rgb {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

function format(color: Rgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** `amount` of `to`, the rest of `from`. */
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((channel, index) => channel + ((to[index] ?? 0) - channel) * amount) as Rgb;
}

/** Relative luminance as WCAG defines it, to choose readable text on a filled button. */
function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function accentPalette(accent: string, dark: boolean): Record<string, string> {
  const color = parse(accent);
  // Dark themes put white text on a deeper version of the accent, like their own buttons do.
  const primary = dark && luminance(color) > 0.25 ? mix(color, BLACK, 0.35) : color;
  const sequence: Rgb[] = dark
    ? [
        mix(DARK_EMPTY, color, 0.06),
        mix(DARK_EMPTY, color, 0.35),
        mix(DARK_EMPTY, color, 0.65),
        color,
        mix(color, WHITE, 0.55),
      ]
    : [
        mix(LIGHT_EMPTY, color, 0.08),
        mix(WHITE, color, 0.35),
        mix(WHITE, color, 0.68),
        color,
        mix(color, BLACK, 0.38),
      ];
  return {
    "--statly-accent": format(color),
    "--statly-accent-strong": format(mix(color, BLACK, dark ? 0.1 : 0.12)),
    "--statly-primary": format(primary),
    "--statly-primary-hover": format(mix(primary, BLACK, 0.15)),
    "--statly-on-primary": luminance(primary) > 0.5 ? DARK_TEXT : "#ffffff",
    "--statly-selected": format(dark ? mix(DARK_SURFACE, color, 0.2) : mix(WHITE, color, 0.12)),
    ...Object.fromEntries(
      sequence.map((step, index) => [`--statly-sequence-${index + 1}`, format(step)]),
    ),
    "--statly-series-1": format(color),
  };
}

/** Puts the accent on the page before anything renders, so charts read the right colors. */
export function applyAccent(root: HTMLElement, accent: string | null, dark: boolean) {
  const palette = accent ? accentPalette(accent, dark) : {};
  for (const token of ACCENT_TOKENS) {
    const value = palette[token];
    if (value === undefined) {
      root.style.removeProperty(token);
    } else if (root.style.getPropertyValue(token) !== value) {
      root.style.setProperty(token, value);
    }
  }
}

/** The theme's own accent, read from a probe that the custom one cannot reach. */
export function themeAccent(theme: string): string {
  const probe = document.createElement("div");
  probe.dataset.theme = theme;
  probe.hidden = true;
  document.body.append(probe);
  const value = getComputedStyle(probe).getPropertyValue("--statly-accent").trim();
  probe.remove();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#087f8c";
}
