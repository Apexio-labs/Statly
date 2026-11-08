import { languages } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
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
  // The same switch sits in Statly's menu in Anki, which says so when it was used there.
  useEffect(
    () =>
      bridge.on("settings.changed", () => {
        void client.invalidateQueries({ queryKey: ADDON_KEY });
      }),
    [client],
  );

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
      <Card highlight="autoUpdate">
        <div className="statly-updates flex flex-col">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-selected text-accent-strong">
              <RefreshCw size={17} aria-hidden="true" />
            </span>
            <h3 className="m-0 mr-auto text-[13px] font-bold">{t("settings.updates")}</h3>
            <span className="flex flex-wrap gap-1.5">
              <span className="statly-chip rounded-full border border-line bg-page px-2.5 py-0.5 text-xs font-semibold tabular-nums">
                Statly {info.data?.statlyVersion ?? "–"}
              </span>
              <span className="statly-chip rounded-full border border-line bg-page px-2.5 py-0.5 text-xs text-muted tabular-nums">
                Anki {info.data?.ankiVersion ?? "–"}
              </span>
            </span>
          </div>
          <div className="mt-4 border-t border-line pt-4 pl-12">
            <Row title={t("settings.autoUpdate")} note={t("settings.autoUpdateNote")}>
              <Toggle
                label={t("settings.autoUpdate")}
                checked={addon.data?.autoUpdate ?? false}
                disabled={!addon.data}
                onChange={(enabled) => setAutoUpdate.mutate(enabled)}
              />
            </Row>
          </div>
        </div>
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
