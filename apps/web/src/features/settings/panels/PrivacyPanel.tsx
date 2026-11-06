import type { ChangeEntry, PermissionState } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { changeLines } from "../../changes/ChangeNotice.tsx";
import { PERMISSIONS_KEY, useAnkiChanges, usePermissions } from "../../privacy/usePrivacy.ts";
import { Card, Panel, Toggle } from "../parts.tsx";

/** Permissions by what they are about, in the order the person meets them. */
const GROUPS: { name: string; members: PermissionState["id"][] }[] = [
  { name: "ai", members: ["ai.decks", "ai.cards", "ai.external"] },
  { name: "mobile", members: ["mobile.card"] },
  { name: "goals", members: ["goals.sync", "anki.deckLimits"] },
];

/** Taking these back removes something, so it is asked first. */
const REMOVES_SOMETHING = new Set<PermissionState["id"]>(["mobile.card"]);

function useMoment() {
  const { i18n } = useTranslation();
  return (moment: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(moment),
    );
}

function PermissionRow({
  state,
  busy,
  onChange,
}: {
  state: PermissionState;
  busy: boolean;
  onChange: (allowed: boolean) => void;
}) {
  const { t } = useTranslation();
  const moment = useMoment();
  const title = t(`privacy.permissions.${state.id}.title`);
  const status = state.granted
    ? state.source === "migrated"
      ? t("privacy.migrated")
      : t("privacy.allowedSince", { when: moment(state.grantedAt ?? "") })
    : t("privacy.notAllowed");
  const used =
    state.granted && state.lastUsedAt
      ? t("privacy.lastUsed", { when: moment(state.lastUsedAt) })
      : "";
  return (
    <div
      data-permission={state.id}
      data-highlight={`permission-${state.id}`}
      className="flex items-start justify-between gap-6 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="min-w-0">
        <h4 className="m-0 text-[13px] font-semibold">{title}</h4>
        <p className="m-0 mt-0.5 text-xs text-muted">{t(`privacy.permissions.${state.id}.note`)}</p>
        <p className="m-0 mt-1.5 text-[11px] text-muted">
          <span className={state.granted ? "font-semibold text-text" : ""}>{status}</span>
          {used ? ` · ${used}` : ""}
        </p>
      </div>
      <Toggle label={title} checked={state.granted} disabled={busy} onChange={onChange} />
    </div>
  );
}

function ChangeRow({
  entry,
  onUndo,
  busy,
}: {
  entry: ChangeEntry;
  onUndo: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const moment = useMoment();
  return (
    <li
      data-change={entry.id}
      className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="min-w-0 flex-1">
        <ul
          className={`m-0 list-none p-0 text-[13px] ${entry.undone ? "text-muted line-through" : "text-text"}`}
        >
          {changeLines(entry, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="m-0 mt-0.5 text-xs text-muted">
          {moment(entry.at)} · {t(`privacy.sources.${entry.source}`)}
          {entry.undone ? ` · ${t("privacy.undone")}` : ""}
        </p>
      </div>
      {entry.canUndo ? (
        <Button className="shrink-0" disabled={busy} onClick={onUndo}>
          {t("privacy.undo")}
        </Button>
      ) : null}
    </li>
  );
}

export function PrivacyPanel() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { list, request, revoke } = usePermissions();
  const changes = useAnkiChanges();
  const [confirming, setConfirming] = useState<PermissionState["id"] | null>(null);
  // The phone card needs a backup and its first card, so switching it on is its own setup.
  const phone = useMutation({
    mutationFn: () => bridge.call("mobile.enable", {}),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: PERMISSIONS_KEY });
      void client.invalidateQueries({ queryKey: ["mobile.status"] });
    },
  });
  const error = request.error ?? revoke.error ?? phone.error ?? changes.undo.error;
  const states = new Map((list.data ?? []).map((state) => [state.id, state]));
  const entries = changes.list.data ?? [];
  const busy = request.isPending || revoke.isPending || phone.isPending;

  function change(state: PermissionState, allowed: boolean) {
    if (allowed) {
      if (state.id === "mobile.card") {
        phone.mutate();
      } else {
        request.mutate(state.id);
      }
    } else if (REMOVES_SOMETHING.has(state.id)) {
      setConfirming(state.id);
    } else {
      revoke.mutate(state.id);
    }
  }

  return (
    <Panel title={t("settings.sections.privacy.title")} note={t("settings.sections.privacy.note")}>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("privacy.principlesTitle")}</h3>
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
          <li>{t("privacy.principle1")}</li>
          <li>{t("privacy.principle2")}</li>
          <li>{t("privacy.principle3")}</li>
        </ul>
      </Card>
      {GROUPS.map(({ name, members }) => {
        const shown = members.flatMap((id) => states.get(id) ?? []);
        return shown.length === 0 ? null : (
          <Card key={name}>
            <h3 className="m-0 mb-3 text-[13px] font-bold">{t(`privacy.groups.${name}`)}</h3>
            {shown.map((state) => (
              <PermissionRow
                key={state.id}
                state={state}
                busy={busy}
                onChange={(allowed) => change(state, allowed)}
              />
            ))}
          </Card>
        );
      })}
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("privacy.changesTitle")}</h3>
        <p className="m-0 mt-1 mb-3 text-[13px] text-muted">{t("privacy.changesNote")}</p>
        {entries.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">{t("privacy.noChanges")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {entries.map((entry) => (
              <ChangeRow
                key={entry.id}
                entry={entry}
                busy={changes.undo.isPending}
                onUndo={() => changes.undo.mutate(entry.id)}
              />
            ))}
          </ul>
        )}
      </Card>
      {error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {error.message}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={t(`privacy.permissions.${confirming}.revokeTitle`)}
          body={t(`privacy.permissions.${confirming}.revokeBody`)}
          confirm={t("privacy.revoke")}
          onConfirm={() => {
            revoke.mutate(confirming);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </Panel>
  );
}
