import { languages } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { Select } from "../../../components/Select.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { Card, Panel, Row, Toggle } from "../parts.tsx";

const ADDON_KEY = ["system.addon"];

export function GeneralPanel() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const client = useQueryClient();
  const info = useQuery({
    queryKey: ["system.info"],
    queryFn: () => bridge.call("system.info", {}),
  });
  const addon = useQuery({
    queryKey: ADDON_KEY,
    queryFn: () => bridge.call("system.addon", {}),
  });
  const setAutoUpdate = useMutation({
    mutationFn: (enabled: boolean) => bridge.call("system.setAutoUpdate", { enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ADDON_KEY }),
  });

  return (
    <Panel title={t("settings.sections.general.title")} note={t("settings.sections.general.note")}>
      <Card highlight="language">
        <Row title={t("settings.language")} note={t("settings.languageNote")}>
          <Select
            label={t("settings.language")}
            value={settings.language}
            onChange={(language) => update({ language })}
            options={languages.map((language) => ({
              value: language,
              label: t(`settings.languages.${language}`),
            }))}
          />
        </Row>
      </Card>
      <Card highlight="fullscreen">
        <Row title={t("settings.fullscreen")} note={t("settings.fullscreenNote")}>
          <Toggle
            label={t("settings.fullscreen")}
            checked={settings.openFullscreen}
            onChange={(openFullscreen) => update({ openFullscreen })}
          />
        </Row>
      </Card>
      <Card highlight="goalToast">
        <Row title={t("settings.goalToast")} note={t("settings.goalToastNote")}>
          <Toggle
            label={t("settings.goalToast")}
            checked={settings.goalToast}
            onChange={(goalToast) => update({ goalToast })}
          />
        </Row>
      </Card>
      <Card>
        <Row
          title={t("settings.updates")}
          note={t("settings.version", {
            statly: info.data?.statlyVersion ?? "–",
            anki: info.data?.ankiVersion ?? "–",
          })}
        />
      </Card>
      <Card highlight="autoUpdate">
        <Row title={t("settings.autoUpdate")} note={t("settings.autoUpdateNote")}>
          <Toggle
            label={t("settings.autoUpdate")}
            checked={addon.data?.autoUpdate ?? false}
            disabled={!addon.data}
            onChange={(enabled) => setAutoUpdate.mutate(enabled)}
          />
        </Row>
      </Card>
      <Card>
        <Row title={t("settings.uninstall")} note={t("settings.uninstallNote")}>
          <Button
            className="shrink-0 text-danger"
            onClick={() => void bridge.call("system.uninstall", {})}
          >
            {t("settings.uninstall")}
          </Button>
        </Row>
      </Card>
    </Panel>
  );
}
