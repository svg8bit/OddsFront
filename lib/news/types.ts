export const LOCALES = ["en", "zh", "ko", "vi", "de", "es", "pt-BR", "fr", "ru", "uk", "fa", "he"] as const;
export type Locale = typeof LOCALES[number];
export type ArticleBlock = { type: "paragraph" | "heading"; text: string };
export type ArticleText = { title: string; description: string; body: ArticleBlock[] };
export interface NewsSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: "media" | "official";
  publishedAt: string;
  evidence: string;
}
export interface NewsDraft extends ArticleText {
  publishable: boolean;
  rejectionReason: string;
  countries: string[];
  topics: string[];
  sources: NewsSource[];
  factChecks: { claim: string; sourceIds: string[] }[];
}
export interface NewsArticle extends ArticleText {
  id: string;
  slug: string;
  publishedAt: string;
  updatedAt: string;
  author: string;
  readingMinutes?: number;
  countries: string[];
  topics: string[];
  sources: Omit<NewsSource, "evidence">[];
  translations: Partial<Record<Locale, ArticleText>>;
}
export interface NewsCatalog {
  version: 1;
  updatedAt: string;
  articles: NewsArticle[];
  marketTranslations: Partial<Record<Locale, Record<string, string>>>;
}
