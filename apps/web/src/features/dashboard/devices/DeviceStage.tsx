import { type Block, renderBlock } from "@statly/card-viewer";
import "@statly/card-viewer/card.css";
import {
  type DeviceKind,
  type DeviceWidget,
  deviceColumns,
  deviceTimeless,
  type MobileSnapshot,
  mobilePeriods,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Moon, RotateCcw, Sun, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { DashboardGrid } from "../grid/DashboardGrid.tsx";
import type { RulesOf } from "../grid/engine.ts";
import type { WidgetScope } from "../widgets.tsx";

const FRAME_WIDTH: Record<DeviceKind, number> = { tablet: 768, phone: 390 };
const CARD_GAP = 10;
const BEZEL = 10;

function DrawnBlock({
  block,
  cells,
  words,
}: {
  block: Block | undefined;
  cells: DeviceWidget;
  words: MobileSnapshot["words"] | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (block && words) {
      host.current?.replaceChildren(renderBlock(block, cells, words));
    }
  }, [block, cells, words]);
  return <div ref={host} className="pointer-events-none h-full" />;
}

function blockKey(widget: DeviceWidget): string {
  return `${widget.type}|${widget.period}`;
}

/** The card's own data. Moving a tile changes nothing it shows, so that asks for nothing new. */
function useCardData(tablet: DeviceWidget[], phone: DeviceWidget[]) {
  const wanted = [...new Set([...tablet, ...phone].map(blockKey))].sort().join(",");
  return useQuery({
    queryKey: ["mobile.preview", wanted],
    placeholderData: keepPreviousData,
    queryFn: () => bridge.call("mobile.preview", { tablet, phone }),
  });
}

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-9 cursor-pointer rounded-control border text-xs font-semibold ${
        active
          ? "border-transparent bg-selected text-accent-strong"
          : "border-line bg-control text-text hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}

export function DeviceStage({
  device,
  widgets,
  other,
  automatic,
  scope,
  rulesOf,
  titleOf,
  onChange,
  onFollowDesktop,
}: {
  device: DeviceKind;
  widgets: DeviceWidget[];
  other: DeviceWidget[];
  automatic: boolean;
  scope: WidgetScope;
  rulesOf: RulesOf;
  titleOf: (type: string) => string;
  onChange: (widgets: DeviceWidget[]) => void;
  onFollowDesktop: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useAppearance();
  const [selected, setSelected] = useState<string | null>(null);
  const [night, setNight] = useState(theme === "dark");
  const tablet = device === "tablet" ? widgets : other;
  const phone = device === "phone" ? widgets : other;
  const card = useCardData(tablet, phone);
  const widget = widgets.find((item) => item.id === selected);
  const background = card.data?.backgrounds[device] ?? null;
  const hasVideo = Object.values(card.data?.blocks ?? {}).some(
    (block) =>
      block.kind === "custom" &&
      block.widget.elements.some(
        (element) => element.kind === "media" && element.asset.type.startsWith("video/"),
      ),
  );

  function update(patch: Partial<DeviceWidget>) {
    onChange(widgets.map((item) => (item.id === selected ? { ...item, ...patch } : item)));
  }

  return (
    <div className="flex items-start justify-center gap-3">
      <div
        data-testid="device-frame"
        data-device={device}
        className="min-w-0 shrink overflow-hidden rounded-[40px] bg-black shadow-card"
        style={{ width: FRAME_WIDTH[device] + 2 * BEZEL, padding: BEZEL }}
      >
        <div
          data-scroll-area
          data-testid="device-screen"
          className={`card overflow-y-auto rounded-[30px] statly-no-scrollbar ${night ? "nightMode" : ""} ${
            background ? "statly-has-background" : ""
          }`}
          style={{
            height: "calc(100vh - 210px)",
            maxHeight: 820,
            backgroundImage: background ? `url("${background}")` : undefined,
            backgroundAttachment: "local",
          }}
        >
          <div className="p-3.5 pt-7">
            <header className="statly-header">
              <h2 className="statly-title">{card.data?.title ?? "Statly"}</h2>
              <p className="statly-note">{card.data?.updated}</p>
            </header>
            <DashboardGrid
              layout={{ widgets }}
              columns={deviceColumns[device]}
              gap={CARD_GAP}
              editing
              scope={scope}
              rulesOf={rulesOf}
              titleOf={titleOf}
              selected={selected}
              onSelect={setSelected}
              onChange={(next) => onChange(next.widgets)}
              onRemove={(id) => onChange(widgets.filter((item) => item.id !== id))}
              renderWidget={(item) => (
                <DrawnBlock
                  block={card.data?.blocks[blockKey(item)]}
                  cells={item}
                  words={card.data?.words}
                />
              )}
            />
            <p className="statly-hint">{card.data?.hint}</p>
          </div>
        </div>
      </div>
      <aside className="flex w-[240px] shrink-0 flex-col gap-4 rounded-card border border-line bg-card p-4 shadow-card">
        <div>
          <h2 className="m-0 text-[13px] font-bold">{t(`devices.${device}`)}</h2>
          <p className="m-0 mt-1 text-xs text-muted">
            {t(automatic ? "devices.automatic" : "devices.arranged")}
          </p>
          {automatic ? null : (
            <Button className="mt-2 h-8" onClick={onFollowDesktop}>
              <RotateCcw size={14} />
              {t("devices.followDesktop")}
            </Button>
          )}
        </div>
        {widget ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <h3 className="m-0 text-[13px] font-bold">{titleOf(widget.type)}</h3>
            {deviceTimeless.includes(widget.type) ? null : (
              <div>
                <h4 className="m-0 mb-1.5 text-xs font-semibold text-muted">
                  {t("devices.period")}
                </h4>
                <div className="grid gap-1.5">
                  {mobilePeriods.map((period) => (
                    <Choice
                      key={period}
                      active={widget.period === period}
                      label={t(`dashboard.ranges.${period}`)}
                      onClick={() => update({ period })}
                    />
                  ))}
                </div>
              </div>
            )}
            <Button
              className="h-8 justify-center text-danger"
              onClick={() => {
                onChange(widgets.filter((item) => item.id !== widget.id));
                setSelected(null);
              }}
            >
              <Trash2 size={14} />
              {t("devices.remove")}
            </Button>
          </div>
        ) : (
          <p className="m-0 border-t border-line pt-3 text-xs text-muted">{t("devices.help")}</p>
        )}
        {hasVideo ? (
          <p data-testid="video-note" className="m-0 text-xs text-muted">
            {t("devices.videoNote")}
          </p>
        ) : null}
        <Button className="h-8 justify-center" onClick={() => setNight(!night)}>
          {night ? <Sun size={14} /> : <Moon size={14} />}
          {t(night ? "devices.showLight" : "devices.showDark")}
        </Button>
      </aside>
    </div>
  );
}
