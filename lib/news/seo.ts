import type { Locale } from "./types.ts";

const NEWS_DESCRIPTIONS: Record<Locale, string> = {
  en: "Verified world news with original sources, multilingual reporting, and related prediction market probabilities.",
  ru: "Проверенные мировые новости с первоисточниками, переводами и связанными вероятностями рынков прогнозов.",
};

export function newsDescription(locale: Locale): string {
  return NEWS_DESCRIPTIONS[locale];
}
