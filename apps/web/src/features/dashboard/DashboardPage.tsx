import { type DeviceKind, defaultLayout, deviceColumns, gridColumns } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import {
  EditIcon,
  MobileIcon,
  MonitorIcon,
  TabletIcon,
  type ThemedIcon,
} from "../../components/icons.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard.tsx";
import { useRail } from "../../shell/ShellContext.tsx";
import { useGoals } from "../goals/useGoals.ts";
import { renderWidget, useWidgetTitle } from "../widgets/renderWidget.tsx";
import { useCustomWidgets, useMedia } from "../widgets/useCustomWidgets.ts";
import { DeckPicker } from "./DeckPicker.tsx";
import { readDashboardFile } from "./dashboardFile.ts";
import { useCardOffer } from "./devices/CardOffer.tsx";
import { DeviceStage } from "./devices/DeviceStage.tsx";
import {
  type Device,
  devicesOf,
  deviceWidgetFrom,
  useDeviceDraft,
  withDeviceWidgets,
} from "./devices/useDeviceDraft.ts";
import { DashboardGrid } from "./grid/DashboardGrid.tsx";
import { addWidget, newWidget, removeWidget, rulesOfWidgets } from "./grid/engine.ts";
import { RangeFilter } from "./RangeFilter.tsx";
import { ALL_DECKS, deckIdOf, rangeOf, useDashboardFilters } from "./useDashboardFilters.ts";
import { useLayout } from "./useLayout.ts";
import { WidgetRail } from "./WidgetRail.tsx";

const NARROW_QUERY = "(max-width: 600px)";
const DEVICES: [Device, ThemedIcon][] = [
  ["desktop", MonitorIcon],
  ["tablet", TabletIcon],
  ["phone", MobileIcon],
];

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function DevicePicker({
  device,
  onChange,
}: {
  device: Device;
  onChange: (device: Device) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t("devices.choose")} className="mr-1 flex gap-1">
      {DEVICES.map(([name, Icon]) => (
        // biome-ignore lint/a11y/useSemanticElements: buttons read better here than radio inputs.
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={device === name}
          aria-label={t(`devices.${name}`)}
          title={t(`devices.${name}`)}
          onClick={() => onChange(name)}
          className={`grid size-10 cursor-pointer place-items-center rounded-control border ${
            device === name
              ? "border-transparent bg-selected text-accent-strong"
              : "border-line bg-control text-muted hover:bg-hover"
          }`}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { paletteKey, settings } = useAppearance();
  const filters = useDashboardFilters();
  const stored = useLayout();
  const { draft, setDraft, device, begin, switchTo, followDesktop, resetTo, close, dirty } =
    useDeviceDraft();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const startAt = useRef<Device | null>(null);
  const editing = draft !== null;
  const railHost = useRail(editing ? "widgets" : null);

  const today = useStatistic("statistics.today", {});
  const decks = useStatistic("statistics.decks", {});
  const { widgets: customWidgets } = useCustomWidgets();
  const goals = useGoals();
  const rulesOf = useMemo(() => rulesOfWidgets(customWidgets), [customWidgets]);
  const titleOf = useWidgetTitle(customWidgets);
  const [search, setSearch] = useSearchParams();
  const narrow = useNarrowWindow();
  const desktop = draft?.desktop ?? stored.layout;
  const narrowLayout = useQuery({
    queryKey: ["dashboard.devices", "narrow", stored.layout],
    enabled: narrow && !editing && stored.layout !== undefined,
    queryFn: () =>
      bridge.call("dashboard.devices", { layout: stored.layout as NonNullable<typeof desktop> }),
  });
  const useNarrow = narrow && !editing && narrowLayout.data !== undefined;
  const layout = useNarrow ? { widgets: narrowLayout.data?.phone.widgets ?? [] } : desktop;

  // The Statly menu in Anki's menu bar opens the import from anywhere.
  useEffect(() => {
    if (!search.has("import") || !stored.layout) {
      return;
    }
    setSearch({}, { replace: true });
    void bridge.call("system.openFile", {}).then(({ content }) => {
      const imported = content === null ? null : readDashboardFile(content);
      if (imported) {
        void begin(imported);
      }
    });
  }, [search, setSearch, stored.layout, begin]);

  // A shortcut in Anki starts editing, and the phone settings lead straight to the phone. The
  // address is cleaned up first: editing makes the guard ask before any address change.
  useEffect(() => {
    const wanted = search.has("edit") ? "desktop" : search.get("device");
    if (wanted) {
      startAt.current = wanted as Device;
      setSearch({}, { replace: true });
    }
  }, [search, setSearch]);

  useEffect(() => {
    const start = startAt.current;
    if (start && !search.has("edit") && !search.has("device") && stored.layout) {
      startAt.current = null;
      if (!editing) {
        void begin(stored.layout, start);
      }
    }
  }, [search, stored.layout, begin, editing]);

  async function storeDraft(): Promise<boolean> {
    if (!draft) {
      return true;
    }
    try {
      await stored.saveAll.mutateAsync({ layout: draft.desktop, devices: devicesOf(draft) });
    } catch {
      return false;
    }
    close();
    return true;
  }

  const guard = useUnsavedGuard({ dirty, save: storeDraft, samePage: true });
  const offer = useCardOffer();
  const backgrounds = settings.dashboardBackgrounds;
  const backgroundUrl = useMedia(backgrounds.desktop?.id);

  /** Leaving a phone or tablet is the moment to ask whether it should reach that device. */
  function leavingDevice(goOn: () => void) {
    if (device === "desktop") {
      goOn();
    } else {
      offer.offerBefore(goOn);
    }
  }

  function setDesktop(next: NonNullable<typeof desktop>) {
    if (draft) {
      setDraft({ ...draft, desktop: next });
    }
  }

  function addToCurrent(type: string) {
    if (!draft) {
      return;
    }
    if (device === "desktop") {
      setDesktop(addWidget(draft.desktop, type, rulesOf));
      return;
    }
    const widgets = draft.shown[device];
    const added = newWidget({ widgets }, type, rulesOf, deviceColumns[device]);
    setDraft(withDeviceWidgets(draft, device, [...widgets, deviceWidgetFrom(added)]));
  }

  // A remembered deck may have been deleted since. Then all decks show, without saving that.
  const savedDeck = filters.deck;
  const deckKnown =
    savedDeck === ALL_DECKS || decks.data?.some((deck) => String(deck.id) === savedDeck);
  const shownDeck = decks.data && !deckKnown ? ALL_DECKS : savedDeck;
  const ready = savedDeck === ALL_DECKS || decks.data !== undefined;
  const scope = today.data &&
    ready && {
      ...rangeOf({
        preset: filters.preset,
        custom: filters.custom,
        today: today.data.date,
        firstReview: today.data.firstReview,
      }),
      deckId: deckIdOf(shownDeck),
      themeKey: paletteKey,
      pickRange: filters.setCustom,
    };
  const other = (name: DeviceKind): DeviceKind => (name === "phone" ? "tablet" : "phone");

  return (
    <>
      <PageHeader title={t("pages.dashboard")}>
        {editing ? (
          <>
            <DevicePicker
              device={device}
              onChange={(next) => {
                if (next === "desktop") {
                  leavingDevice(() => void switchTo(next));
                } else {
                  void switchTo(next);
                }
              }}
            />
            <Button onClick={() => guard.leave(close)}>{t("dashboard.cancel")}</Button>
            <Button primary onClick={() => leavingDevice(() => void storeDraft())}>
              {t("dashboard.save")}
            </Button>
          </>
        ) : (
          <Button primary onClick={() => stored.layout && void begin(stored.layout)}>
            <EditIcon size={15} />
            {t("dashboard.edit")}
          </Button>
        )}
      </PageHeader>
      {backgroundUrl && device === "desktop" ? (
        <div
          data-testid="dashboard-background"
          aria-hidden="true"
          className="pointer-events-none sticky top-0 -z-0 -mb-[100vh] h-screen bg-cover bg-center"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : null}
      <div className="relative px-4 pb-6">
        {editing && device !== "desktop" ? null : (
          <>
            <div className="flex flex-wrap gap-2">
              {today.data ? (
                <RangeFilter
                  filters={filters}
                  today={today.data.date}
                  firstReview={today.data.firstReview}
                />
              ) : null}
              <DeckPicker decks={decks.data ?? []} value={shownDeck} onChange={filters.setDeck} />
            </div>
            <p className="mt-4 mb-6 text-[13px] text-muted">{t("dashboard.intro")}</p>
          </>
        )}
        {draft && device !== "desktop" && scope ? (
          <DeviceStage
            device={device}
            widgets={draft.shown[device]}
            other={draft.shown[other(device)]}
            automatic={draft[device] === null}
            scope={scope}
            rulesOf={rulesOf}
            titleOf={titleOf}
            onChange={(widgets) => setDraft(withDeviceWidgets(draft, device, widgets))}
            onFollowDesktop={() => void followDesktop(device)}
          />
        ) : null}
        {layout && scope && (!editing || device === "desktop") ? (
          <DashboardGrid
            layout={layout}
            columns={useNarrow ? deviceColumns.phone : gridColumns}
            editing={editing}
            rulesOf={rulesOf}
            renderWidget={renderWidget}
            titleOf={titleOf}
            onChange={setDesktop}
            onRemove={(id) => setDesktop(removeWidget(layout, id))}
            scope={scope}
          />
        ) : null}
      </div>
      {guard.dialog}
      {offer.dialog}
      {confirmingReset ? (
        <ConfirmDialog
          title={t("settings.resetConfirmTitle")}
          body={t("dashboard.resetDraftBody")}
          confirm={t("settings.resetConfirm")}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => {
            setConfirmingReset(false);
            void resetTo(defaultLayout);
          }}
        />
      ) : null}
      {draft && railHost
        ? createPortal(
            <WidgetRail
              layout={draft.desktop}
              customWidgets={customWidgets}
              goals={goals.data ?? []}
              onAdd={addToCurrent}
              onImport={setDesktop}
              onReset={() => setConfirmingReset(true)}
            />,
            railHost,
          )
        : null}
    </>
  );
}
