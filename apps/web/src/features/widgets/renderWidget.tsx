import {
  type Cells,
  type CustomWidget,
  customWidgetPrefix,
  type DashboardWidget,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import {
  boxStyle,
  cellsToPixels,
  designAspect,
  isVisibleAt,
  layoutAt,
} from "@statly/widget-runtime";
import type { ReactNode } from "react";
import { type WidgetScope, widgetComponents } from "../dashboard/widgets.tsx";
import { parseGoalWidget } from "../goals/goalLogic.ts";
import { useGoals } from "../goals/useGoals.ts";
import { GoalWidgetView } from "../goals/widget/GoalWidget.tsx";
import { ElementView } from "./ElementView.tsx";
import { useCustomWidgets } from "./useCustomWidgets.ts";
import { WidgetFrame } from "./WidgetFrame.tsx";

export function CustomWidgetView({
  widget,
  scope,
  cells,
}: {
  widget: CustomWidget;
  scope: WidgetScope;
  cells: Cells;
}) {
  const aspect = designAspect(widget.size);
  const { width, height } = cellsToPixels(cells);
  return (
    <WidgetFrame widget={widget}>
      {widget.elements
        .filter((element) => isVisibleAt(element, cells))
        .map((element) => {
          const box = layoutAt(element, widget.size, cells);
          return (
            <div key={element.id} style={boxStyle(box, element.opacity, element.rotation)}>
              <ElementView
                element={element}
                scope={scope}
                frame={{ aspect, heightPx: (height * box.h) / 100, widthPx: (width * box.w) / 100 }}
              />
            </div>
          );
        })}
    </WidgetFrame>
  );
}

function SavedCustomWidget({ id, scope, cells }: { id: string; scope: WidgetScope; cells: Cells }) {
  const { widgets } = useCustomWidgets();
  const widget = widgets.find((item) => item.id === id);
  return widget ? <CustomWidgetView widget={widget} scope={scope} cells={cells} /> : null;
}

export function renderWidget(widget: DashboardWidget, scope: WidgetScope): ReactNode {
  if (widget.type.startsWith(customWidgetPrefix)) {
    return (
      <SavedCustomWidget
        id={widget.type.slice(customWidgetPrefix.length)}
        scope={scope}
        cells={{ w: widget.w, h: widget.h }}
      />
    );
  }
  const goal = parseGoalWidget(widget.type);
  if (goal) {
    return <GoalWidgetView goalId={goal.id} view={goal.view} />;
  }
  const Builtin = widgetComponents[widget.type as keyof typeof widgetComponents];
  if (!Builtin) {
    throw new Error(`Unknown widget: ${widget.type}`);
  }
  return <Builtin scope={scope} />;
}

export function useWidgetTitle(customWidgets: CustomWidget[]) {
  const { t } = useTranslation();
  const goals = useGoals().data ?? [];
  return (type: string): string => {
    const goal = parseGoalWidget(type);
    if (goal) {
      return goals.find((item) => item.id === goal.id)?.name ?? t("goals.title");
    }
    if (type.startsWith(customWidgetPrefix)) {
      const id = type.slice(customWidgetPrefix.length);
      return customWidgets.find((widget) => widget.id === id)?.name ?? "";
    }
    return t(`widgets.${type as "due-cards"}.title`);
  };
}
