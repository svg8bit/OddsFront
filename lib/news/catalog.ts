import "server-only";
import { cache } from "react";
import seed from "./catalog.seed.json";
import type { NewsArticle, NewsCatalog } from "./types";

export const getNewsCatalog = cache(async (): Promise<NewsCatalog> => {
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (rawUrl && token) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
      url.pathname = "/v1/news"; url.search = ""; url.hash = "";
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const data = await response.json() as NewsCatalog;
        if (data.version === 1 && Array.isArray(data.articles) && Date.parse(data.updatedAt) >= Date.parse(seed.updatedAt)) return data;
      }
    } catch { /* Keep the last verified bundled edition if the worker is unavailable. */ }
  }
  return seed as NewsCatalog;
});

export const getNewsArticle = cache(async (slug: string): Promise<NewsArticle | null> => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (rawUrl && token) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
      url.pathname = `/v1/news/articles/${slug}`; url.search = ""; url.hash = "";
      const response = await fetch(url, {headers:{Authorization:`Bearer ${token}`},next:{revalidate:60},signal:AbortSignal.timeout(4000)});
      if (response.ok) { const article=await response.json() as NewsArticle; if(article.slug===slug&&Array.isArray(article.body))return article; }
    } catch { /* Existing stories remain readable during a worker outage. */ }
  }
  return (seed as NewsCatalog).articles.find(article=>article.slug===slug)??null;
});
