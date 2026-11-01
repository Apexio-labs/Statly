import { useTranslation } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { Card, Panel, Row } from "../parts.tsx";

const STATUS_KEY = ["mobile.status"];

export function MobilePanel() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => bridge.call("mobile.status", {}),
  });
  const onChanged = (next: unknown) => {
    client.setQueryData(STATUS_KEY, next);
    setConfirming(false);
    return client.invalidateQueries({ queryKey: ["settings"] });
  };
  const enable = useMutation({
    mutationFn: () => bridge.call("mobile.enable", {}),
    onSuccess: onChanged,
  });
  const disable = useMutation({
    mutationFn: () => bridge.call("mobile.disable", {}),
    onSuccess: onChanged,
  });
  const refresh = useMutation({
    mutationFn: () => bridge.call("mobile.refresh", {}),
    onSuccess: onChanged,
  });
  const enabled = status.data?.enabled ?? false;
  const updated = status.data?.updated;
  const error = enable.error ?? disable.error ?? refresh.error;

  return (
    <Panel title={t("settings.sections.mobile.title")} note={t("settings.sections.mobile.note")}>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("mobile.howTitle")}</h3>
        <ol className="m-0 mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-muted">
          <li>{t("mobile.step1")}</li>
          <li>{t("mobile.step2")}</li>
          <li>{t("mobile.step3")}</li>
        </ol>
      </Card>
      <Card>
        {enabled ? (
          <>
            <Row
              title={t("mobile.on")}
              note={
                updated
                  ? t("mobile.updated", {
                      when: new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(updated)),
                    })
                  : ""
              }
            >
              <Button className="shrink-0" onClick={() => refresh.mutate()}>
                {t("mobile.refresh")}
              </Button>
            </Row>
            <div className="mt-4 border-t border-line pt-4">
              <Row title={t("mobile.remove")} note={t("mobile.removeNote")}>
                {removing ? (
                  <div className="flex shrink-0 gap-2">
                    <Button className="text-danger" onClick={() => disable.mutate()}>
                      {t("mobile.removeConfirm")}
                    </Button>
                    <Button onClick={() => setRemoving(false)}>{t("dashboard.cancel")}</Button>
                  </div>
                ) : (
                  <Button className="shrink-0 text-danger" onClick={() => setRemoving(true)}>
                    {t("mobile.remove")}
                  </Button>
                )}
              </Row>
            </div>
          </>
        ) : confirming ? (
          <>
            <h3 className="m-0 text-[13px] font-bold">{t("mobile.confirmTitle")}</h3>
            <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
              <li>{t("mobile.confirm1")}</li>
              <li>{t("mobile.confirm2")}</li>
              <li>{t("mobile.confirm3")}</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Button primary disabled={enable.isPending} onClick={() => enable.mutate()}>
                {t("mobile.confirmAction")}
              </Button>
              <Button onClick={() => setConfirming(false)}>{t("dashboard.cancel")}</Button>
            </div>
          </>
        ) : (
          <Row title={t("mobile.off")} note={t("mobile.offNote")}>
            <Button primary className="shrink-0" onClick={() => setConfirming(true)}>
              {t("mobile.enable")}
            </Button>
          </Row>
        )}
        {error ? (
          <p role="alert" className="m-0 mt-3 text-xs text-danger">
            {error.message}
          </p>
        ) : null}
      </Card>
      <Card>
        <Row title={t("devices.settingsTitle")} note={t("devices.settingsNote")}>
          <Link
            to="/?device=phone"
            className="inline-flex h-10 shrink-0 items-center rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text no-underline hover:bg-hover"
          >
            {t("devices.settingsAction")}
          </Link>
        </Row>
      </Card>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("mobile.limitsTitle")}</h3>
        <p className="m-0 mt-1 text-[13px] text-muted">{t("mobile.limits")}</p>
      </Card>
    </Panel>
  );
}
