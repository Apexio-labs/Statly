import { defaultCounterColors, type Settings, themeModes } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Button } from "../../../components/Button.tsx";
import { Select } from "../../../components/Select.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { Card, Panel, Row, Toggle } from "../parts.tsx";

const COUNTERS = ["new", "learning", "due"] as const;
const MODES = ["light", "dark"] as const;

export function AppearancePanel() {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();

  function setColor(
    mode: keyof Settings["counterColors"],
    counter: (typeof COUNTERS)[number],
    color: string,
  ) {
    const colors = settings.counterColors;
    update({ counterColors: { ...colors, [mode]: { ...colors[mode], [counter]: color } } });
  }

  return (
    <Panel
      title={t("settings.sections.appearance.title")}
      note={t("settings.sections.appearance.note")}
    >
      <Card highlight="theme">
        <Row title={t("settings.theme")} note={t("settings.themeNote")}>
          <Select
            label={t("settings.theme")}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={themeModes.map((mode) => ({
              value: mode,
              label: t(`settings.themes.${mode}`),
            }))}
          />
        </Row>
      </Card>
      <Card>
        <Row title={t("settings.counterColors")} note={t("settings.counterColorsNote")}>
          <Toggle
            label={t("settings.counterColors")}
            checked={settings.counterColorsEnabled}
            onChange={(counterColorsEnabled) => update({ counterColorsEnabled })}
          />
        </Row>
        {settings.counterColorsEnabled ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {MODES.map((mode) => (
                <fieldset key={mode} className="m-0 border-0 p-0">
                  <legend className="p-0 text-xs font-bold">
                    {t(`settings.counterMode.${mode}`)}
                  </legend>
                  {COUNTERS.map((counter) => (
                    <label
                      key={counter}
                      className="mt-2 flex items-center justify-between text-[13px]"
                    >
                      {t(`settings.counters.${counter}`)}
                      <input
                        type="color"
                        value={settings.counterColors[mode][counter].toLowerCase()}
                        onChange={(event) => setColor(mode, counter, event.target.value)}
                        className="h-7 w-12 cursor-pointer rounded border border-line bg-transparent"
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <Button
              className="mt-4"
              onClick={() => update({ counterColors: defaultCounterColors })}
            >
              {t("settings.restoreColors")}
            </Button>
          </>
        ) : null}
      </Card>
    </Panel>
  );
}
