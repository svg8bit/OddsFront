export const LOCALES = ["en", "zh", "ko", "vi", "de", "es", "pt-BR", "fr", "ru", "uk", "fa", "he"] as const;
export type Locale = typeof LOCALES[number];
export type ArticleBlock = { type: "paragraph" | "heading"; text: string };
export type ArticleText = { title: string; description: string; body: ArticleBlock[]; editorReviewed?: boolean };
export type NewsAlertKind = "strike" | "ceasefire";
export interface NewsAlertDraft {
  eligible: boolean;
  kind: NewsAlertKind | "none";
  actorCountries: string[];
  targetCountries: string[];
}
export interface NewsAlert {
  kind: NewsAlertKind;
  actorCountries: string[];
  targetCountries: string[];
}
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
  alert: NewsAlertDraft;
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
  /** Anonymous article reads in the preceding seven days, across all locales. */
  views7d?: number;
  /** Retained privately for permanent novelty exclusion; never republished. */
  withdrawal?: { at: string; duplicateOf: string };
  countries: string[];
  topics: string[];
  alert?: NewsAlert | null;
  cover?: { imageUrl: string; sourceUrl: string; verifiedAt: string };
  sources: Omit<NewsSource, "evidence">[];
  translations: Partial<Record<Locale, ArticleText>>;
}
export interface NewsCatalog {
  version: 1;
  updatedAt: string;
  articles: NewsArticle[];
  marketTranslations: Partial<Record<Locale, Record<string, string>>>;
}
