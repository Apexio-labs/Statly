import type { AiChange } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Button } from "../../components/Button.tsx";
import { useAiCall, useChanges } from "./useAi.ts";

function Entry({ change }: { change: AiChange }) {
  const { t, i18n } = useTranslation();
  const rollback = useAiCall("ai.rollback");
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(change.at));
  return (
    <article data-change={change.id} className="flex flex-col gap-1 border-b border-line pb-3">
      <p className="m-0 text-[13px] [overflow-wrap:anywhere]">{change.summary}</p>
      <p className="m-0 text-[11px] text-muted">
        {when} · {t(`ai.proposal.${change.kind}`)}
        {change.mode === "auto" ? ` · ${t("ai.history.auto")}` : ""}
        {change.source === "external" ? ` · ${t("ai.proposal.external")}` : ""}
      </p>
      {change.rolledBack ? (
        <p className="m-0 text-xs text-muted">{t("ai.history.undone")}</p>
      ) : (
        <Button
          className="h-8 self-start"
          disabled={rollback.isPending}
          onClick={() => rollback.mutate({ id: change.id })}
        >
          {t("ai.history.undo")}
        </Button>
      )}
      {rollback.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {rollback.error.message}
        </p>
      ) : null}
    </article>
  );
}

export function HistoryView() {
  const { t } = useTranslation();
  const changes = useChanges();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 statly-scroll">
      <p className="m-0 text-xs text-muted">{t("ai.history.note")}</p>
      {changes.data?.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{t("ai.history.empty")}</p>
      ) : null}
      {changes.data?.map((change) => (
        <Entry key={change.id} change={change} />
      ))}
    </div>
  );
}
