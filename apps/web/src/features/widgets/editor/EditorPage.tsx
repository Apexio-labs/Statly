import {
  type Cells,
  type CustomWidget,
  customWidget,
  type MediaAsset,
  type WidgetElement,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useQuery } from "@tanstack/react-query";
import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { PageHeader } from "../../../components/PageHeader.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { useStatistic } from "../../../lib/calls.ts";
import { useUnsavedGuard } from "../../../lib/useUnsavedGuard.tsx";
import { useRail } from "../../../shell/ShellContext.tsx";
import { rangeOf } from "../../dashboard/useDashboardFilters.ts";
import { useCustomWidgets } from "../useCustomWidgets.ts";
import { EditorCanvas } from "./EditorCanvas.tsx";
import {
  clearLayout,
  commit,
  duplicateElement,
  type History,
  isDesignSize,
  moveLayer,
  placeElement,
  redo,
  removeElement,
  setSizeRole,
  startHistory,
  undo,
  unusedElementId,
  updateElement,
} from "./editorState.ts";
import { HoverReset } from "./fields.tsx";
import { type Guide, GuidePanel } from "./Guide.tsx";
import { Inspector } from "./Inspector.tsx";
import { Palette } from "./Palette.tsx";
import {
  blankWidget,
  type ElementKind,
  newElement,
  newMediaElement,
  templates,
} from "./templates.ts";

const KEY_STEP = 1;

function newId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const NON_TEXT_INPUTS = new Set(["range", "color", "checkbox"]);

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  return target instanceof HTMLTextAreaElement;
}

function Editor({
  initial,
  suggestion,
}: {
  initial: History["present"];
  suggestion?: { proposalId: string; widget: CustomWidget };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme } = useAppearance();
  const { save, refresh } = useCustomWidgets();
  const [guide, setGuide] = useState<Guide | null>(suggestion ? { ...suggestion, step: 0 } : null);
  const today = useStatistic("statistics.today", {});
  const railHost = useRail("widgets");
  const [history, setHistory] = useState<History>(() => startHistory(initial));
  const [preview, setPreview] = useState<History["present"] | null>(null);
  const [cells, setCells] = useState<Cells>({ w: initial.size.w, h: initial.size.h });
  const [busy, setBusy] = useState(false);
  const hoveredReset = useRef<(() => void) | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const widget = preview ?? history.present;
  const element = widget.elements.find((item) => item.id === selected);

  const change = useCallback((next: History["present"]) => {
    setHistory((current) => commit(current, next));
  }, []);

  function addElement(next: WidgetElement) {
    change({ ...history.present, elements: [...history.present.elements, next] });
    setSelected(next.id);
  }

  function add(kind: ElementKind) {
    addElement(newElement(kind, unusedElementId(history.present)));
  }

  /** Videos are converted first, which can take a moment. */
  async function chooseMedia(): Promise<MediaAsset | null> {
    setBusy(true);
    setProblem(null);
    try {
      const { asset } = await bridge.call("widgets.addMedia", {});
      return asset;
    } catch (error) {
      setProblem((error as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addMedia() {
    const asset = await chooseMedia();
    if (asset) {
      addElement(newMediaElement(asset, unusedElementId(history.present)));
    }
  }

  async function chooseBackgroundMedia() {
    const asset = await chooseMedia();
    if (asset) {
      change({
        ...history.present,
        background: { kind: "media", asset, fit: "cover", shade: 0, loop: true },
      });
    }
  }

  /** A video only needs its setting. A GIF carries its looping inside the file. */
  async function setLoop(asset: MediaAsset, loop: boolean) {
    const updated =
      asset.type === "image/gif"
        ? await bridge.call("widgets.setGifLoop", { id: asset.id, loop })
        : asset;
    const present = history.present;
    if (present.background.kind === "media" && present.background.asset.id === asset.id) {
      change({ ...present, background: { ...present.background, asset: updated, loop } });
    } else if (selected) {
      change(updateElement(present, selected, { asset: updated, loop } as Partial<WidgetElement>));
    }
  }

  function setRole(role: "standard" | "minimum" | "maximum") {
    change(setSizeRole(history.present, role, cells));
  }

  function applyTemplate(key: string) {
    const template = templates.find((item) => item.key === key);
    if (template) {
      const built = template.build(history.present.id);
      change({ ...built, name: history.present.name || t(`editor.templateNames.${key}`) });
      setCells({ w: built.size.w, h: built.size.h });
      setSelected(null);
    }
  }

  const [savedWidget, setSavedWidget] = useState(initial);
  const dirty = JSON.stringify(history.present) !== JSON.stringify(savedWidget);

  async function store(): Promise<boolean> {
    const named = { ...history.present, name: history.present.name.trim() };
    const checked = customWidget.safeParse(named);
    if (!checked.success) {
      setProblem(t("editor.needsName"));
      setSelected(null);
      return false;
    }
    try {
      if (suggestion) {
        await bridge.call("ai.applyProposal", {
          id: suggestion.proposalId,
          widget: checked.data,
        });
        await refresh();
      } else {
        await save.mutateAsync(checked.data);
      }
    } catch (error) {
      setProblem((error as Error).message);
      return false;
    }
    setSavedWidget(history.present);
    return true;
  }

  const guard = useUnsavedGuard({ dirty, save: store });

  function nextGuideStep() {
    if (!guide) {
      return;
    }
    const element = guide.widget.elements[guide.step];
    if (element) {
      change({ ...history.present, elements: [...history.present.elements, element] });
      setSelected(element.id);
    } else {
      setSelected(null);
    }
    setGuide({ ...guide, step: guide.step + 1 });
  }

  function skipGuide() {
    if (guide) {
      change({ ...history.present, elements: guide.widget.elements });
      setGuide({ ...guide, step: guide.widget.elements.length + 1 });
      setSelected(null);
    }
  }

  async function finish() {
    if (await store()) {
      guard.allowLeaving();
      void navigate("/library");
    }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (isTyping(event.target)) {
        return;
      }
      if (event.key === "Backspace" && hoveredReset.current) {
        event.preventDefault();
        hoveredReset.current();
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory(event.shiftKey ? redo : undo);
        return;
      }
      if (!selected) {
        return;
      }
      if (event.key === "Escape") {
        setSelected(null);
        return;
      }
      const steps: Record<string, [number, number]> = {
        ArrowLeft: [-KEY_STEP, 0],
        ArrowRight: [KEY_STEP, 0],
        ArrowUp: [0, -KEY_STEP],
        ArrowDown: [0, KEY_STEP],
      };
      const step = steps[event.key];
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setHistory((current) => commit(current, removeElement(current.present, selected)));
        setSelected(null);
      } else if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setHistory((current) => commit(current, duplicateElement(current.present, selected)));
      } else if (step) {
        event.preventDefault();
        setHistory((current) => {
          const item = current.present.elements.find((entry) => entry.id === selected);
          return item
            ? commit(
                current,
                updateElement(current.present, selected, {
                  x: item.x + step[0],
                  y: item.y + step[1],
                }),
              )
            : current;
        });
      }
    }
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, [selected]);

  const date = today.data?.date;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={widget.name || t("editor.newWidget")}>
        <Button
          aria-label={t("editor.undo")}
          disabled={history.past.length === 0}
          onClick={() => setHistory(undo)}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          aria-label={t("editor.redo")}
          disabled={history.future.length === 0}
          onClick={() => setHistory(redo)}
        >
          <Redo2 size={15} />
        </Button>
        <Button onClick={() => void navigate("/library")}>{t("dashboard.cancel")}</Button>
        <Button primary onClick={() => void finish()}>
          {t("dashboard.save")}
        </Button>
      </PageHeader>
      <HoverReset.Provider value={hoveredReset}>
        <div className="relative flex min-h-0 flex-1 gap-3 px-4 pb-4">
          {date ? (
            <EditorCanvas
              widget={widget}
              cells={cells}
              onCells={setCells}
              scope={{
                ...rangeOf({ preset: "last7", custom: null, today: date, firstReview: null }),
                deckId: null,
                themeKey: theme,
              }}
              selected={selected}
              onSelect={setSelected}
              onPreview={(id, box) =>
                setPreview(placeElement(previewRef.current ?? history.present, id, cells, box))
              }
              onPreviewRotation={(id, rotation) =>
                setPreview(updateElement(previewRef.current ?? history.present, id, { rotation }))
              }
              onCommit={() => {
                if (previewRef.current) {
                  change(previewRef.current);
                }
                setPreview(null);
              }}
            />
          ) : (
            <div className="flex-1" />
          )}
          {guide ? <GuidePanel guide={guide} onNext={nextGuideStep} onSkip={skipGuide} /> : null}
          {/* Notes float above the stage, because a line of text must never move the widget. */}
          <div className="pointer-events-none absolute top-2 left-4 z-20 flex max-w-[60%] flex-col items-start gap-1">
            {problem ? (
              <p
                role="alert"
                className="m-0 rounded-control bg-card px-2.5 py-1.5 text-xs text-danger shadow-card"
              >
                {problem}
              </p>
            ) : null}
            {busy ? (
              <p
                role="status"
                className="m-0 rounded-control bg-card px-2.5 py-1.5 text-xs text-muted shadow-card"
              >
                {t("editor.preparing")}
              </p>
            ) : null}
            {isDesignSize(widget, cells) ? null : (
              <p
                data-testid="size-note"
                className="m-0 rounded-control bg-card px-2.5 py-1.5 text-xs text-muted shadow-card"
              >
                {t("editor.otherSizeNote", { w: cells.w, h: cells.h })}
              </p>
            )}
          </div>
          <Inspector
            widget={widget}
            element={element}
            cells={cells}
            onRole={setRole}
            onPreviewCells={setCells}
            onLoop={(asset, loop) => void setLoop(asset, loop)}
            onClearLayout={() => {
              if (selected) {
                change(clearLayout(history.present, selected, cells));
              }
            }}
            onWidget={(patch) => change({ ...history.present, ...patch })}
            onElement={(patch) => {
              if (selected) {
                change(updateElement(history.present, selected, patch));
              }
            }}
            onChooseBackgroundMedia={() => void chooseBackgroundMedia()}
            onDuplicate={() => {
              if (selected) {
                change(duplicateElement(history.present, selected));
              }
            }}
            onDelete={() => {
              if (selected) {
                change(removeElement(history.present, selected));
                setSelected(null);
              }
            }}
            onLayer={(direction) => {
              if (selected) {
                change(moveLayer(history.present, selected, direction));
              }
            }}
          />
        </div>
      </HoverReset.Provider>
      {guard.dialog}
      {railHost
        ? createPortal(
            <Palette onAdd={add} onAddMedia={() => void addMedia()} onTemplate={applyTemplate} />,
            railHost,
          )
        : null}
    </div>
  );
}

/** A widget the assistant suggested, ready to be built up step by step. */
function SuggestedEditor({ proposalId }: { proposalId: string }) {
  const conversation = useQuery({
    queryKey: ["ai.conversation"],
    queryFn: () => bridge.call("ai.conversation", {}),
  });
  const proposal = conversation.data?.proposals.find((item) => item.id === proposalId);
  const checked = customWidget.safeParse(proposal?.widget);
  if (!conversation.data) {
    return null;
  }
  if (!checked.success || proposal?.status !== "pending") {
    return <Navigate to="/library" replace />;
  }
  return (
    <Editor
      key={proposalId}
      initial={{ ...checked.data, elements: [] }}
      suggestion={{ proposalId, widget: checked.data }}
    />
  );
}

export function EditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [search] = useSearchParams();
  const { widgets, loaded } = useCustomWidgets();
  const [fresh] = useState(() => {
    const template = templates.find((item) => item.key === search.get("template"));
    return template
      ? { ...template.build(newId()), name: t(`editor.templateNames.${template.key as "streak"}`) }
      : blankWidget(newId());
  });
  const proposal = search.get("proposal");
  if (proposal) {
    return <SuggestedEditor proposalId={proposal} />;
  }
  if (id === "new") {
    return <Editor initial={fresh} />;
  }
  if (!loaded) {
    return null;
  }
  const existing = widgets.find((widget) => widget.id === id);
  return existing ? <Editor initial={existing} /> : <Navigate to="/library" replace />;
}
