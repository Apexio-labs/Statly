import { useTranslation } from "@statly/i18n";
import { useQuery } from "@tanstack/react-query";
import { type MouseEvent, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { ANKIWEB_URL } from "./RatingDialog.tsx";

/** Python decides when this is due: weeks after installing, never on the day of a rating request. */
export function ShareDialog() {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const [state, setState] = useState<"asking" | "copied" | "closed">("asking");
  const visit = useQuery({
    queryKey: ["feedback.visit"],
    queryFn: () => bridge.call("feedback.visit", {}),
    enabled: settings.onboardingDone,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!visit.data?.askShare || state === "closed") {
    return null;
  }

  function answer(choice: "later" | "never") {
    void bridge.call("feedback.answerShare", { choice });
    setState("closed");
  }

  async function share(event: MouseEvent<HTMLButtonElement>) {
    const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
    void bridge.call("feedback.answerShare", { choice: "share" });
    const { method } = await bridge.call("system.share", {
      text: t("share.message"),
      url: ANKIWEB_URL,
      anchor: { x, y, width, height },
    });
    setState(method === "sheet" ? "closed" : "copied");
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("share.title")}
        className="flex w-full max-w-sm flex-col gap-3 rounded-popover bg-card p-6 text-text shadow-card"
      >
        <h2 className="m-0 text-lg font-bold">{t("share.title")}</h2>
        {state === "copied" ? (
          <>
            <p role="status" className="m-0 text-muted">
              {t("share.copied")}
            </p>
            <Button primary className="justify-center" onClick={() => setState("closed")}>
              {t("share.done")}
            </Button>
          </>
        ) : (
          <>
            <p className="m-0 text-muted">{t("share.body")}</p>
            <Button primary className="justify-center" onClick={(event) => void share(event)}>
              {t("share.share")}
            </Button>
            <div className="flex gap-2">
              <Button className="flex-1 justify-center" onClick={() => answer("later")}>
                {t("share.later")}
              </Button>
              <Button className="flex-1 justify-center" onClick={() => answer("never")}>
                {t("share.never")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
