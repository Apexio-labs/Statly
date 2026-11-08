import { builtinWidgets, customWidgetPrefix, type WidgetType } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { addWidget, removeOneOfType, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import { WidgetBoundary } from "../dashboard/WidgetCard.tsx";
import { type WidgetScope, widgetComponents } from "../dashboard/widgets.tsx";
import { templates } from "../widgets/editor/templates.ts";
import { CustomWidgetView } from "../widgets/renderWidget.tsx";
import { useCustomWidgets } from "../widgets/useCustomWidgets.ts";
import { type LibraryItem, takesKeys } from "./libraryItems.ts";
import { RealSizePreview } from "./RealSizePreview.tsx";

/** The preview keeps this height for every widget, small or large. */
const PREVIEW_HEIGHT = 360;

function StatisticPreview({ type, scope }: { type: WidgetType; scope: WidgetScope }) {
  const { t } = useTranslation();
  const Preview = widgetComponents[type];
  return (
    <WidgetBoundary title={t(`widgets.${type}.title`)} message={t("dashboard.error")}>
      <Preview scope={scope} />
    </WidgetBoundary>
  );
}

/** A focused button inside the preview, which Space presses instead of closing the preview. */
function pressesOwnButton(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, [role='button'], [role='menuitem']") !== null &&
    target.closest("[role='dialog']") !== null
  );
}

export function LibraryDetail({
  item,
  scope,
  position,
  onStep,
  onClose,
}: {
  item: LibraryItem;
  scope: WidgetScope | null;
  /** Where this tile stands among the tiles on the page, counted from 1. */
  position?: { index: number; total: number };
  /** Moves to the tile before (-1) or after (1) without closing. */
  onStep?: (direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { widgets, remove } = useCustomWidgets();
  const { layout, save } = useLayout();
  const [confirming, setConfirming] = useState(false);
  const template = useMemo(
    () =>
      item.kind === "template"
        ? templates.find((entry) => entry.key === item.key)?.build("preview")
        : undefined,
    [item],
  );

  // A question to delete belongs to the widget it was asked for, not to the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever another tile is shown.
  useEffect(() => setConfirming(false), [item.key]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      // Tab leaves the preview as well, so it can be closed from where the hand already is.
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        onClose();
        return;
      }
      // Space opened the preview, so it closes it too. A held key does not open and close at once,
      // and a button inside the preview or a field keeps its own use of Space.
      if (event.key === " ") {
        if (event.repeat || takesKeys(event.target) || pressesOwnButton(event.target)) {
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }
      const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (direction === 0 || !onStep || event.defaultPrevented || takesKeys(event.target)) {
        return;
      }
      event.preventDefault();
      onStep(direction);
    }
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, [onClose, onStep]);

  const dashboardType =
    item.kind === "statistic"
      ? item.type
      : item.kind === "custom"
        ? `${customWidgetPrefix}${item.widget.id}`
        : null;
  const used = layout?.widgets.filter((widget) => widget.type === dashboardType).length ?? 0;
  const size =
    item.kind === "statistic"
      ? builtinWidgets[item.type]
      : item.kind === "custom"
        ? item.widget.size
        : template?.size;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the dialog as well.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog as well.
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="statly-dialog flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-popover bg-card text-text shadow-card"
      >
        <header className="statly-dialog-header flex items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-lg font-bold">{item.title}</h2>
            <p className="m-0 mt-1 text-[13px] text-muted">{item.text}</p>
          </div>
          {onStep && position && position.total > 1 ? (
            <div className="statly-dialog-steps flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={t("library.previous")}
                title={`${t("library.previous")} (←)`}
                onClick={() => onStep(-1)}
                className="statly-step grid size-8 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover hover:text-text"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="min-w-[52px] text-center text-xs text-muted tabular-nums">
                {t("library.position", { index: position.index, total: position.total })}
              </span>
              <button
                type="button"
                aria-label={t("library.next")}
                title={`${t("library.next")} (→)`}
                onClick={() => onStep(1)}
                className="statly-step grid size-8 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover hover:text-text"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            aria-label={t("library.close")}
            onClick={onClose}
            className="statly-close grid size-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
          >
            <X size={17} />
          </button>
        </header>
        <section
          aria-label={t("library.preview")}
          className="statly-dialog-body shrink-0 bg-page"
          style={{ height: PREVIEW_HEIGHT }}
        >
          {size ? (
            <RealSizePreview key={item.key} cells={size} height={PREVIEW_HEIGHT}>
              {item.kind === "statistic" && scope ? (
                <StatisticPreview type={item.type} scope={scope} />
              ) : null}
              {item.kind === "custom" && scope ? (
                <CustomWidgetView widget={item.widget} scope={scope} cells={item.widget.size} />
              ) : null}
              {template && scope ? (
                <CustomWidgetView widget={template} scope={scope} cells={template.size} />
              ) : null}
            </RealSizePreview>
          ) : null}
        </section>
        <footer className="statly-dialog-footer flex flex-wrap items-center gap-2 border-t border-line p-4">
          <span className="mr-auto text-xs text-muted">
            {item.tag}
            {size ? ` · ${t("library.standardSize", { w: size.w, h: size.h })}` : ""}
          </span>
          {item.kind === "custom" ? (
            <>
              {confirming ? (
                <Button
                  className="text-danger"
                  onClick={() => {
                    remove.mutate(item.widget.id);
                    onClose();
                  }}
                >
                  {t("library.confirmDelete")}
                </Button>
              ) : (
                <Button onClick={() => setConfirming(true)}>{t("library.delete")}</Button>
              )}
              <Button onClick={() => void bridge.call("widgets.export", { id: item.widget.id })}>
                {t("dashboard.export")}
              </Button>
              <Button onClick={() => void navigate(`/library/widgets/${item.widget.id}`)}>
                {t("library.edit")}
              </Button>
            </>
          ) : null}
          {item.kind === "template" ? (
            <Button
              primary
              onClick={() => void navigate(`/library/widgets/new?template=${item.key}`)}
            >
              {t("library.useTemplate")}
            </Button>
          ) : null}
          {layout && dashboardType ? (
            <>
              {used > 0 ? (
                <Button
                  aria-label={t("library.removeNamed", { title: item.title })}
                  onClick={() => save.mutate(removeOneOfType(layout, dashboardType))}
                >
                  {t("library.remove", { count: used })}
                </Button>
              ) : null}
              <Button
                primary
                onClick={() =>
                  save.mutate(addWidget(layout, dashboardType, rulesOfWidgets(widgets)))
                }
              >
                {t("library.addToDashboard")}
              </Button>
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
