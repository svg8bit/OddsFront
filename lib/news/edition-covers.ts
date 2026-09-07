import { fetchPartnerCover } from "./partner-covers.ts";
import type { NewsArticle } from "./types.ts";

export const MAX_EDITION_FALLBACK_COVERS = 3;

export async function prepareEditionCovers(articles: NewsArticle[], load = fetchPartnerCover) {
  const checked: NewsArticle[] = [];
  // Bound concurrent image requests; retain the verified URL after RSS rotation.
  for (let offset = 0; offset < articles.length; offset += 3) {
    checked.push(...await Promise.all(articles.slice(offset, offset + 3).map(async article => {
      for (const source of article.sources.filter(source => source.kind === "media").slice(0, 3)) {
        const cover = await load(source.url, article.cover?.sourceUrl === source.url ? article.cover.imageUrl : undefined);
        if (cover) return { ...article, cover: { imageUrl: cover.imageUrl, sourceUrl: source.url, verifiedAt: new Date().toISOString() } };
      }
      const result = { ...article };
      delete result.cover;
      return result;
    })));
  }
  let fallbacks = 0;
  const rejected: NewsArticle[] = [];
  const accepted = checked.filter(article => {
    if (article.cover || ++fallbacks <= MAX_EDITION_FALLBACK_COVERS) return true;
    rejected.push(article);
    return false;
  });
  return { accepted, rejected };
}
