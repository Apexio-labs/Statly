import { defaultWallpaper, type Settings } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { Select } from "../../../components/Select.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { Card, Panel, Row, Toggle } from "../parts.tsx";

const PREVIEW_KEY = ["wallpaper.preview"];
const AERO_PREVIEW =
  "radial-gradient(ellipse at 70% 22%, rgba(101,219,255,.7), transparent 40%), linear-gradient(135deg,#123f75,#1689bb 55%,#81d8e8)";

export function WallpaperPanel() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const client = useQueryClient();
  const wallpaper = settings.wallpaper;
  const preview = useQuery({
    queryKey: PREVIEW_KEY,
    queryFn: () => bridge.call("wallpaper.preview", {}),
  });
  const choose = useMutation({
    mutationFn: () => bridge.call("wallpaper.choose", {}),
    onSuccess: async (result) => {
      client.setQueryData(PREVIEW_KEY, result);
      await client.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => bridge.call("wallpaper.remove", {}),
    onSuccess: async (result) => {
      client.setQueryData(PREVIEW_KEY, result);
      await client.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  function set(patch: Partial<Settings["wallpaper"]>) {
    update({ wallpaper: { ...wallpaper, ...patch } });
  }

  const background =
    wallpaper.source === "aero"
      ? AERO_PREVIEW
      : wallpaper.source === "image" && preview.data?.image
        ? `url("${preview.data.image}")`
        : AERO_PREVIEW;
  const hasImage = wallpaper.source !== "none";

  return (
    <Panel
      title={t("settings.sections.wallpaper.title")}
      note={t("settings.sections.wallpaper.note")}
    >
      <Card>
        <Row title={t("settings.wallpaperEnable")} note={t("settings.wallpaperEnableNote")}>
          <Toggle
            label={t("settings.wallpaperEnable")}
            checked={wallpaper.enabled}
            onChange={(enabled) => set({ enabled })}
          />
        </Row>
        <div
          className="relative mt-5 h-44 overflow-hidden rounded-control"
          role="img"
          aria-label={t("settings.wallpaperPreview")}
        >
          <div
            className="absolute bg-cover bg-center"
            style={{
              inset: -wallpaper.blur,
              backgroundImage: background,
              backgroundPosition: `center ${wallpaper.position}`,
              filter: `blur(${wallpaper.blur}px)`,
            }}
          />
          <div
            className="absolute inset-0"
            style={{ background: `rgb(0 0 0 / ${wallpaper.overlay}%)` }}
          />
          {hasImage ? null : (
            <p className="absolute inset-0 m-0 grid place-items-center text-[15px] font-semibold text-white">
              {t("settings.wallpaperNone")}
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => choose.mutate()}>{t("settings.wallpaperChoose")}</Button>
          <Button onClick={() => set({ source: "aero", enabled: true })}>
            {t("settings.wallpaperSample")}
          </Button>
          <Button onClick={() => remove.mutate()}>{t("settings.wallpaperRemove")}</Button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
        <p className="m-0 mt-4 text-xs text-muted">{t("settings.wallpaperLimits")}</p>
      </Card>
    </Panel>
  );
}
