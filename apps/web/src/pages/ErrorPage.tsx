import { useTranslation } from "@statly/i18n";
import { Button } from "../components/Button.tsx";

export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center bg-page p-8 text-center">
      <div>
        <h1 className="m-0 text-xl font-bold text-text">{t("error.title")}</h1>
        <p className="mt-2 text-muted">{t("error.body")}</p>
        <Button primary onClick={() => location.reload()}>
          {t("error.reload")}
        </Button>
      </div>
    </div>
  );
}
