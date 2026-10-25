export const LOCALES = ["en", "ru"] as const;
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
/** A Polymarket market found for the article's own story when it was written (prices refresh live on the page). */
export interface ArticleMarket {
  id: string;
  question: string;
  eventTitle?: string;
  eventSlug?: string;
  conditionId?: string | null;
  yesTokenId?: string;
  image?: string | null;
  chance: number;
  weekChange?: number | null;
  volume: number;
  endDate?: string;
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
  /**
   * Partner covers (default) are proxied from the source's Open Graph image.
   * "own": OddsFront's map cover, served by the feed at /v1/news/articles/<slug>/cover.jpg.
   * "none": never show a publisher photo; the site draws its own artwork.
   */
  cover?: { imageUrl: string; sourceUrl: string; verifiedAt: string; kind?: "partner" | "own" | "none" };
  sources: Omit<NewsSource, "evidence">[];
  translations: Partial<Record<Locale, ArticleText>>;
  /** Markets about this story (the one the article cites first); absent on older articles. */
  markets?: ArticleMarket[];
}
export interface NewsCatalog {
  version: 1;
  updatedAt: string;
  articles: NewsArticle[];
  marketTranslations: Partial<Record<Locale, Record<string, string>>>;
}
