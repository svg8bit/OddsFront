import type { NewsCatalog } from "./types";

export async function readLiveNewsCatalog(rawUrl: string, token: string, request: typeof fetch = fetch): Promise<NewsCatalog> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid news feed URL");
  url.pathname = "/v1/news"; url.search = ""; url.hash = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error(`News feed unavailable (${response.status})`);
      const data = await response.json() as NewsCatalog;
      if (data.version !== 1 || !Array.isArray(data.articles) || !data.articles.length ||
        !Number.isFinite(Date.parse(data.updatedAt)) || Date.parse(data.updatedAt) > Date.now() + 60_000 ||
        data.articles.some(article => !article || typeof article.id !== "string" || typeof article.slug !== "string" || typeof article.title !== "string" || !Array.isArray(article.body))) {
        throw new Error("Invalid news catalog");
      }
      return data;
    } catch {
      if (attempt === 1) throw new Error("Live news feed unavailable");
    }
  }
  throw new Error("Live news feed unavailable");
}
