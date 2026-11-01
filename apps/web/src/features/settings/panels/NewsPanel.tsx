import { useTranslation } from "@statly/i18n";
import { Card, Panel } from "../parts.tsx";

export function NewsPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t("settings.sections.news.title")} note={t("settings.sections.news.note")}>
      <Card>
        <h3 className="m-0 text-[15px] font-bold">{t("settings.newsTitle")}</h3>
        <p className="m-0 mt-2 text-[13px] text-muted">{t("settings.newsBody")}</p>
      </Card>
    </Panel>
  );
}
