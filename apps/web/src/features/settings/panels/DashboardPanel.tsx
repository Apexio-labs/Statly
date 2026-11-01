import type { Settings } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { useLayout } from "../../dashboard/useLayout.ts";
import { useMedia } from "../../widgets/useCustomWidgets.ts";
import { Card, Panel, Row, Toggle } from "../parts.tsx";

const DEVICES = ["desktop", "tablet", "phone"] as const;

function BackgroundSlot({ device }: { device: (typeof DEVICES)[number] }) {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const client = useQueryClient();
  const asset = settings.dashboardBackgrounds[device];
  const url = useMedia(asset?.id);
  const changed = (next: Settings) => client.setQueryData(["settings"], next);
  const choose = useMutation({
    mutationFn: () => bridge.call("dashboard.chooseBackground", { device }),
    onSuccess: changed,
  });
  const remove = useMutation({
    mutationFn: () => bridge.call("dashboard.removeBackground", { device }),
    onSuccess: changed,
  });
  return (
    <div data-background={device} className="flex flex-col gap-2">
      <h4 className="m-0 text-xs font-semibold text-muted">{t(`devices.${device}`)}</h4>
      <div
        className="h-24 rounded-control border border-line bg-page bg-cover bg-center"
        style={url ? { backgroundImage: `url("${url}")` } : undefined}
      />
      <div className="flex gap-1.5">
        <Button className="h-8 flex-1 justify-center" onClick={() => choose.mutate()}>
          {t("settings.backgroundChoose")}
        </Button>
        {asset ? (
          <Button className="h-8 text-danger" onClick={() => remove.mutate()}>
            {t("settings.backgroundRemove")}
          </Button>
        ) : null}
      </div>
      {choose.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {choose.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function DashboardPanel() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const { reset } = useLayout();
  return (
    <Panel
      title={t("settings.sections.dashboard.title")}
      note={t("settings.sections.dashboard.note")}
    >
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("settings.backgrounds")}</h3>
        <p className="m-0 mt-0.5 mb-3 text-xs text-muted">{t("settings.backgroundsNote")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEVICES.map((device) => (
            <BackgroundSlot key={device} device={device} />
          ))}
        </div>
      </Card>
      <Card>
        <Row title={t("settings.deckHeatmap")} note={t("settings.deckHeatmapNote")}>
          <Toggle
            label={t("settings.deckHeatmap")}
            checked={settings.deckHeatmap}
            onChange={(deckHeatmap) => update({ deckHeatmap })}
          />
        </Row>
      </Card>
      <Card>
        <Row title={t("settings.brandAnimation")} note={t("settings.brandAnimationNote")}>
          <Toggle
            label={t("settings.brandAnimation")}
            checked={settings.brandAnimation}
            onChange={(brandAnimation) => update({ brandAnimation })}
          />
        </Row>
      </Card>
      <Card>
        <Row title={t("settings.resetDashboard")} note={t("settings.resetDashboardNote")}>
          <Button className="shrink-0" onClick={() => reset.mutate()}>
            <RotateCcw size={15} />
            {reset.isSuccess ? t("settings.resetDone") : t("settings.resetAction")}
          </Button>
        </Row>
      </Card>
    </Panel>
  );
}
