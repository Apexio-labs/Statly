import { useTranslation } from "@statly/i18n";
import {
  History,
  type LucideIcon,
  MessageSquare,
  ScrollText,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button.tsx";
import { AiIcon } from "../../components/icons.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { ChatList } from "./ChatList.tsx";
import { ChatView } from "./ChatView.tsx";
import { HistoryView } from "./HistoryView.tsx";
import { LockedChat } from "./KeyLock.tsx";
import { useAiStatus } from "./useAi.ts";

const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const KEYBOARD_STEP = 16;
const OVERLAY_BELOW = 860;
const HANDLE = 7;

type View = "chat" | "chats" | "history";

const VIEWS: [View, LucideIcon][] = [
  ["chat", MessageSquare],
  ["chats", History],
  ["history", ScrollText],
];

/** The assistant's settings live under Settings, so this only points there. */
function SetupPrompt({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-start gap-3 p-4">
      <h3 className="m-0 text-[13px] font-bold">{t("ai.settings.startTitle")}</h3>
      <p className="m-0 text-[13px] text-muted">{t("ai.settings.startBody")}</p>
      <Button primary onClick={onOpen}>
        {t("ai.settings.start")}
      </Button>
    </div>
  );
}

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

export function AiPanel({
  open,
  onClose,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const status = useAiStatus();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("chat");
  const openSettings = () => void navigate("/settings/ai");
  const [dragged, setDragged] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(innerWidth < OVERLAY_BELOW);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const width = dragged ?? settings.aiPanelWidth;
  const [shown, setShown] = useState(false);

  // The first frame has to show the closed panel, or there would be nothing to animate from.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const check = () => setOverlay(innerWidth < OVERLAY_BELOW);
    addEventListener("resize", check);
    return () => removeEventListener("resize", check);
  }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    setDragged(width);
    event.preventDefault();
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      setDragged(clampWidth(drag.current.startWidth - event.clientX + drag.current.startX));
    }
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      if (dragged !== null) {
        update({ aiPanelWidth: dragged });
      }
      setDragged(null);
    }
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const change = { ArrowLeft: KEYBOARD_STEP, ArrowRight: -KEYBOARD_STEP }[event.key];
    if (change) {
      update({ aiPanelWidth: clampWidth(width + change) });
      event.preventDefault();
    }
  }

  const slide = dragged === null ? "statly-panel-slide" : "";
  const locked = status.data?.keyLock === "locked" && status.data.hasKey;

  return (
    <div
      data-testid="ai-panel-slot"
      className={`flex h-full shrink-0 justify-start overflow-hidden ${slide} ${
        overlay ? "fixed top-[3px] right-[3px] bottom-[3px] z-40" : ""
      }`}
      style={{
        width: shown ? (overlay ? `min(${width}px, calc(100vw - 6px))` : width + HANDLE) : 0,
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !shown && !open) {
          onClosed();
        }
      }}
    >
      {overlay ? null : (
        // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged or focused.
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("ai.resize")}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={step}
          className="w-[7px] shrink-0 cursor-col-resize touch-none outline-none focus-visible:bg-accent/40"
        />
      )}
      <aside
        data-testid="ai-panel"
        aria-label={t("ai.title")}
        className={`flex h-full shrink-0 flex-col overflow-hidden rounded-card bg-page text-text ${
          overlay ? "shadow-card" : ""
        }`}
        style={{ width: overlay ? `min(${width}px, calc(100vw - 6px))` : width }}
      >
        <header className="flex items-center gap-1 border-b border-line px-3 py-2.5">
          <AiIcon size={16} className="shrink-0 text-accent" />
          <h2 className="m-0 mr-auto truncate text-[13px] font-bold">{t("ai.title")}</h2>
          {VIEWS.map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              aria-label={t(`ai.views.${name}`)}
              aria-pressed={view === name}
              title={t(`ai.views.${name}`)}
              onClick={() => setView(name)}
              className={`grid size-8 cursor-pointer place-items-center rounded-control border-0 ${
                view === name
                  ? "bg-selected text-accent-strong"
                  : "bg-transparent text-muted hover:bg-hover"
              }`}
            >
              <Icon size={16} />
            </button>
          ))}
          <button
            type="button"
            aria-label={t("ai.views.setup")}
            title={t("ai.views.setup")}
            onClick={openSettings}
            className="grid size-8 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            type="button"
            aria-label={t("ai.close")}
            title={t("ai.close")}
            onClick={onClose}
            className="statly-close grid size-8 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
          >
            <X size={16} />
          </button>
        </header>
        {status.data?.autoMode ? (
          <p
            role="status"
            className="m-0 border-b border-line bg-selected px-3 py-1.5 text-xs font-semibold text-accent-strong"
          >
            {t("ai.auto.active")}
          </p>
        ) : null}
        {status.data && !status.data.provider ? (
          <SetupPrompt onOpen={openSettings} />
        ) : (
          <>
            {view === "chat" && locked ? <LockedChat /> : null}
            {view === "chat" && !locked ? <ChatView onOpenSetup={openSettings} /> : null}
            {view === "chats" ? <ChatList onOpened={() => setView("chat")} /> : null}
            {view === "history" ? <HistoryView /> : null}
          </>
        )}
      </aside>
    </div>
  );
}
