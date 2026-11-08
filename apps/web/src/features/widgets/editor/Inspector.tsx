import {
  type Cells,
  type ChartAxis,
  type ChartLayer,
  type CombinableChartKind,
  type CustomWidget,
  chartAxes,
  chartKinds,
  combinableChartKinds,
  combinesWith,
  type DeviceKind,
  heatmapModes,
  type MediaAsset,
  maxChartLayers,
  metricSources,
  type Paint,
  seriesSources,
  type WidgetBackground,
  type WidgetElement,
  widgetRanges,
  widgetSizeLimits,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { deviceCells, sizeLimits } from "@statly/widget-runtime";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "../../../components/Button.tsx";
import { Toggle } from "../../settings/parts.tsx";
import { addLayer, startLayers, withLayers } from "../chartLayers.ts";
import { hasLayoutFor, isDesignSize } from "./editorState.ts";
import {
  ChoiceField,
  ColorField,
  NumberField,
  PaintField,
  RangeField,
  TextField,
} from "./fields.tsx";
import { elementDefaults } from "./templates.ts";

const BACKGROUNDS = ["card", "color", "gradient", "media"] as const;

function RangeChoice({
  value,
  onChange,
  onReset,
}: {
  value: (typeof widgetRanges)[number];
  onChange: (value: (typeof widgetRanges)[number]) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceField
      label={t("editor.range")}
      value={value}
      options={widgetRanges.map((range) => ({
        value: range,
        label: t(`editor.ranges.${range}`),
      }))}
      onChange={onChange}
      onReset={onReset}
    />
  );
}

type ResetOf = (key: string) => () => void;

function TextStyleFields({
  element,
  onChange,
  reset,
}: {
  element: Extract<WidgetElement, { kind: "text" | "metric" }>;
  onChange: (patch: Partial<WidgetElement>) => void;
  reset: ResetOf;
}) {
  const { t } = useTranslation();
  return (
    <>
      <RangeField
        label={t("editor.textSize")}
        value={element.size}
        min={4}
        max={70}
        onChange={(size) => onChange({ size })}
        onReset={reset("size")}
      />
      <ChoiceField
        label={t("editor.align")}
        value={element.align}
        options={(["left", "center", "right"] as const).map((align) => ({
          value: align,
          label: t(`editor.alignments.${align}`),
        }))}
        onChange={(align) => onChange({ align })}
        onReset={reset("align")}
      />
      <ChoiceField
        label={t("editor.weight")}
        value={element.bold ? "bold" : "normal"}
        options={(["normal", "bold"] as const).map((weight) => ({
          value: weight,
          label: t(`editor.weights.${weight}`),
        }))}
        onChange={(weight) => onChange({ bold: weight === "bold" })}
        onReset={reset("bold")}
      />
      <PaintField
        label={t("editor.color")}
        value={element.color}
        onChange={(color) => onChange({ color })}
        onReset={reset("color")}
      />
    </>
  );
}

function isAnimated(asset: MediaAsset): boolean {
  return asset.type === "image/gif" || asset.type.startsWith("video/");
}

function LoopField({ checked, onChange }: { checked: boolean; onChange: (loop: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
      {t("editor.loop")}
      <Toggle label={t("editor.loop")} checked={checked} onChange={onChange} />
    </div>
  );
}

/**
 * The parts of a combined chart: every chart kind that can share a plot, each with a checkbox.
 * A ticked kind lists its layers, each with its own series, color and scale.
 */
function CombinedFields({
  layers,
  onChange,
}: {
  layers: ChartLayer[];
  onChange: (layers: ChartLayer[]) => void;
}) {
  const { t } = useTranslation();
  const full = layers.length >= maxChartLayers;
  const toggle = (kind: CombinableChartKind, on: boolean) => {
    if (on) {
      onChange(addLayer(layers, kind));
      return;
    }
    const rest = layers.filter((layer) => layer.kind !== kind);
    if (rest.length > 0) {
      onChange(rest);
    }
  };
  const update = (id: string, patch: Partial<ChartLayer>) =>
    onChange(layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[11px] text-muted">{t("editor.combined.hint")}</p>
      {combinableChartKinds.map((kind) => {
        const own = layers.filter((layer) => layer.kind === kind);
        const ticked = own.length > 0;
        const onlyOnes = ticked && own.length === layers.length;
        return (
          <section
            key={kind}
            data-combined-kind={kind}
            className="flex flex-col gap-2 rounded-control border border-line p-2"
          >
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs font-semibold">
              {t(`editor.chartKinds.${kind}`)}
              <input
                type="checkbox"
                checked={ticked}
                disabled={onlyOnes || (!ticked && full)}
                title={onlyOnes ? t("editor.combined.keepOne") : undefined}
                onChange={(event) => toggle(kind, event.target.checked)}
                className="size-4 cursor-pointer accent-[var(--statly-accent)] disabled:cursor-not-allowed"
              />
            </label>
            {own.map((layer) => (
              <LayerFields
                key={layer.id}
                layer={layer}
                others={layers.filter((other) => other.id !== layer.id)}
                onChange={(patch) => update(layer.id, patch)}
                onRemove={
                  layers.length > 1
                    ? () => onChange(layers.filter((other) => other.id !== layer.id))
                    : undefined
                }
              />
            ))}
            {ticked && !full ? (
              <button
                type="button"
                onClick={() => onChange(addLayer(layers, kind))}
                className="flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-xs font-semibold text-accent-strong"
              >
                <Plus size={13} aria-hidden="true" />
                {t(`editor.combined.add.${kind}`)}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function LayerFields({
  layer,
  others,
  onChange,
  onRemove,
}: {
  layer: ChartLayer;
  others: ChartLayer[];
  onChange: (patch: Partial<ChartLayer>) => void;
  onRemove: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const reference = others[0]?.source;
  return (
    <div className="flex flex-col gap-2 border-l-2 border-line pl-2" data-layer={layer.id}>
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <ChoiceField
            label={t("editor.value")}
            value={layer.source}
            options={seriesSources.map((source) => {
              const fits = reference === undefined || combinesWith(reference, source);
              return {
                value: source,
                label: t(`editor.series.${source}`),
                disabled: !fits,
                hint: fits ? undefined : t("editor.combined.otherAxis"),
              };
            })}
            onChange={(source) => onChange({ source })}
          />
        </div>
        {onRemove ? (
          <button
            type="button"
            aria-label={t("editor.combined.remove")}
            title={t("editor.combined.remove")}
            onClick={onRemove}
            className="mb-2 grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover hover:text-text"
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <PaintField
        label={t("editor.color")}
        value={layer.color}
        onChange={(color) => onChange({ color })}
      />
      <ChoiceField
        label={t("editor.combined.axis")}
        value={layer.axis}
        options={chartAxes.map((axis: ChartAxis) => ({
          value: axis,
          label: t(`editor.combined.axes.${axis}`),
        }))}
        onChange={(axis) => onChange({ axis })}
      />
    </div>
  );
}

function ElementFields({
  element,
  onChange,
  reset,
  onLoop,
}: {
  element: WidgetElement;
  onChange: (patch: Partial<WidgetElement>) => void;
  reset: ResetOf;
  onLoop: (asset: MediaAsset, loop: boolean) => void;
}) {
  const { t } = useTranslation();
  const metricOptions = metricSources.map((source) => ({
    value: source,
    label: t(`editor.metrics.${source}`),
  }));
  switch (element.kind) {
    case "text":
      return (
        <>
          <TextField
            label={t("editor.text")}
            value={element.text}
            maxLength={500}
            multiline
            onChange={(text) => onChange({ text })}
            onReset={reset("text")}
          />
          <TextStyleFields element={element} onChange={onChange} reset={reset} />
        </>
      );
    case "metric":
      return (
        <>
          <ChoiceField
            label={t("editor.value")}
            value={element.source}
            options={metricOptions}
            onChange={(source) => onChange({ source })}
            onReset={reset("source")}
          />
          <RangeChoice
            value={element.range}
            onChange={(range) => onChange({ range })}
            onReset={reset("range")}
          />
          <TextStyleFields element={element} onChange={onChange} reset={reset} />
        </>
      );
    case "chart": {
      const combined = element.chart === "combined";
      return (
        <>
          <ChoiceField
            label={t("editor.chartKind")}
            value={element.chart}
            options={[...chartKinds, "combined" as const].map((chart) => ({
              value: chart,
              label: t(`editor.chartKinds.${chart}`),
            }))}
            onChange={(chart) =>
              onChange(
                chart === "combined" ? { chart, ...withLayers(startLayers(element)) } : { chart },
              )
            }
            onReset={reset("chart")}
          />
          {combined ? (
            <CombinedFields
              layers={startLayers(element)}
              onChange={(layers) => onChange(withLayers(layers))}
            />
          ) : (
            <ChoiceField
              label={t("editor.value")}
              value={element.source}
              options={seriesSources.map((source) => ({
                value: source,
                label: t(`editor.series.${source}`),
              }))}
              onChange={(source) => onChange({ source })}
              onReset={reset("source")}
            />
          )}
          <RangeChoice
            value={element.range}
            onChange={(range) => onChange({ range })}
            onReset={reset("range")}
          />
          {combined ? null : (
            <PaintField
              label={t("editor.color")}
              value={element.color}
              onChange={(color) => onChange({ color })}
              onReset={reset("color")}
            />
          )}
        </>
      );
    }
    case "progress":
      return (
        <>
          <ChoiceField
            label={t("editor.value")}
            value={element.source}
            options={metricOptions}
            onChange={(source) => onChange({ source })}
            onReset={reset("source")}
          />
          <NumberField
            label={t("editor.goal")}
            value={element.goal}
            min={1}
            max={1_000_000}
            onChange={(goal) => onChange({ goal })}
            onReset={reset("goal")}
          />
          <ChoiceField
            label={t("editor.progressKind")}
            value={element.style}
            options={(["ring", "bar"] as const).map((style) => ({
              value: style,
              label: t(`editor.progressKinds.${style}`),
            }))}
            onChange={(style) => onChange({ style })}
            onReset={reset("style")}
          />
          <RangeChoice
            value={element.range}
            onChange={(range) => onChange({ range })}
            onReset={reset("range")}
          />
          <PaintField
            label={t("editor.color")}
            value={element.color}
            onChange={(color) => onChange({ color })}
            onReset={reset("color")}
          />
        </>
      );
    case "heatmap":
      return (
        <ChoiceField
          label={t("editor.heatmapMode")}
          value={element.mode ?? "reviews"}
          options={heatmapModes.map((mode) => ({
            value: mode,
            label: t(`widgets.study-overview.modes.${mode}`),
          }))}
          onChange={(mode) => onChange({ mode })}
          onReset={reset("mode")}
        />
      );
    case "media":
      return (
        <>
          <ChoiceField
            label={t("editor.fit")}
            value={element.fit}
            options={(["cover", "contain"] as const).map((fit) => ({
              value: fit,
              label: t(`editor.fits.${fit}`),
            }))}
            onChange={(fit) => onChange({ fit })}
            onReset={reset("fit")}
          />
          <RangeField
            label={t("editor.corners")}
            value={element.radius}
            min={0}
            max={50}
            onChange={(radius) => onChange({ radius })}
            onReset={reset("radius")}
          />
          {isAnimated(element.asset) ? (
            <LoopField
              checked={element.loop ?? true}
              onChange={(loop) => onLoop(element.asset, loop)}
            />
          ) : null}
        </>
      );
    case "shape":
      return (
        <>
          <ChoiceField
            label={t("editor.shape")}
            value={element.shape}
            options={(["rectangle", "ellipse"] as const).map((shape) => ({
              value: shape,
              label: t(`editor.shapes.${shape}`),
            }))}
            onChange={(shape) => onChange({ shape })}
            onReset={reset("shape")}
          />
          <PaintField
            label={t("editor.color")}
            value={element.fill as Paint}
            onChange={(fill) => onChange({ fill })}
            onReset={reset("fill")}
          />
          {element.shape === "rectangle" ? (
            <RangeField
              label={t("editor.corners")}
              value={element.radius}
              min={0}
              max={50}
              onChange={(radius) => onChange({ radius })}
              onReset={reset("radius")}
            />
          ) : null}
        </>
      );
    default:
      return null;
  }
}

function BackgroundFields({
  background,
  onChange,
  onChooseMedia,
  onLoop,
}: {
  background: WidgetBackground;
  onChange: (background: WidgetBackground) => void;
  onChooseMedia: () => void;
  onLoop: (asset: MediaAsset, loop: boolean) => void;
}) {
  const { t } = useTranslation();

  function pick(kind: (typeof BACKGROUNDS)[number]) {
    if (kind === "card") {
      onChange({ kind });
    } else if (kind === "color") {
      onChange({ kind, color: "#087f8c" });
    } else if (kind === "gradient") {
      onChange({ kind, start: "#087f8c", end: "#176bb0", angle: 135 });
    } else {
      onChooseMedia();
    }
  }

  return (
    <>
      <ChoiceField
        label={t("editor.background")}
        value={background.kind}
        options={BACKGROUNDS.map((kind) => ({
          value: kind,
          label: t(`editor.backgrounds.${kind}`),
        }))}
        onChange={pick}
        onReset={() => onChange({ kind: "card" })}
      />
      {background.kind === "color" ? (
        <ColorField
          label={t("editor.color")}
          value={background.color}
          onChange={(color) => onChange({ ...background, color })}
        />
      ) : null}
      {background.kind === "gradient" ? (
        <>
          <ColorField
            label={t("editor.gradientStart")}
            value={background.start}
            onChange={(start) => onChange({ ...background, start })}
          />
          <ColorField
            label={t("editor.gradientEnd")}
            value={background.end}
            onChange={(end) => onChange({ ...background, end })}
          />
          <RangeField
            label={t("editor.angle")}
            value={background.angle}
            min={0}
            max={360}
            onChange={(angle) => onChange({ ...background, angle })}
            onReset={() => onChange({ ...background, angle: 135 })}
          />
        </>
      ) : null}
      {background.kind === "media" ? (
        <>
          <Button onClick={onChooseMedia}>{t("editor.chooseMedia")}</Button>
          <RangeField
            label={t("editor.shade")}
            value={background.shade}
            min={0}
            max={0.8}
            step={0.05}
            onChange={(shade) => onChange({ ...background, shade })}
            onReset={() => onChange({ ...background, shade: 0 })}
          />
          {isAnimated(background.asset) ? (
            <LoopField
              checked={background.loop ?? true}
              onChange={(loop) => onLoop(background.asset, loop)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function SizeFields({
  widget,
  cells,
  onWidget,
  onRole,
  onPreview,
}: {
  widget: CustomWidget;
  cells: Cells;
  onWidget: (patch: Partial<CustomWidget>) => void;
  onRole: (role: "standard" | "minimum" | "maximum") => void;
  onPreview: (cells: Cells) => void;
}) {
  const { t } = useTranslation();
  const limits = sizeLimits(widget.size);
  const { size } = widget;
  const standard = isDesignSize(widget, cells);

  const onDevice = (device: DeviceKind) => onPreview(deviceCells(size, device));

  function limit(key: keyof typeof limits, value: number) {
    const next = { ...limits, [key]: value };
    if (next.minW <= size.w && size.w <= next.maxW && next.minH <= size.h && size.h <= next.maxH) {
      onWidget({ size: { ...size, ...next } });
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="m-0 text-xs font-bold">{t("editor.size")}</h3>
      <p className="m-0 text-xs text-muted" data-testid="current-size">
        {t(standard ? "editor.currentStandard" : "editor.currentOther", {
          w: cells.w,
          h: cells.h,
        })}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {(
          [
            ["minimum", { w: limits.minW, h: limits.minH }],
            ["standard", { w: size.w, h: size.h }],
            ["maximum", { w: limits.maxW, h: limits.maxH }],
          ] as const
        ).map(([role, target]) => (
          <Button
            key={role}
            aria-label={t(`editor.show.${role}`)}
            className="h-8 justify-center px-0 text-xs"
            onClick={() => onPreview(target)}
          >
            {t(`editor.roles.${role}`)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button className="h-8 justify-center px-0 text-xs" onClick={() => onDevice("tablet")}>
          {t("editor.showTablet")}
        </Button>
        <Button className="h-8 justify-center px-0 text-xs" onClick={() => onDevice("phone")}>
          {t("editor.showPhone")}
        </Button>
      </div>
      {standard ? null : (
        <Button className="h-8 justify-center text-xs" onClick={() => onRole("standard")}>
          {t("editor.setStandard")}
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button className="h-8 justify-center px-0 text-xs" onClick={() => onRole("minimum")}>
          {t("editor.setMinimum")}
        </Button>
        <Button className="h-8 justify-center px-0 text-xs" onClick={() => onRole("maximum")}>
          {t("editor.setMaximum")}
        </Button>
        <NumberField
          label={t("editor.minWidth")}
          value={limits.minW}
          min={widgetSizeLimits.minW}
          max={widgetSizeLimits.maxW}
          onChange={(value) => limit("minW", value)}
          onReset={() => limit("minW", widgetSizeLimits.minW)}
        />
        <NumberField
          label={t("editor.maxWidth")}
          value={limits.maxW}
          min={widgetSizeLimits.minW}
          max={widgetSizeLimits.maxW}
          onChange={(value) => limit("maxW", value)}
          onReset={() => limit("maxW", widgetSizeLimits.maxW)}
        />
        <NumberField
          label={t("editor.minHeight")}
          value={limits.minH}
          min={widgetSizeLimits.minH}
          max={widgetSizeLimits.maxH}
          onChange={(value) => limit("minH", value)}
          onReset={() => limit("minH", widgetSizeLimits.minH)}
        />
        <NumberField
          label={t("editor.maxHeight")}
          value={limits.maxH}
          min={widgetSizeLimits.minH}
          max={widgetSizeLimits.maxH}
          onChange={(value) => limit("maxH", value)}
          onReset={() => limit("maxH", widgetSizeLimits.maxH)}
        />
      </div>
    </section>
  );
}

function VisibilityFields({
  element,
  cells,
  onElement,
  onClearLayout,
  design,
}: {
  element: WidgetElement;
  cells: Cells;
  design: boolean;
  onElement: (patch: Partial<WidgetElement>) => void;
  onClearLayout: () => void;
}) {
  const { t } = useTranslation();
  const from = element.showFrom;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-xs font-bold">{t("editor.onlyFromSize")}</h3>
        <Toggle
          label={t("editor.onlyFromSize")}
          checked={from !== undefined}
          onChange={(on) =>
            onElement({
              showFrom: on ? { w: cells.w, h: cells.h } : undefined,
            } as Partial<WidgetElement>)
          }
        />
      </div>
      {from ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t("editor.width")}
            value={from.w}
            min={1}
            max={12}
            onChange={(w) => onElement({ showFrom: { ...from, w } })}
          />
          <NumberField
            label={t("editor.height")}
            value={from.h}
            min={1}
            max={16}
            onChange={(h) => onElement({ showFrom: { ...from, h } })}
          />
        </div>
      ) : null}
      {!design && hasLayoutFor(element, cells) ? (
        <Button className="h-8 justify-center text-xs" onClick={onClearLayout}>
          {t("editor.clearLayout")}
        </Button>
      ) : null}
    </section>
  );
}

type Props = {
  widget: CustomWidget;
  element: WidgetElement | undefined;
  cells: Cells;
  onWidget: (patch: Partial<CustomWidget>) => void;
  onElement: (patch: Partial<WidgetElement>) => void;
  onRole: (role: "standard" | "minimum" | "maximum") => void;
  onPreviewCells: (cells: Cells) => void;
  onClearLayout: () => void;
  onLoop: (asset: MediaAsset, loop: boolean) => void;
  onChooseBackgroundMedia: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayer: (direction: 1 | -1) => void;
};

export function Inspector({
  widget,
  element,
  cells,
  onWidget,
  onElement,
  onRole,
  onPreviewCells,
  onClearLayout,
  onLoop,
  onChooseBackgroundMedia,
  onDuplicate,
  onDelete,
  onLayer,
}: Props) {
  const { t } = useTranslation();
  const defaults: Record<string, unknown> = element ? elementDefaults(element) : {};
  const reset: ResetOf = (key) => () => onElement({ [key]: defaults[key] });
  return (
    <aside
      aria-label={t("editor.properties")}
      className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto rounded-card border border-line bg-card p-4 statly-scroll"
    >
      {element ? (
        <>
          <h2 className="m-0 text-[13px] font-bold">{t(`editor.kinds.${element.kind}`)}</h2>
          <ElementFields element={element} onChange={onElement} reset={reset} onLoop={onLoop} />
          <RangeField
            label={t("editor.opacity")}
            value={element.opacity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(opacity) => onElement({ opacity })}
            onReset={() => onElement({ opacity: 1 })}
          />
          <RangeField
            label={t("editor.rotation")}
            value={element.rotation ?? 0}
            min={-180}
            max={180}
            onChange={(rotation) => onElement({ rotation })}
            onReset={() => onElement({ rotation: 0 })}
          />
          <VisibilityFields
            element={element}
            cells={cells}
            design={isDesignSize(widget, cells)}
            onElement={onElement}
            onClearLayout={onClearLayout}
          />
          <div className="mt-1 grid grid-cols-4 gap-1">
            <Button
              aria-label={t("editor.bringForward")}
              className="justify-center px-0"
              onClick={() => onLayer(1)}
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              aria-label={t("editor.sendBackward")}
              className="justify-center px-0"
              onClick={() => onLayer(-1)}
            >
              <ArrowDown size={15} />
            </Button>
            <Button
              aria-label={t("editor.duplicate")}
              className="justify-center px-0"
              onClick={onDuplicate}
            >
              <Copy size={15} />
            </Button>
            <Button
              aria-label={t("editor.delete")}
              className="justify-center px-0 text-danger"
              onClick={onDelete}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="m-0 text-[13px] font-bold">{t("editor.widget")}</h2>
          <TextField
            label={t("editor.name")}
            value={widget.name}
            maxLength={80}
            onChange={(name) => onWidget({ name })}
          />
          <TextField
            label={t("editor.description")}
            value={widget.description}
            maxLength={200}
            onChange={(description) => onWidget({ description })}
          />
          <SizeFields
            widget={widget}
            cells={cells}
            onWidget={onWidget}
            onRole={onRole}
            onPreview={onPreviewCells}
          />
          <BackgroundFields
            background={widget.background}
            onChange={(background) => onWidget({ background })}
            onChooseMedia={onChooseBackgroundMedia}
            onLoop={onLoop}
          />
        </>
      )}
    </aside>
  );
}
