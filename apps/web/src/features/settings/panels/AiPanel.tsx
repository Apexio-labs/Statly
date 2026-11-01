import { useTranslation } from "@statly/i18n";
import { Button } from "../../../components/Button.tsx";
import { useShell } from "../../../shell/ShellContext.tsx";
import { Card, Panel } from "../parts.tsx";

export function AiPanel() {
  const { t } = useTranslation();
  const { openAi } = useShell();
  return (
    <Panel title={t("settings.sections.ai.title")} note={t("settings.sections.ai.note")}>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("settings.aiTitle")}</h3>
        <p className="m-0 mt-1 mb-3 text-[13px] text-muted">{t("settings.aiBody")}</p>
        <Button primary onClick={openAi}>
          {t("settings.aiOpen")}
        </Button>
      </Card>
    </Panel>
  );
}
