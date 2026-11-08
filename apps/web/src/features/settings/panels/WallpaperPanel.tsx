import {
  defaultWallpaper,
  MAX_DROPPED_IMAGE_CHARS,
  type MediaAsset,
  type Settings,
  WALLPAPER_HISTORY,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { Select } from "../../../components/Select.tsx";
import { useAero, useAppearance } from "../../../lib/appearance.tsx";
import { AERO_SKY, type ShownWallpaper, useWallpaper } from "../../wallpaper/useWallpaper.ts";
import { WallpaperPicture } from "../../wallpaper/WallpaperLayer.tsx";
import { useMedia } from "../../widgets/useCustomWidgets.ts";
import { Card, Panel, Row, Toggle, useDeleteWhilePointed } from "../parts.tsx";

const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|video\/.+)$/;
const FILE_ENDINGS = /\.(png|jpe?g|jfif|gif|webp|mp4|m4v|mov|webm)$/i;
const PICTURE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const SCROLL_STEP = 320;

/**
 * A picture's content as base64, sent along with a drop. Statly takes the dropped file's path
 * where the window sees the drop, but on some Windows setups it does not, and then this is used.
 * Videos and very large files cannot travel this way.
 */
function pictureData(file: File): Promise<string | undefined> {
  const isPicture =
    PICTURE_TYPES.test(file.type) || /\.(jpe?g|jfif|png|gif|webp)$/i.test(file.name);
  if (!isPicture || (file.size * 4) / 3 > MAX_DROPPED_IMAGE_CHARS - 4) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.includes(",") ? url.slice(url.indexOf(",") + 1) : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

/** The page only sorts out what is plainly no picture or video. Python checks the content. */
export function suitsAsWallpaper(file: Pick<File, "name" | "type">) {
  return FILE_TYPES.test(file.type) || FILE_ENDINGS.test(file.name);
}

function HistoryTile({
  label,
  picture,
  active,
  onPick,
  onForget,
}: {
  label: string;
  picture: ShownWallpaper | null;
  active: boolean;
  onPick: () => void;
  onForget?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="statly-wallpaper-tile relative shrink-0 snap-start">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onPick}
        className={`relative block h-[78px] w-[138px] cursor-pointer overflow-hidden rounded-control border-2 bg-page p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          active ? "border-accent" : "border-line hover:border-accent/60"
        }`}
      >
        {picture ? <WallpaperPicture wallpaper={picture} className="absolute inset-0" /> : null}
      </button>
      {onForget ? (
        <button
          type="button"
          aria-label={t("settings.wallpaperForget", { name: label })}
          title={t("settings.wallpaperForget", { name: label })}
          onClick={onForget}
          className="statly-close absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full border border-line bg-card text-muted shadow-card hover:text-danger"
        >
          <X size={11} />
        </button>
      ) : null}
    </div>
  );
}

function OwnTile({
  asset,
  index,
  settings,
  active,
  onPick,
  onForget,
}: {
  asset: MediaAsset;
  index: number;
  settings: Settings["wallpaper"];
  active: boolean;
  onPick: () => void;
  onForget: () => void;
}) {
  const { t } = useTranslation();
  const url = useMedia(asset.id);
  const kind = asset.type.startsWith("video/") ? "video" : "image";
  // Thumbnails stay sharp and bright, so they can be told apart at a glance.
  const look = { ...settings, blur: 0, overlay: 0, loop: false };
  return (
    <HistoryTile
      label={t("settings.wallpaperNumbered", { number: index + 1 })}
      picture={url ? { kind, url, own: true, settings: look } : null}
      active={active}
      onPick={onPick}
      onForget={onForget}
    />
  );
}

export function WallpaperPanel() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const aero = useAero();
  const client = useQueryClient();
  const shown = useWallpaper();
  const [dragging, setDragging] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [rejected, setRejected] = useState(false);
  const strip = useRef<HTMLUListElement>(null);
  const wallpaper = settings.wallpaper;
  const changed = (next: Settings) => {
    setRejected(false);
    client.setQueryData(["settings"], next);
  };
  const choose = useMutation({
    mutationFn: () => bridge.call("wallpaper.choose", {}),
    onSuccess: changed,
  });
  const drop = useMutation({
    mutationFn: (image: string | undefined) =>
      bridge.call("wallpaper.dropped", image === undefined ? {} : { image }),
    onSuccess: changed,
  });
  const remove = useMutation({
    mutationFn: () => bridge.call("wallpaper.remove", {}),
    onSuccess: changed,
  });
  const pick = useMutation({
    mutationFn: (id: string) => bridge.call("wallpaper.use", { id }),
    onSuccess: changed,
  });
  const forget = useMutation({
    mutationFn: (id: string) => bridge.call("wallpaper.forget", { id }),
    onSuccess: changed,
  });
  const loop = useMutation({
    /** A video only needs its setting. A GIF carries its looping inside the file. */
    mutationFn: async (next: boolean) => {
      const asset = wallpaper.asset;
      const updated =
        asset?.type === "image/gif"
          ? await bridge.call("widgets.setGifLoop", { id: asset.id, loop: next })
          : asset;
      const history = wallpaper.history.map((entry) =>
        entry.id === asset?.id && updated ? updated : entry,
      );
      update({ wallpaper: { ...wallpaper, asset: updated, loop: next, history } });
    },
  });

  function set(patch: Partial<Settings["wallpaper"]>) {
    update({ wallpaper: { ...wallpaper, ...patch } });
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    if (suitsAsWallpaper(file)) {
      void pictureData(file).then((image) => drop.mutate(image));
    } else {
      setRejected(true);
    }
  }

  const busy = choose.isPending || drop.isPending;
  const chosenNow = wallpaper.enabled && wallpaper.source !== "none";
  const deleting = useDeleteWhilePointed(chosenNow && !busy ? () => remove.mutate() : null);
  const failed = rejected || choose.isError || drop.isError;
  const chosen = wallpaper.enabled && wallpaper.source !== "none";
  const moving =
    wallpaper.asset?.type.startsWith("video/") || wallpaper.asset?.type === "image/gif";
  const sky: ShownWallpaper = { kind: "image", url: AERO_SKY, own: false, settings: wallpaper };
  const preview = shown ?? (aero && !chosen ? sky : null);
  // A file chosen before there was a history still belongs in it.
  const history =
    wallpaper.asset && !wallpaper.history.some((entry) => entry.id === wallpaper.asset?.id)
      ? [wallpaper.asset, ...wallpaper.history]
      : wallpaper.history;
  const label = busy
    ? t("settings.wallpaperWorking")
    : chosen
      ? t("settings.wallpaperReplace")
      : t("settings.wallpaperDrop");

  return (
    <Panel
      title={t("settings.sections.wallpaper.title")}
      note={t("settings.sections.wallpaper.note")}
    >
      <Card>
        <button
          type="button"
          aria-label={t("settings.wallpaperPreview")}
          aria-busy={busy}
          disabled={busy}
          data-testid="wallpaper-drop"
          data-dragging={dragging || undefined}
          title={chosenNow ? t("settings.wallpaperDeleteHint") : undefined}
          {...deleting}
          onClick={() => {
            setRejected(false);
            choose.mutate();
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`statly-wallpaper-drop group relative block h-48 w-full cursor-pointer overflow-hidden rounded-control border-2 border-dashed bg-page p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-progress ${
            dragging ? "border-accent" : preview ? "border-transparent" : "border-line"
          }`}
        >
          {preview ? <WallpaperPicture wallpaper={preview} className="absolute inset-0" /> : null}
          {!chosen && aero ? (
            <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white">
              {t("settings.wallpaperThemeDefault")}
            </span>
          ) : null}
          <span
            className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-4 py-3 text-center text-[13px] font-semibold transition-opacity ${
              preview
                ? `bg-gradient-to-t from-black/70 to-transparent text-white ${
                    dragging || busy ? "" : "opacity-80 group-hover:opacity-100"
                  }`
                : "inset-y-0 justify-center text-muted"
            }`}
          >
            {preview ? null : (
              <span className="text-[15px] text-text">{t("settings.wallpaperNone")}</span>
            )}
            {label}
          </span>
        </button>
        {failed ? (
          <div
            role="alert"
            className="mt-3 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            <p className="m-0 font-bold">{t("settings.wallpaperUnsupported")}</p>
            <p className="m-0 mt-0.5">{t("settings.wallpaperLimits")}</p>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button aria-expanded={browsing} onClick={() => setBrowsing(!browsing)}>
            {t("settings.wallpaperHistory")}
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={`transition-transform ${browsing ? "rotate-180" : ""}`}
            />
          </Button>
          {chosen ? (
            <Button className="text-danger" onClick={() => remove.mutate()}>
              {t("settings.wallpaperRemove")}
            </Button>
          ) : null}
        </div>
        <div className="statly-fold" data-open={browsing || undefined} inert={!browsing}>
          <div className="min-h-0 overflow-hidden">
            <div className="relative mt-3 flex items-center gap-1">
              <button
                type="button"
                aria-label={t("settings.wallpaperEarlier")}
                onClick={() => strip.current?.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" })}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-control text-muted hover:bg-hover"
              >
                <ChevronLeft size={16} />
              </button>
              <ul
                ref={strip}
                aria-label={t("settings.wallpaperHistory")}
                className="statly-no-scrollbar m-0 flex min-w-0 flex-1 list-none snap-x gap-2.5 overflow-x-auto p-0 py-1"
              >
                <li>
                  <HistoryTile
                    label={t("settings.wallpaperSample")}
                    picture={{ ...sky, settings: { ...wallpaper, blur: 0, overlay: 0 } }}
                    active={chosen && wallpaper.source === "aero"}
                    onPick={() => set({ source: "aero", enabled: true })}
                  />
                </li>
                {history.map((asset, index) => (
                  <li key={asset.id}>
                    <OwnTile
                      asset={asset}
                      index={index}
                      settings={wallpaper}
                      active={
                        chosen && wallpaper.source === "image" && wallpaper.asset?.id === asset.id
                      }
                      onPick={() => pick.mutate(asset.id)}
                      onForget={() => forget.mutate(asset.id)}
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                aria-label={t("settings.wallpaperLater")}
                onClick={() => strip.current?.scrollBy({ left: SCROLL_STEP, behavior: "smooth" })}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-control text-muted hover:bg-hover"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <p className="m-0 mt-1 text-[11px] text-muted">
              {t("settings.wallpaperHistoryNote", { count: WALLPAPER_HISTORY })}
            </p>
          </div>
        </div>
      </Card>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[13px]">
            {t("settings.wallpaperBlur")}
            <input
              type="range"
              min={0}
              max={20}
              value={wallpaper.blur}
              onChange={(event) => set({ blur: Number(event.target.value) })}
              className="mt-2 block w-full accent-[var(--statly-accent)]"
            />
            <output className="block text-right text-xs text-muted">{wallpaper.blur} px</output>
          </label>
          <label className="text-[13px]">
            {t("settings.wallpaperOverlay")}
            <input
              type="range"
              min={0}
              max={70}
              value={wallpaper.overlay}
              onChange={(event) => set({ overlay: Number(event.target.value) })}
              className="mt-2 block w-full accent-[var(--statly-accent)]"
            />
            <output className="block text-right text-xs text-muted">{wallpaper.overlay}%</output>
          </label>
          <Row title={t("settings.wallpaperPosition")}>
            <Select
              label={t("settings.wallpaperPosition")}
              value={wallpaper.position}
              onChange={(position) => set({ position })}
              options={(["center", "top", "bottom"] as const).map((position) => ({
                value: position,
                label: t(`settings.positions.${position}`),
              }))}
            />
          </Row>
          <Row title={t("settings.wallpaperText")}>
            <Select
              label={t("settings.wallpaperText")}
              value={wallpaper.textColor}
              onChange={(textColor) => set({ textColor })}
              options={(["dark", "light"] as const).map((color) => ({
                value: color,
                label: t(`settings.textColors.${color}`),
              }))}
            />
          </Row>
        </div>
        <div className="mt-5 flex flex-col gap-4 border-t border-line pt-4">
          <Row
            title={t("settings.wallpaperDeckOverview")}
            note={t("settings.wallpaperDeckOverviewNote")}
          >
            <Toggle
              label={t("settings.wallpaperDeckOverview")}
              checked={wallpaper.deckOverview}
              onChange={(deckOverview) => set({ deckOverview })}
            />
          </Row>
          {moving ? (
            <Row title={t("settings.wallpaperLoop")} note={t("settings.wallpaperLoopNote")}>
              <Toggle
                label={t("settings.wallpaperLoop")}
                checked={wallpaper.loop}
                disabled={loop.isPending}
                onChange={(next) => loop.mutate(next)}
              />
            </Row>
          ) : null}
        </div>
        <Button
          className="mt-5"
          onClick={() =>
            set({
              blur: defaultWallpaper.blur,
              overlay: defaultWallpaper.overlay,
              position: defaultWallpaper.position,
              textColor: defaultWallpaper.textColor,
            })
          }
        >
          {t("settings.wallpaperDefaults")}
        </Button>
      </Card>
    </Panel>
  );
}
