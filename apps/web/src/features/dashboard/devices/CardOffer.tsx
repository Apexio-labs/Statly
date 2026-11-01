import { useTranslation } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";

const STATUS_KEY = ["mobile.status"];

function loadStatus() {
  return bridge.call("mobile.status", {});
}

/**
 * Whoever arranges a phone or tablet wants to see it there, so the card is offered right where it
 * matters. It is asked once per editing session and never changes anything without a yes.
 */
export function useCardOffer() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: loadStatus });
  const asked = useRef(false);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  const enable = useMutation({
    mutationFn: () => bridge.call("mobile.enable", {}),
    onSuccess: (next) => client.setQueryData(STATUS_KEY, next),
  });

  function finish() {
    waiting?.();
    setWaiting(null);
  }

  return {
    /** Runs `go_on` at once, or after the person has answered. */
    offerBefore(goOn: () => void) {
      function decide(enabled: boolean) {
        if (enabled || asked.current) {
          goOn();
          return;
        }
        asked.current = true;
        setWaiting(() => goOn);
      }
      if (status.data) {
        decide(status.data.enabled);
        return;
      }
      // Someone quick can save before the first answer arrives, and must still get the offer.
      client.ensureQueryData({ queryKey: STATUS_KEY, queryFn: loadStatus }).then(
        (current) => decide(current.enabled),
        () => goOn(),
      );
    },
    resetOffer() {
      asked.current = false;
    },
    dialog: waiting ? (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={t("devices.offerTitle")}
          className="flex w-full max-w-sm flex-col gap-3 rounded-popover bg-card p-6 text-text shadow-card"
        >
          <h2 className="m-0 text-lg font-bold">{t("devices.offerTitle")}</h2>
          <p className="m-0 text-[13px] text-muted">{t("devices.offerBody")}</p>
          {enable.error ? (
            <p role="alert" className="m-0 text-xs text-danger">
              {enable.error.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={finish}>{t("devices.offerLater")}</Button>
            <Button
              primary
              disabled={enable.isPending}
              onClick={() => enable.mutate(undefined, { onSuccess: finish })}
            >
              {t("devices.offerAccept")}
            </Button>
          </div>
        </div>
      </div>
    ) : null,
  };
}
