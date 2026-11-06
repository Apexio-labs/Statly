import type { Settings } from "@statly/contract";
import aeroSky from "@statly/ui/assets/aero/wallpaper.jpg";
import { useAppearance } from "../../lib/appearance.tsx";
import { useMedia } from "../widgets/useCustomWidgets.ts";

export type ShownWallpaper = {
  kind: "image" | "video";
  url: string;
  /** The user's own file, as opposed to the Frutiger Aero sky. */
  own: boolean;
  settings: Settings["wallpaper"];
};

/** What lies behind Statly right now, or null where the theme shows its own background. */
export function useWallpaper(): ShownWallpaper | null {
  const { settings } = useAppearance();
  const wallpaper = settings.wallpaper;
  const url = useMedia(wallpaper.asset?.id);
  if (!wallpaper.enabled || wallpaper.source === "none") {
    return null;
  }
  if (wallpaper.source === "aero") {
    return { kind: "image", url: aeroSky, own: false, settings: wallpaper };
  }
  if (!url || !wallpaper.asset) {
    return null;
  }
  const kind = wallpaper.asset.type.startsWith("video/") ? "video" : "image";
  return { kind, url, own: true, settings: wallpaper };
}

export const AERO_SKY = aeroSky;
