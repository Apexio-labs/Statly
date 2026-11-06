import { useEffect } from "react";
import { type ShownWallpaper, useWallpaper } from "./useWallpaper.ts";

/** The picture itself, with its blur and shade. The settings preview draws the same thing. */
export function WallpaperPicture({
  wallpaper,
  className = "",
}: {
  wallpaper: ShownWallpaper;
  className?: string;
}) {
  const { blur, overlay, position, loop } = wallpaper.settings;
  const placed = { objectPosition: `center ${position}`, backgroundPosition: `center ${position}` };
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none overflow-hidden ${className}`}
      data-wallpaper-kind={wallpaper.kind}
    >
      <div
        className="absolute"
        style={{ inset: -blur * 2, filter: blur ? `blur(${blur}px)` : undefined }}
      >
        {wallpaper.kind === "video" ? (
          <video
            src={wallpaper.url}
            autoPlay
            muted
            playsInline
            loop={loop}
            className="block h-full w-full object-cover"
            style={placed}
          />
        ) : (
          <div
            className="h-full w-full bg-cover"
            style={{ ...placed, backgroundImage: `url("${wallpaper.url}")` }}
          />
        )}
      </div>
      {overlay ? (
        <div className="absolute inset-0" style={{ background: `rgb(0 0 0 / ${overlay}%)` }} />
      ) : null}
    </div>
  );
}

/**
 * Lies behind the whole window. It marks the page, so each theme can open up its own surfaces:
 * glass stays glass, and the solid themes let it shine through their frame and page.
 */
export function WallpaperLayer() {
  const wallpaper = useWallpaper();
  const mark = wallpaper ? (wallpaper.own ? "own" : "sky") : null;

  useEffect(() => {
    const root = document.documentElement;
    if (mark) {
      root.dataset.wallpaper = mark;
    } else {
      delete root.dataset.wallpaper;
    }
    return () => {
      delete root.dataset.wallpaper;
    };
  }, [mark]);

  return wallpaper ? (
    <WallpaperPicture wallpaper={wallpaper} className="statly-wallpaper fixed inset-0 -z-10" />
  ) : null;
}
