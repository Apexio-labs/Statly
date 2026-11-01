import { type AiStatus, aiPermissionScopes } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { KeyLockSection } from "./KeyLock.tsx";
import { SwitchRow } from "./SwitchRow.tsx";
import { useAiSetting } from "./useAi.ts";

/** Turning this on needs a deliberate second step, turning it off never does. */
function RiskySwitch({
  title,
  note,
  warning,
  checked,
  onConfirm,
}: {
  title: string;
  note: string;
  warning: string[];
  checked: boolean;
  onConfirm: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);

  function close() {
    setAsking(false);
    setUnderstood(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <SwitchRow
        title={title}
        note={note}
        checked={checked}
        onChange={(next) => (next ? setAsking(true) : onConfirm(false))}
      />
      {asking ? (
        <div
          role="alertdialog"
          aria-label={t("ai.auto.warningTitle")}
          className="flex flex-col gap-2 rounded-control border border-danger p-3"
        >
          <h4 className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-danger">
            <TriangleAlert size={15} />
            {t("ai.auto.warningTitle")}
          </h4>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
            {warning.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            {t("ai.auto.understood")}
          </label>
          <div className="flex gap-2">
            <Button
              className="h-8 text-danger"
              disabled={!understood}
              onClick={() => {
                onConfirm(true);
                close();
              }}
            >
              {t("ai.auto.enable")}
            </Button>
            <Button className="h-8" onClick={close}>
              {t("dashboard.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExternalApps({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const setExternal = useAiSetting("ai.setExternal");
  const newCode = useMutation({ mutationFn: () => bridge.call("ai.newExternalCode", {}) });
  const save = useMutation({ mutationFn: () => bridge.call("ai.saveBridge", {}) });
  const refresh = useAiSetting("ai.setExternal");
  const share = useAiSetting("ai.setExternalPermissions");
  const code = newCode.data?.code;

  return (
    <div className="flex flex-col gap-2">
      <SwitchRow
        title={t("ai.external.title")}
        note={t("ai.external.note")}
        checked={status.external.enabled}
        onChange={(enabled) => setExternal.mutate({ enabled })}
      />
      {status.external.enabled ? (
        <div className="flex flex-col gap-2 rounded-control border border-line p-3">
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-xs text-muted">
            <li>{t("ai.external.step1")}</li>
            <li>{t("ai.external.step2")}</li>
            <li>{t("ai.external.step3")}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button className="h-8" onClick={() => save.mutate()}>
              {t("ai.external.saveBundle")}
            </Button>
            <Button
              className="h-8"
              onClick={() =>
                newCode.mutate(undefined, {
                  onSuccess: () => refresh.mutate({ enabled: true }),
                })
              }
            >
              {t(status.external.hasCode ? "ai.external.renewCode" : "ai.external.newCode")}
            </Button>
          </div>
          {code ? (
            <div className="flex flex-col gap-1">
              <input
                readOnly
                value={code}
                aria-label={t("ai.external.code")}
                onFocus={(event) => event.target.select()}
                className="h-9 w-full rounded-control border border-line bg-page px-2 text-[11px] text-text"
              />
              <p className="m-0 text-[11px] text-muted">{t("ai.external.codeOnce")}</p>
            </div>
          ) : null}
          {status.external.hasCode && !status.external.running ? (
            <p role="alert" className="m-0 text-xs text-danger">
              {t("ai.external.portBusy")}
            </p>
          ) : null}
          {newCode.error ? (
            <p role="alert" className="m-0 text-xs text-danger">
              {newCode.error.message}
            </p>
          ) : null}
          <SwitchRow
            title={t("ai.external.permissions")}
            note={t("ai.external.permissionsNote")}
            checked={status.externalPermissions}
            onChange={(allowed) => share.mutate({ allowed })}
          />
          <p className="m-0 text-[11px] text-muted">{t("ai.external.limits")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function AdvancedView({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const setPermission = useAiSetting("ai.setPermission");
  const setKeepChats = useAiSetting("ai.setKeepChats");
  const setAuto = useAiSetting("ai.setAutoMode");
  const setAutoExternal = useAiSetting("ai.setAutoExternal");
  const warning = [t("ai.auto.warning1"), t("ai.auto.warning2"), t("ai.auto.warning3")];

  return (
    <div className="mt-3 flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <h4 className="m-0 text-xs font-bold">{t("ai.advanced.permissions")}</h4>
        {aiPermissionScopes.map((scope) => (
          <SwitchRow
            key={scope}
            title={t(`ai.permission.${scope}.setting`)}
            note={t(`ai.permission.${scope}.settingNote`)}
            checked={status.permissions[scope]}
            onChange={(allowed) => setPermission.mutate({ scope, allowed })}
          />
        ))}
      </section>
      <KeyLockSection status={status} />
      <SwitchRow
        title={t("ai.advanced.keepChats")}
        note={t("ai.advanced.keepChatsNote")}
        checked={status.keepChats}
        onChange={(keep) => setKeepChats.mutate({ keep })}
      />
      <ExternalApps status={status} />
      <RiskySwitch
        title={t("ai.auto.title")}
        note={t("ai.auto.note")}
        warning={warning}
        checked={status.autoMode}
        onConfirm={(enabled) => setAuto.mutate({ enabled, acknowledged: enabled })}
      />
      {status.autoMode && status.external.enabled ? (
        <RiskySwitch
          title={t("ai.auto.externalTitle")}
          note={t("ai.auto.externalNote")}
          warning={warning}
          checked={status.autoExternal}
          onConfirm={(enabled) => setAutoExternal.mutate({ enabled, acknowledged: enabled })}
        />
      ) : null}
    </div>
  );
}
