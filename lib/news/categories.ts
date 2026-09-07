import type { Locale, NewsArticle } from "./types.ts";

export const NEWS_CATEGORIES = ["strikes", "invasions", "ceasefires", "diplomacy", "politics", "energy", "security", "humanitarian", "world"] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];

const LABELS: Record<Locale, readonly string[]> = {
  en: ["Strikes", "Invasions", "Ceasefires", "Diplomacy", "Politics", "Energy", "Security", "Humanitarian", "World affairs"],
  ru: ["Удары", "Вторжения", "Перемирия", "Дипломатия", "Политика", "Энергетика", "Безопасность", "Гуманитарные события", "Мировые события"],
  uk: ["Удари", "Вторгнення", "Перемир’я", "Дипломатія", "Політика", "Енергетика", "Безпека", "Гуманітарні події", "Світові події"],
  zh: ["军事打击", "入侵", "停火", "外交", "政治", "能源", "安全", "人道事务", "国际事务"],
  ko: ["공격", "침공", "휴전", "외교", "정치", "에너지", "안보", "인도주의", "국제 정세"],
  vi: ["Các cuộc tấn công", "Xâm lược", "Ngừng bắn", "Ngoại giao", "Chính trị", "Năng lượng", "An ninh", "Nhân đạo", "Thế giới"],
  de: ["Angriffe", "Invasionen", "Waffenruhen", "Diplomatie", "Politik", "Energie", "Sicherheit", "Humanitäres", "Weltgeschehen"],
  es: ["Ataques", "Invasiones", "Altos el fuego", "Diplomacia", "Política", "Energía", "Seguridad", "Ayuda humanitaria", "Mundo"],
  "pt-BR": ["Ataques", "Invasões", "Cessar-fogo", "Diplomacia", "Política", "Energia", "Segurança", "Ajuda humanitária", "Mundo"],
  fr: ["Frappes", "Invasions", "Cessez-le-feu", "Diplomatie", "Politique", "Énergie", "Sécurité", "Humanitaire", "Monde"],
  fa: ["حملات", "تهاجم", "آتش‌بس", "دیپلماسی", "سیاست", "انرژی", "امنیت", "امور بشردوستانه", "رویدادهای جهان"],
  he: ["תקיפות", "פלישות", "הפסקות אש", "דיפלומטיה", "פוליטיקה", "אנרגיה", "ביטחון", "סוגיות הומניטריות", "אירועי העולם"],
};

const ALL: Record<Locale, string> = { en: "All news", ru: "Все новости", uk: "Усі новини", zh: "全部新闻", ko: "전체 뉴스", vi: "Tất cả tin tức", de: "Alle Nachrichten", es: "Todas las noticias", "pt-BR": "Todas as notícias", fr: "Toutes les actualités", fa: "همه اخبار", he: "כל החדשות" };
const NAV: Record<Locale, string> = { en: "News categories", ru: "Категории новостей", uk: "Категорії новин", zh: "新闻分类", ko: "뉴스 분야", vi: "Chuyên mục tin tức", de: "Nachrichtenkategorien", es: "Categorías de noticias", "pt-BR": "Categorias de notícias", fr: "Rubriques", fa: "دسته‌بندی اخبار", he: "קטגוריות חדשות" };

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
