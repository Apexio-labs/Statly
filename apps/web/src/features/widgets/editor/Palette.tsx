import { useTranslation } from "@statly/i18n";
import {
  ChartColumn,
  CircleGauge,
  Grid3x3,
  Hash,
  Image,
  type LucideIcon,
  Shapes,
  Type,
} from "lucide-react";
import type { ElementKind } from "./templates.ts";
import { templates } from "./templates.ts";

const BLOCKS: [ElementKind, LucideIcon][] = [
  ["text", Type],
  ["metric", Hash],
  ["chart", ChartColumn],
  ["progress", CircleGauge],
  ["heatmap", Grid3x3],
  ["shape", Shapes],
];

const ITEM =
  "flex h-[38px] w-full cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2.5 text-left text-xs font-medium text-nav-text hover:bg-nav-hover";

export function Palette({
  onAdd,
  onAddMedia,
  onTemplate,
}: {
  onAdd: (kind: ElementKind) => void;
  onAddMedia: () => void;
  onTemplate: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3 statly-scroll">
      <h2 className="m-0 mb-1 text-[15px] font-bold text-nav-text">{t("editor.blocks")}</h2>
      {BLOCKS.map(([kind, Icon]) => (
        <button key={kind} type="button" className={ITEM} onClick={() => onAdd(kind)}>
          <Icon size={16} className="shrink-0" />
          {t(`editor.kinds.${kind}`)}
        </button>
      ))}
      <button type="button" className={ITEM} onClick={onAddMedia}>
        <Image size={16} className="shrink-0" />
        {t("editor.kinds.media")}
      </button>
      <h2 className="m-0 mt-4 mb-1 text-[15px] font-bold text-nav-text">{t("editor.templates")}</h2>
      {templates.map((template) => (
        <button
          key={template.key}
          type="button"
          className={ITEM}
          onClick={() => onTemplate(template.key)}
        >
          {t(`editor.templateNames.${template.key}`)}
        </button>
      ))}
    </div>
  );
}
