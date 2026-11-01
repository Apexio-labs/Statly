import type { Settings } from "@statly/contract";
import { resolveLanguage, setLanguage } from "@statly/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { bridge } from "../bridge/index.ts";

type Appearance = {
  settings: Settings;
  /** The theme in effect, after resolving "system" to Anki's mode. */
  theme: string;
  update: (patch: Partial<Settings>) => void;
};

const AppearanceContext = createContext<Appearance | null>(null);

const SETTINGS_KEY = ["settings"];

export function AppearanceProvider({
  initial,
  ankiLanguage,
  ankiNightMode,
  children,
}: {
  initial: Settings;
  ankiLanguage: string;
  ankiNightMode: boolean;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const [nightMode, setNightMode] = useState(ankiNightMode);
  const { data: settings = initial } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => bridge.call("settings.get", {}),
    initialData: initial,
  });
  const { mutate } = useMutation({
    mutationFn: (patch: Partial<Settings>) => bridge.call("settings.update", patch),
    // Applied at once, so a released sidebar never jumps back while Python saves it.
    onMutate: (patch) => {
      client.setQueryData<Settings>(SETTINGS_KEY, (current) =>
        current ? { ...current, ...patch } : current,
      );
    },
    onSuccess: (updated) => client.setQueryData(SETTINGS_KEY, updated),
    onError: () => client.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });

  useEffect(() => bridge.on("host.themeChanged", (event) => setNightMode(event.nightMode)), []);

  const theme = settings.theme === "system" ? (nightMode ? "dark" : "light") : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const language = settings.language === "auto" ? ankiLanguage : settings.language;
    void setLanguage(resolveLanguage(language));
  }, [settings.language, ankiLanguage]);

  const value = useMemo(() => ({ settings, theme, update: mutate }), [settings, theme, mutate]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  const appearance = useContext(AppearanceContext);
  if (!appearance) {
    throw new Error("useAppearance needs an AppearanceProvider.");
  }
  return appearance;
}
