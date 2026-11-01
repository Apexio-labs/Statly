import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import de from "../locales/de.json";
import en from "../locales/en.json";

export const resources = {
  en: { translation: en },
  de: { translation: de },
} as const;

export type Language = keyof typeof resources;

export function resolveLanguage(language: string): Language {
  const base = language.toLowerCase().split(/[-_]/)[0];
  return base === "de" ? "de" : "en";
}

export async function initI18n(language: string) {
  await i18next.use(initReactI18next).init({
    lng: resolveLanguage(language),
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
  return i18next;
}

export async function setLanguage(language: Language) {
  await i18next.changeLanguage(language);
}

export { useTranslation } from "react-i18next";
