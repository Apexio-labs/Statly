import type { Paint, WidgetBackground, WidgetElement } from "@statly/contract";
import type { CSSProperties } from "react";

const THEME_PAINTS: Record<string, string> = {
  text: "var(--statly-text)",
  muted: "var(--statly-muted)",
  accent: "var(--statly-accent)",
  card: "var(--statly-card)",
};

/** Theme colors follow the active theme, fixed colors stay as chosen. */
export function paintValue(paint: Paint): string {
  return THEME_PAINTS[paint] ?? paint;
}

export function boxStyle(
  box: Pick<WidgetElement, "x" | "y" | "w" | "h">,
  opacity = 1,
  rotation = 0,
): CSSProperties {
  return {
    position: "absolute",
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    opacity,
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
  };
}

/**
 * Text scales with the smaller of height and width, relative to the size it was designed at.
 * So it still fits when a widget gets narrow, instead of running out of its box.
 */
export function textStyle(
  element: {
    size: number;
    bold: boolean;
    align: "left" | "center" | "right";
    color: Paint;
  },
  aspect: number,
): CSSProperties {
  return {
    fontSize: `min(${element.size}cqh, ${element.size * aspect}cqw)`,
    fontWeight: element.bold ? 700 : 400,
    textAlign: element.align,
    color: paintValue(element.color),
    lineHeight: 1.15,
  };
}

export function backgroundStyle(background: WidgetBackground, mediaUrl?: string): CSSProperties {
  switch (background.kind) {
    case "color":
      return { background: background.color };
    case "gradient":
      return {
        background: `linear-gradient(${background.angle}deg, ${background.start}, ${background.end})`,
      };
    case "media": {
      const shade = `rgb(0 0 0 / ${Math.round(background.shade * 100)}%)`;
      const picture = background.asset.type.startsWith("image/") && mediaUrl;
      return picture
        ? {
            backgroundImage: `linear-gradient(${shade}, ${shade}), url("${mediaUrl}")`,
            backgroundSize: background.fit,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }
        : { background: "#000000" };
    }
    default:
      return { background: "var(--statly-card)" };
  }
}

/** Share of a goal reached, from 0 to 1. Values past the goal stay at a full ring. */
export function progressShare(value: number, goal: number): number {
  return Math.max(0, Math.min(1, value / goal));
}
