import { useTranslation } from "@statly/i18n";
import orb from "@statly/ui/assets/aero/logo-orb.png";
import logo from "@statly/ui/assets/Statly_Logo_Cropped_Dark.png";
import icon from "@statly/ui/assets/Statly_Logo_Icon.png";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router";
import { bridge } from "../bridge/index.ts";
import {
  AiIcon,
  GoalsIcon,
  HomeIcon,
  LibraryIcon,
  SettingsIcon,
  StatisticsIcon,
  type ThemedIcon,
} from "../components/icons.tsx";
import { AiPanel } from "../features/ai/AiPanel.tsx";
import { useAiChangesApply } from "../features/ai/useAi.ts";
import { ChangeNotice } from "../features/changes/ChangeNotice.tsx";
import { useGoalUpdates } from "../features/goals/useGoals.ts";
import { OnboardingDialog } from "../features/onboarding/OnboardingDialog.tsx";
import { RatingDialog } from "../features/onboarding/RatingDialog.tsx";
import { ReleaseNotesDialog, useReleaseNotes } from "../features/onboarding/ReleaseNotesDialog.tsx";
import { ShareDialog } from "../features/onboarding/ShareDialog.tsx";
import { WallpaperLayer } from "../features/wallpaper/WallpaperLayer.tsx";
import { useAero, useAppearance } from "../lib/appearance.tsx";
import { useStatisticsUpdates } from "../lib/calls.ts";
import { type RailKind, ShellContext } from "./ShellContext.tsx";
import {
  clamp,
  SETTINGS_RAIL_WIDTH,
  SIDEBAR_COMPACT_BELOW,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  snapped,
  WIDGET_RAIL_MAX,
  WIDGET_RAIL_MIN,
} from "./sidebar.ts";

const NARROW_WINDOW = 600;
const KEYBOARD_STEP = 16;
const HIGHLIGHT_DELAY_MS = 250;
const HIGHLIGHT_MS = 3400;
const NAV_ITEM =
  "statly-nav-item flex h-[38px] min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent text-[13px] font-semibold whitespace-nowrap text-nav-text no-underline transition-colors hover:bg-nav-hover";

function NavItem({
  to,
  end,
  icon: Icon,
  label,
  compact,
}: {
  to: string;
  end: boolean;
  icon: ThemedIcon;
  label: string;
  compact: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={compact ? label : undefined}
      aria-label={label}
      className={({ isActive }) =>
        `${NAV_ITEM} ${compact ? "justify-center" : "px-3"} ${isActive ? "bg-nav-hover" : ""}`
      }
    >
      <Icon size={17} className="shrink-0" />
      {compact ? null : label}
    </NavLink>
  );
}

function Brand({ compact }: { compact: boolean }) {
  const aero = useAero();
  if (aero) {
    return (
      <span className="statly-aero-brand" data-compact={compact || undefined}>
        <img src={orb} alt="Statly" />
        {compact ? null : <span aria-hidden="true">Statly</span>}
      </span>
    );
  }
  return (
    <img src={compact ? icon : logo} alt="Statly" className={compact ? "w-[30px]" : "w-[150px]"} />
  );
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(innerWidth);
  useEffect(() => {
    const update = () => setWidth(innerWidth);
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return width;
}

export function Shell() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  useStatisticsUpdates();
  useGoalUpdates();
  useHostNavigation();
  useAiChangesApply();
  const releaseNotes = useReleaseNotes();

  const [rail, setRail] = useState<RailKind | null>(null);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMounted, setAiMounted] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const windowWidth = useWindowWidth();

  const resizingRail = rail === "widgets";
  const forcedCompact = rail !== null || windowWidth < NARROW_WINDOW;
  const sidebarWidth = forcedCompact ? SIDEBAR_MIN : (dragged ?? settings.sidebarWidth);
  const railWidth =
    rail === "settings"
      ? SETTINGS_RAIL_WIDTH
      : rail === "widgets"
        ? (dragged ?? settings.widgetRailWidth)
        : 0;
  const compact = sidebarWidth < SIDEBAR_COMPACT_BELOW;
  const [minimum, maximum] = resizingRail
    ? [WIDGET_RAIL_MIN, WIDGET_RAIL_MAX]
    : [SIDEBAR_MIN, SIDEBAR_MAX];
  const handleDisabled = rail === "settings" || (windowWidth < NARROW_WINDOW && !resizingRail);

  function commit(width: number) {
    update(resizingRail ? { widgetRailWidth: width } : { sidebarWidth: width });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (handleDisabled) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: resizingRail ? railWidth : sidebarWidth,
    };
    setDragged(drag.current.startWidth);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      const width = drag.current.startWidth + event.clientX - drag.current.startX;
      setDragged(clamp(width, minimum, maximum));
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (dragged !== null) {
      commit(snapped(dragged, minimum, maximum));
    }
    setDragged(null);
  }

  function stepWidth(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -KEYBOARD_STEP, ArrowRight: KEYBOARD_STEP }[event.key];
    if (step && !handleDisabled) {
      const current = resizingRail ? railWidth : sidebarWidth;
      commit(clamp(current + step, minimum, maximum));
      event.preventDefault();
    }
  }

  const openAi = useCallback(() => {
    setAiMounted(true);
    setAiOpen(true);
  }, []);

  useAssistantRequest(openAi);
  useEffect(
    () =>
      bridge.on("host.toggleAssistant", () => {
        setAiMounted(true);
        setAiOpen((open) => !open);
      }),
    [],
  );
  useStrayDrops();

  const shell = useMemo(() => ({ railHost, setRail, openAi }), [railHost, openAi]);
  const animated = dragged === null ? "transition-[width] duration-[240ms] ease-out" : "";

  return (
    <ShellContext.Provider value={shell}>
      <WallpaperLayer />
      <div className="statly-shell flex h-full bg-window p-[3px]">
        <aside
          data-testid="sidebar"
          className={`statly-sidebar flex h-full shrink-0 overflow-hidden rounded-card bg-nav ${animated}`}
          style={{ width: sidebarWidth + railWidth }}
        >
          <nav
            className={`flex h-full shrink-0 flex-col gap-2 ${compact ? "px-[7px] py-3" : "px-2.5 py-3.5"} ${animated}`}
            style={{ width: sidebarWidth }}
            aria-label="Statly"
          >
            <div
              className={`mb-1 flex shrink-0 items-center justify-center ${compact ? "h-[72px]" : "h-[92px]"}`}
            >
              <Brand compact={compact} />
            </div>
            <NavItem to="/" end icon={HomeIcon} label={t("nav.dashboard")} compact={compact} />
            <NavItem
              to="/library"
              end={false}
              icon={LibraryIcon}
              label={t("nav.library")}
              compact={compact}
            />
            <button
              type="button"
              title={compact ? t("nav.ankiStatistics") : undefined}
              aria-label={t("nav.ankiStatistics")}
              onClick={() => void bridge.call("system.openAnkiStatistics", {})}
              className={`${NAV_ITEM} ${compact ? "justify-center" : "px-3"}`}
            >
              <StatisticsIcon size={17} className="shrink-0" />
              {compact ? null : t("nav.ankiStatistics")}
            </button>
            <NavItem
              to="/goals"
              end={false}
              icon={GoalsIcon}
              label={t("nav.goals")}
              compact={compact}
            />
            {/* The assistant is a companion rather than a page, so it stands a little apart. */}
            <div
              aria-hidden="true"
              className="statly-nav-divider mx-3 my-2 h-px shrink-0 bg-nav-text/15"
            />
            <button
              type="button"
              title={compact ? t("nav.ai") : undefined}
              aria-label={t("nav.ai")}
              aria-pressed={aiOpen}
              onClick={() => (aiOpen ? setAiOpen(false) : openAi())}
              className={`${NAV_ITEM} ${compact ? "justify-center" : "px-3"} ${aiOpen ? "bg-nav-hover" : ""}`}
            >
              <AiIcon size={17} className="shrink-0" />
              {compact ? null : t("nav.ai")}
            </button>
            <div className="mt-auto">
              <NavItem
                to="/settings"
                end={false}
                icon={SettingsIcon}
                label={t("nav.settings")}
                compact={compact}
              />
            </div>
          </nav>
          <div
            ref={setRailHost}
            data-rail={rail ?? "none"}
            className={`h-full min-w-0 shrink-0 overflow-hidden ${
              rail === "settings" ? "bg-page text-text" : "border-l border-white/30 text-nav-text"
            } ${animated}`}
            style={{ width: railWidth }}
          />
        </aside>
        {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged or focused. */}
        <div
          role="separator"
          tabIndex={handleDisabled ? undefined : 0}
          aria-orientation="vertical"
          aria-label={t("nav.resize")}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={resizingRail ? railWidth : sidebarWidth}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={stepWidth}
          data-testid="sidebar-handle"
          className={`w-[7px] shrink-0 touch-none outline-none focus-visible:bg-accent/40 ${
            handleDisabled ? "" : "cursor-col-resize"
          }`}
        />
        <main
          data-scroll-area
          // Marks the page as scrolled without a render, for the strip behind a sticky bar.
          onScroll={(event) =>
            event.currentTarget.toggleAttribute("data-scrolled", event.currentTarget.scrollTop > 4)
          }
          className="statly-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-card bg-page statly-scroll"
        >
          <Outlet />
        </main>
        {aiMounted ? (
          <AiPanel
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            onClosed={() => setAiMounted(false)}
          />
        ) : null}
      </div>
      <ChangeNotice />
      <OnboardingDialog />
      {/* After a big update the notes come first; the requests for a rating wait for the next visit. */}
      {releaseNotes === undefined ? null : releaseNotes.length > 0 ? (
        <ReleaseNotesDialog releases={releaseNotes} />
      ) : (
        <>
          <RatingDialog />
          <ShareDialog />
        </>
      )}
    </ShellContext.Provider>
  );
}

/** A shortcut in Anki opens the assistant through the address while Statly is still closed. */
function useAssistantRequest(openAi: () => void) {
  const [search, setSearch] = useSearchParams();
  useEffect(() => {
    if (search.has("assistant")) {
      setSearch({}, { replace: true });
      openAi();
    }
  }, [search, setSearch, openAi]);
}

/** A file dropped where nothing takes it would make the browser open it in place of Statly. */
function useStrayDrops() {
  useEffect(() => {
    function stop(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    }
    addEventListener("dragover", stop);
    addEventListener("drop", stop);
    return () => {
      removeEventListener("dragover", stop);
      removeEventListener("drop", stop);
    };
  }, []);
}

/** Lets Anki's menus and shortcuts open a page. */
function useHostNavigation() {
  const navigate = useNavigate();
  useEffect(
    () =>
      bridge.on("host.navigate", ({ path, highlight }) => {
        void navigate(path);
        if (highlight) {
          setTimeout(() => pointAt(highlight), HIGHLIGHT_DELAY_MS);
        }
      }),
    [navigate],
  );
}

function pointAt(name: string) {
  const target = document.querySelector(`[data-highlight="${name}"]`);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
  target?.classList.add("statly-pulse");
  setTimeout(() => target?.classList.remove("statly-pulse"), HIGHLIGHT_MS);
}
