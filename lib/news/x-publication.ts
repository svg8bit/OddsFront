import type { NewsArticle } from "./types.ts";

export const X_NEWS_ACCOUNT = "alotofbit";
export const X_NEWS_INTERVAL_MS = 60 * 60_000;

export function xNewsPayload(article: NewsArticle) {
  const title = article.title.replace(/\s+/g, " ").trim();
  if (!title || Array.from(title).length + 3 > 280) throw new Error("Article headline exceeds the X post limit");
  if (/https?:\/\/|\bwww\./i.test(title)) throw new Error("X headlines must not contain links");
  return { text: `🗞 ${title}` };
}

export function xNewsCoverUrl(article: NewsArticle) {
  return `https://oddsfront.com/social/news/en/${encodeURIComponent(article.slug)}?v=${encodeURIComponent(article.updatedAt)}`;
}

export function verifyXPhotoPost(post: { data?: { id?: string; author_id?: string; text?: string; attachments?: { media_keys?: string[] }; entities?: { urls?: { url: string; expanded_url?: string }[] } }; includes?: { media?: { media_key: string; type: string }[] } }, expected: { postId: string; accountId: string; text: string; mediaKey: string }) {
  const data = post.data;
  if (data?.id !== expected.postId || data.author_id !== expected.accountId) throw new Error("X post author verification failed");
  if (data.attachments?.media_keys?.length !== 1 || data.attachments.media_keys[0] !== expected.mediaKey || !post.includes?.media?.some(media => media.media_key === expected.mediaKey && media.type === "photo")) throw new Error("X post cover verification failed");
  let text = data.text || "";
  // X can append its own t.co photo URL to API text even though the composer
  // contained only the headline. Permit only this post's attached photo link.
  for (const link of data.entities?.urls || []) {
    const expanded = link.expanded_url || "";
    if (!new RegExp(`^https://(?:twitter|x)\\.com/${X_NEWS_ACCOUNT}/status/${expected.postId}/photo/1$`).test(expanded)) throw new Error("X post contains an external link");
    text = text.replace(link.url, "").trim();
  }
  if (text !== expected.text) throw new Error("X post headline verification failed");
}

export function xNewsArticle(articles: NewsArticle[], telegramArticleIds: readonly string[], sentIds: readonly string[], now = Date.now()): NewsArticle | null {
  // Reuse the editorial choice actually published to Telegram; do not choose a
  // different or older story just because the X timer runs a few minutes later.
  const article = articles.find(item => item.id === telegramArticleIds.at(-1));
  if (!article || sentIds.includes(article.id)) return null;
  const publishedAt = Date.parse(article.publishedAt);
  return Number.isFinite(publishedAt) && publishedAt <= now && now - publishedAt <= 6 * 60 * 60_000 ? article : null;
}
