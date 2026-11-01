import { discoverySources, languages, themeModes, userRoles } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import discoveryArt from "@statly/ui/assets/onboarding/discovery.svg";
import identityArt from "@statly/ui/assets/onboarding/identity.svg";
import logoOnLight from "@statly/ui/assets/Statly_Logo_Cropped.png";
import logoOnDark from "@statly/ui/assets/Statly_Logo_Cropped_Dark.png";
import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { useAppearance } from "../../lib/appearance.tsx";

const STEPS = ["welcome", "language", "role", "discovery", "theme"] as const;

function Choice({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="h-11 cursor-pointer rounded-control border border-line bg-control px-4 text-left text-[13px] font-semibold text-text hover:bg-hover aria-pressed:border-accent aria-pressed:bg-selected"
    >
      {label}
    </button>
  );
}

/** The first-run setup. Everything here can be changed later in Settings. */
export function OnboardingDialog() {
  const { t } = useTranslation();
  const { settings, theme, update } = useAppearance();
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);

  if (settings.onboardingDone) {
    return null;
  }
  const current = STEPS[step];
  const answers = settings.onboardingAnswers;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("welcome.title")}
        className="flex w-full max-w-md flex-col gap-4 rounded-popover bg-card p-6 text-text shadow-card"
      >
        <p className="m-0 text-xs text-muted">
          {t("welcome.step", { current: step + 1, total: STEPS.length })}
        </p>
        {current === "welcome" ? (
          <>
            <img
              src={theme === "dark" ? logoOnDark : logoOnLight}
              alt="Statly"
              className="mx-auto w-40"
            />
            <h2 className="m-0 text-center text-xl font-bold">{t("welcome.title")}</h2>
            <p className="m-0 text-center text-muted">{t("welcome.body")}</p>
            <label className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>{t("welcome.terms")}</span>
            </label>
          </>
        ) : null}
        {current === "language" ? (
          <>
            <h2 className="m-0 text-lg font-bold">{t("welcome.chooseLanguage")}</h2>
            <div className="flex flex-col gap-2">
              {languages.map((language) => (
                <Choice
                  key={language}
                  label={t(`settings.languages.${language}`)}
                  selected={settings.language === language}
                  onSelect={() => update({ language })}
                />
              ))}
            </div>
          </>
        ) : null}
        {current === "role" ? (
          <>
            <img src={identityArt} alt="" className="mx-auto h-16" />
            <h2 className="m-0 text-lg font-bold">{t("welcome.role")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {userRoles.map((role) => (
                <Choice
                  key={role}
                  label={t(`welcome.roles.${role}`)}
                  selected={answers.role === role}
                  onSelect={() => update({ onboardingAnswers: { ...answers, role } })}
                />
              ))}
            </div>
          </>
        ) : null}
        {current === "discovery" ? (
          <>
            <img src={discoveryArt} alt="" className="mx-auto h-16" />
            <h2 className="m-0 text-lg font-bold">{t("welcome.discovery")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {discoverySources.map((discovery) => (
                <Choice
                  key={discovery}
                  label={t(`welcome.discoverySources.${discovery}`)}
                  selected={answers.discovery === discovery}
                  onSelect={() => update({ onboardingAnswers: { ...answers, discovery } })}
                />
              ))}
            </div>
          </>
        ) : null}
        {current === "theme" ? (
          <>
            <h2 className="m-0 text-lg font-bold">{t("welcome.chooseTheme")}</h2>
            <p className="m-0 text-muted">{t("welcome.themeNote")}</p>
            <div className="flex flex-col gap-2">
              {themeModes.map((theme) => (
                <Choice
                  key={theme}
                  label={t(`settings.themes.${theme}`)}
                  selected={settings.theme === theme}
                  onSelect={() => update({ theme })}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className="flex justify-between">
          {step > 0 ? (
            <Button onClick={() => setStep(step - 1)}>{t("welcome.back")}</Button>
          ) : (
            <span />
          )}
          <Button
            primary
            disabled={current === "welcome" && !accepted}
            onClick={() => (last ? update({ onboardingDone: true }) : setStep(step + 1))}
          >
            {last ? t("welcome.start") : t("welcome.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
