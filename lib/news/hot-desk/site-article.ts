// The OddsFront site article behind a Telegram story: the wire desk publishes the same hot stories on
// oddsfront.com, so a post can send readers to the full article. Read from the public news API.
import { storyMatchesTitle, type ViralStory } from "../viral/signals.ts";

export type SiteArticle = { slug: string; title: string; publishedAt: string; translations?: { ru?: { title?: string } } };
export type SiteArticleLinks = { slug: string; en: string; ru: string | null };

const SITE = "https://oddsfront.com";

/** The newest article of the last `maxAgeHours` that reports the story, as EN and RU links. */
export function matchSiteArticle(story: ViralStory, articles: readonly SiteArticle[], now = Date.now(), maxAgeHours = 12): SiteArticleLinks | null {
  const article = articles
    .filter(item => typeof item.slug === "string" && /^[a-z0-9-]+$/.test(item.slug) && now - Date.parse(item.publishedAt) <= maxAgeHours * 3_600_000)
    .toSorted((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .find(item => storyMatchesTitle(story, item.title));
  if (!article) return null;
  return { slug: article.slug, en: `${SITE}/en/news/${article.slug}`, ru: article.translations?.ru?.title ? `${SITE}/ru/news/${article.slug}` : null };
}

export async function fetchSiteArticles(request: typeof fetch = fetch): Promise<SiteArticle[]> {
  try {
    const response = await request(`${SITE}/api/news?limit=30`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); return []; }
    const body = await response.json() as { articles?: SiteArticle[] };
    return Array.isArray(body.articles) ? body.articles : [];
  } catch { return []; }
}
