import type { AiStatus } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { useShell } from "../../../shell/ShellContext.tsx";
import {
  AutoMode,
  ChatStorage,
  ExternalApps,
  PermissionSwitches,
} from "../../ai/AiSettingsParts.tsx";
import { KeyLockSection } from "../../ai/KeyLock.tsx";
import { SetupView } from "../../ai/SetupView.tsx";
import { useAiStatus } from "../../ai/useAi.ts";
import { Card, Panel, Row } from "../parts.tsx";

/** What can widen the assistant's reach stays folded away, as it was decided for Statly 2. */
function Advanced({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-[13px] font-bold text-text"
      >
        {t("ai.advanced.title")}
        <ChevronDown size={15} className={`text-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <ExternalApps status={status} />
          <AutoMode status={status} />
        </>
      ) : null}
    </section>
  );
}

/** Everything about the assistant in one place. The chat itself stays in its own panel. */
export function AiPanel() {
  const { t } = useTranslation();
  const { openAi } = useShell();
  const status = useAiStatus().data;

  return (
    <Panel title={t("settings.sections.ai.title")} note={t("settings.sections.ai.note")}>
      <Card>
        <Row title={t("settings.aiTitle")} note={t("settings.aiBody")}>
          <Button className="shrink-0" onClick={openAi}>
            {t("settings.aiOpen")}
          </Button>
        </Row>
      </Card>
      {status ? (
        <>
          <Card highlight="ai-service">
            <h3 className="m-0 mb-4 text-[13px] font-bold">{t("ai.settings.service")}</h3>
            <SetupView status={status} />
          </Card>
          <Card highlight="ai-permissions">
            <h3 className="m-0 text-[13px] font-bold">{t("ai.advanced.permissions")}</h3>
            <p className="m-0 mt-1 mb-4 text-xs text-muted">{t("ai.settings.permissionsNote")}</p>
            <PermissionSwitches status={status} />
          </Card>
          <Card>
            <KeyLockSection status={status} />
          </Card>
          <Card>
            <ChatStorage status={status} />
          </Card>
          <Card>
            <Advanced status={status} />
          </Card>
        </>
      ) : null}
    </Panel>
  );
}
