import { useTranslation } from "@statly/i18n";
import mark from "@statly/ui/assets/oldschooltimeless-mark.png";
import photo from "@statly/ui/assets/oldschooltimeless-social.jpg";
import { bridge } from "../../../bridge/index.ts";
import { Button } from "../../../components/Button.tsx";
import { ANKIWEB_RATE_URL } from "../../onboarding/RatingDialog.tsx";
import { Card, Panel } from "../parts.tsx";

const REPOSITORY_URL = "https://github.com/Apexio-labs/Statly";
const NEW_ISSUE_URL = `${REPOSITORY_URL}/issues/new/choose`;
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const SPONSOR_URL = "https://oldschooltimeless.com";
const BESTSELLER_URL = "https://oldschooltimeless.com/collections/unsere-bestseller";
const COLLECTION_URL = "https://oldschooltimeless.com/collections/all";

function open(url: string) {
  void bridge.call("system.openExternal", { url });
}

export function SupportPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t("settings.sections.support.title")} note={t("settings.sections.support.note")}>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("settings.supportReportTitle")}</h3>
        <p className="m-0 mt-1 text-[13px] text-muted">{t("settings.supportReportBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button primary onClick={() => open(NEW_ISSUE_URL)}>
            {t("settings.supportReport")}
          </Button>
          <Button onClick={() => open(ISSUES_URL)}>{t("settings.supportIssues")}</Button>
          <Button onClick={() => open(REPOSITORY_URL)}>{t("settings.supportCode")}</Button>
        </div>
      </Card>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("settings.supportLikeTitle")}</h3>
        <p className="m-0 mt-1 text-[13px] text-muted">{t("settings.supportLikeBody")}</p>
        <div className="mt-3">
          <Button onClick={() => open(ANKIWEB_RATE_URL)}>{t("settings.supportLike")}</Button>
        </div>
      </Card>
      <Card>
        <h3 className="m-0 text-[13px] font-bold">{t("settings.supportTitle")}</h3>
        <p className="m-0 mt-1 text-[13px] text-muted">{t("settings.supportBody")}</p>
      </Card>
    </Panel>
  );
}

export function SupportersPanel() {
  const { t } = useTranslation();
  return (
    <Panel
      title={t("settings.sections.supporters.title")}
      note={t("settings.sections.supporters.note")}
    >
      <Card>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-selected font-bold text-accent-strong"
          >
            J
          </span>
          <div>
            <h3 className="m-0 text-[13px] font-bold">JojoXGames</h3>
            <p className="m-0 mt-0.5 text-[13px] text-muted">{t("settings.jojoRole")}</p>
          </div>
        </div>
      </Card>
    </Panel>
  );
}

export function SponsorPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t("settings.sections.sponsor.title")} note={t("settings.sections.sponsor.note")}>
      <Card>
        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <div>
            <div className="flex items-center gap-3">
              <img src={mark} alt="" className="size-11 rounded-control" />
              <div>
                <p className="m-0 text-xs font-semibold text-accent-strong">
                  {t("settings.sponsoredBy")} Oldschool Timeless
                </p>
                <h3 className="m-0 text-[15px] font-bold">{t("settings.sponsorTitle")}</h3>
              </div>
            </div>
            <p className="m-0 mt-3 text-[13px] text-muted">{t("settings.sponsorBody")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => open(BESTSELLER_URL)}>
                {t("settings.sponsorBestsellers")}
              </Button>
              <Button onClick={() => open(COLLECTION_URL)}>
                {t("settings.sponsorCollections")}
              </Button>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("settings.sponsorVisit")}
            onClick={() => open(SPONSOR_URL)}
            className="cursor-pointer overflow-hidden rounded-control border-0 bg-transparent p-0"
          >
            <img src={photo} alt="" className="h-full w-full object-cover" />
          </button>
        </div>
      </Card>
    </Panel>
  );
}
