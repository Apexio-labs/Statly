import { useTranslation } from "@statly/i18n";
import { useEffect } from "react";
import { Button } from "./Button.tsx";

/** Asks once more before something that is easy to click and hard to take back. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-sm flex-col gap-3 rounded-popover bg-card p-6 text-text shadow-card"
      >
        <h2 className="m-0 text-lg font-bold">{title}</h2>
        <p className="m-0 text-[13px] text-muted">{body}</p>
        <div className="mt-1 flex gap-2">
          {/* Cancel comes first and takes the focus: Enter alone must never reset anything. */}
          <Button autoFocus className="flex-1 justify-center" onClick={onCancel}>
            {t("dashboard.cancel")}
          </Button>
          <Button className="flex-1 justify-center text-danger" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
