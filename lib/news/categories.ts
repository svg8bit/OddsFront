import type { Locale, NewsArticle } from "./types.ts";

export const NEWS_CATEGORIES = ["strikes", "invasions", "ceasefires", "diplomacy", "politics", "energy", "security", "humanitarian", "world"] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];

const LABELS: Record<Locale, readonly string[]> = {
  en: ["Strikes", "Invasions", "Ceasefires", "Diplomacy", "Politics", "Energy", "Security", "Humanitarian", "World affairs"],
  ru: ["Удары", "Вторжения", "Перемирия", "Дипломатия", "Политика", "Энергетика", "Безопасность", "Гуманитарные события", "Мировые события"],
};

const ALL: Record<Locale, string> = { en: "All news", ru: "Все новости" };
const NAV: Record<Locale, string> = { en: "News categories", ru: "Категории новостей" };

export function isNewsCategory(value: string): value is NewsCategory { return (NEWS_CATEGORIES as readonly string[]).includes(value); }
export function categoryLabel(category: NewsCategory, locale: Locale): string { return LABELS[locale][NEWS_CATEGORIES.indexOf(category)]; }
export function allNewsLabel(locale: Locale): string { return ALL[locale]; }
export function newsCategoriesLabel(locale: Locale): string { return NAV[locale]; }

// Classify the English reporting, so the same story keeps its topic in every language.
// Geography stays article context and never becomes a substitute editorial category.
export function articleCategory(article: Pick<NewsArticle, "title" | "topics">): NewsCategory {
  const title = article.title.toLowerCase();
  const topics = article.topics.join(" ").toLowerCase();
  const classify = (text: string): NewsCategory | null => {
    if (/\b(?:ceasefire|cease-fire|truce|peace (?:deal|agreement))\b/.test(text)) return "ceasefires";
    if (/\b(?:invasion|invad(?:e|es|ed|ing)|incursion|ground offensive)\b/.test(text)) return "invasions";
    if (/\b(?:airstrikes?|strikes?|struck|attacks?|attacked|bomb(?:ing|ardment)|shelling|missiles?|drones?)\b/.test(text)) return "strikes";
    if (/\b(?:humanitarian|refugees?|migrants?|famine|hunger|aid|evacuat\w*|floods?|earthquake|eruption|disaster)\b/.test(text)) return "humanitarian";
    if (/\b(?:oil|energy|gas|refiner\w*|tanker|crude|electricity|opec|pipeline)\b/.test(text)) return "energy";
    if (/\b(?:diplomac\w*|diplomatic|talks|negotiat\w*|summit|envoy|sanctions?|treaty)\b/.test(text)) return "diplomacy";
    if (/\b(?:elections?|vot(?:e|es|ing)|parliament|coalition|presiden\w*|minister|government|protests?|court|politic\w*)\b/.test(text)) return "politics";
    if (/\b(?:security|military|defen[cs]e|nuclear|iaea|nato|arms|weapons?|intelligence|espionage|border)\b/.test(text)) return "security";
    return null;
  };
  return classify(title) ?? classify(topics) ?? "world";
}
