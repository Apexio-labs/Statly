import { useTranslation } from "@statly/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { useAppearance } from "../../lib/appearance.tsx";

export const ANKIWEB_URL = "https://ankiweb.net/shared/info/215470814";

/** Python decides when this is due, based on how much Statly has been used. */
export function RatingDialog() {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const [dismissed, setDismissed] = useState(false);
  const visit = useQuery({
    queryKey: ["feedback.visit"],
    queryFn: () => bridge.call("feedback.visit", {}),
    enabled: settings.onboardingDone,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!visit.data?.askRating || dismissed) {
    return null;
  }

  function answer(choice: "rate" | "later" | "never") {
    void bridge.call("feedback.answer", { choice });
    if (choice === "rate") {
      void bridge.call("system.openExternal", { url: ANKIWEB_URL });
    }
    setDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("rating.title")}
        className="flex w-full max-w-sm flex-col gap-3 rounded-popover bg-card p-6 text-text shadow-card"
      >
        <h2 className="m-0 text-lg font-bold">{t("rating.title")}</h2>
        <p className="m-0 text-muted">{t("rating.body")}</p>
        <Button primary className="justify-center" onClick={() => answer("rate")}>
          {t("rating.rate")}
        </Button>
        <div className="flex gap-2">
          <Button className="flex-1 justify-center" onClick={() => answer("later")}>
            {t("rating.later")}
          </Button>
          <Button className="flex-1 justify-center" onClick={() => answer("never")}>
            {t("rating.never")}
          </Button>
        </div>
      </div>
    </div>
  );
}
