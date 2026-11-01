import type { CustomWidget } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Sparkles } from "lucide-react";
import { Button } from "../../../components/Button.tsx";

/** A suggested widget builds up piece by piece, so people learn how to do it themselves. */
export type Guide = { proposalId: string; widget: CustomWidget; step: number };

export function GuidePanel({
  guide,
  onNext,
  onSkip,
}: {
  guide: Guide;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const { elements } = guide.widget;
  const last = guide.step > elements.length;
  const current = guide.step > 0 ? elements[guide.step - 1] : undefined;
  const topic = last ? "finish" : current ? current.kind : "start";
  return (
    <section
      data-testid="editor-guide"
      aria-label={t("editor.guide.label")}
      className="absolute bottom-3 left-1/2 z-20 flex w-[min(420px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2 rounded-card border border-accent bg-card p-4 text-text shadow-card"
    >
      <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold text-accent-strong">
        <Sparkles size={13} />
        {t("editor.guide.step", { step: guide.step + 1, count: elements.length + 2 })}
      </p>
      <h2 className="m-0 text-[15px] font-bold">{t(`editor.guide.${topic}.title`)}</h2>
      <p className="m-0 text-[13px] text-muted">
        {t(`editor.guide.${topic}.body`, { w: guide.widget.size.w, h: guide.widget.size.h })}
      </p>
      {last ? null : (
        <div className="flex justify-end gap-2">
          <Button className="h-8" onClick={onSkip}>
            {t("editor.guide.skip")}
          </Button>
          <Button primary className="h-8" onClick={onNext}>
            {t("editor.guide.next")}
          </Button>
        </div>
      )}
    </section>
  );
}
