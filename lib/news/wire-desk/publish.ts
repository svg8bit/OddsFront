// Publication of wire-desk articles into the catalog the feed service serves,
// one article at a time, followed by search-engine and cache notifications.
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeNewsCatalog } from "../storage.ts";
import { articleCategory, type NewsCategory } from "../categories.ts";
import { buildIndexNowPlan, indexNowBatches, isIndexNowSnapshot } from "../indexnow.ts";
import { articleLocales, newsArchivePath, newsArticlePath, newsCountryPath, newsPath, newsTopicPath } from "../routing.ts";
import { NEWS_INDEX_PAGE_SIZE } from "../constants.ts";
import type { Locale, NewsArticle, NewsCatalog } from "../types.ts";

export const WIRE_DESK_LOCALES: readonly Locale[] = ["en", "ru"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Files that share the feed's articles directory but are not articles (the Mini App's translations). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["market-translations-ru"]);
const ORIGIN = "https://oddsfront.com";
const INDEXNOW_KEY = "03913c8474b65893aebfb67df212e25ed48c4ef85b4cf98297f3185ae23defd1";

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The full catalog the desk publishes from: its private copy, or — on the
 * first run — the public index with every article's detail file, so earlier
 * articles and the map's market translations are kept.
 */
export async function loadCatalog(privateDirectory: string, publicDirectory: string): Promise<{ catalog: NewsCatalog; bootstrapped: boolean }> {
  const own = await readJson<NewsCatalog>(path.join(privateDirectory, "catalog.json"));
  if (own && own.version === 1 && Array.isArray(own.articles)) return { catalog: own, bootstrapped: false };
  const index = await readJson<NewsCatalog>(path.join(publicDirectory, "catalog.json"));
  if (!index) return { catalog: { version: 1, updatedAt: new Date(0).toISOString(), articles: [], marketTranslations: {} }, bootstrapped: true };
  const articles: NewsArticle[] = [];
  for (const summary of index.articles ?? []) {
    if (!SLUG.test(summary.slug) || RESERVED_SLUGS.has(summary.slug)) continue;
    const detail = await readJson<NewsArticle>(path.join(publicDirectory, "articles", `${summary.slug}.json`));
    const { views7d: _views, ...rest } = (detail && detail.slug === summary.slug ? detail : summary) as NewsArticle;
    void _views;
    articles.push(rest);
  }
  return { catalog: { version: 1, updatedAt: index.updatedAt, articles, marketTranslations: index.marketTranslations ?? {} }, bootstrapped: true };
}

/** Write one cover where the feed service serves it: <public>/covers/<slug>.jpg (0644, atomic). */
export async function writeCover(publicDirectory: string, slug: string, jpeg: Buffer) {
  if (!SLUG.test(slug)) throw new Error("Invalid cover slug");
  const directory = path.join(publicDirectory, "covers");
  await mkdir(directory, { recursive: true });
  await chmod(directory, 0o755);
  const file = path.join(directory, `${slug}.jpg`);
  await writeFile(`${file}.tmp`, jpeg, { mode: 0o644 });
  await chmod(`${file}.tmp`, 0o644);
  await rename(`${file}.tmp`, file);
}

/** The catalog with `article` first, published (cover file and detail file before the index). */
export async function publishArticle(privateDirectory: string, publicDirectory: string, catalog: NewsCatalog, article: NewsArticle, cover: Buffer | null): Promise<NewsCatalog> {
  if (!SLUG.test(article.slug) || RESERVED_SLUGS.has(article.slug)) throw new Error(`Article slug ${article.slug} is invalid or reserved`);
  if (catalog.articles.some(existing => existing.id === article.id || existing.slug === article.slug)) throw new Error(`Article ${article.slug} already exists`);
  if (cover) await writeCover(publicDirectory, article.slug, cover);
  const next: NewsCatalog = { ...catalog, updatedAt: article.updatedAt, articles: [article, ...catalog.articles] };
  await writeNewsCatalog(privateDirectory, publicDirectory, next, [article]);
  return next;
}

/** Bundled seed stories older than a week, retired once fresh reporting is live. */
export function staleSeedArticles(catalog: NewsCatalog, seedIds: ReadonlySet<string>, now = Date.now()) {
  return catalog.articles.filter(article => seedIds.has(article.id) && now - Date.parse(article.publishedAt) > 7 * 86_400_000);
}

/** Remove stale seed stories from the catalog and their detail files; returns the removed articles. */
export async function retireSeedArticles(privateDirectory: string, publicDirectory: string, catalog: NewsCatalog, seedIds: ReadonlySet<string>, now = Date.now()): Promise<{ catalog: NewsCatalog; retired: NewsArticle[] }> {
  const retired = staleSeedArticles(catalog, seedIds, now);
  if (!retired.length || retired.length === catalog.articles.length) return { catalog, retired: [] };
  const next = { ...catalog, updatedAt: new Date(Math.max(now, Date.parse(catalog.updatedAt) + 1)).toISOString(), articles: catalog.articles.filter(article => !retired.includes(article)) };
  await writeNewsCatalog(privateDirectory, publicDirectory, next, []);
  for (const article of retired) if (SLUG.test(article.slug) && !RESERVED_SLUGS.has(article.slug)) await rm(path.join(publicDirectory, "articles", `${article.slug}.json`), { force: true });
  return { catalog: next, retired };
}

/** Site paths whose cached HTML/XML changes when these articles appear or disappear. */
export function revalidationPaths(catalog: NewsCatalog, changed: readonly NewsArticle[], removed: readonly NewsArticle[] = []) {
  const paths = new Set<string>(["/news-sitemap.xml", "/sitemap.xml", "/sitemaps/core.xml", "/news/archive"]);
  for (const locale of WIRE_DESK_LOCALES) {
    paths.add(newsPath(locale));
    paths.add(newsPath(locale, "/rss.xml"));
    paths.add(`/news-sitemaps/${locale}-1.xml`);
  }
  const pages = Math.min(3, Math.max(1, Math.ceil(catalog.articles.length / NEWS_INDEX_PAGE_SIZE)));
  for (let page = 2; page <= pages; page += 1) paths.add(newsArchivePath(page));
  for (let part = 1; part <= Math.min(3, Math.max(1, Math.ceil(catalog.articles.length / 1000))); part += 1) paths.add(`/sitemaps/articles-${part}.xml`);
  const categories = new Set<NewsCategory>();
  const countries = new Set<string>();
  for (const article of [...changed, ...removed]) {
    categories.add(articleCategory(article));
    for (const country of article.countries.slice(0, 4)) countries.add(country.toLowerCase());
  }
  for (const locale of WIRE_DESK_LOCALES) {
    for (const category of categories) paths.add(newsTopicPath(category, locale));
    for (const country of countries) paths.add(newsCountryPath(country, locale));
  }
  for (const article of removed) for (const locale of articleLocales(article)) paths.add(newsArticlePath(article, locale));
  return [...paths].slice(0, 80);
}

export type NotifyResult = { service: string; ok: boolean; detail: string };

/** POST the changed paths to the site's token-protected revalidation route. */
export async function requestRevalidation(paths: readonly string[], env: Record<string, string | undefined> = process.env): Promise<NotifyResult> {
  const token = env.ODDSFRONT_NEWS_REVALIDATE_TOKEN;
  if (!token) return { service: "revalidate", ok: false, detail: "ODDSFRONT_NEWS_REVALIDATE_TOKEN is not set; pages refresh on their ISR windows" };
  const site = env.ODDSFRONT_SITE_URL || ORIGIN;
  try {
    const response = await fetch(`${site}/api/news/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "OddsFrontWireDesk/1.0" },
      body: JSON.stringify({ paths }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    return { service: "revalidate", ok: response.ok, detail: `HTTP ${response.status} ${body.slice(0, 200)}` };
  } catch (error) {
    return { service: "revalidate", ok: false, detail: error instanceof Error ? error.message : "request failed" };
  }
}

/** IndexNow delta for the English and Russian pages; the snapshot advances only after acceptance. */
export async function notifyIndexNow(privateDirectory: string, catalog: NewsCatalog, dryRun: boolean): Promise<NotifyResult & { urls: number }> {
  const stateFile = path.join(privateDirectory, "indexnow-state.json");
  const previousRaw = await readJson<unknown>(stateFile).catch(() => null);
  const previous = isIndexNowSnapshot(previousRaw) ? previousRaw : null;
  const plan = buildIndexNowPlan(catalog, previous, false, WIRE_DESK_LOCALES);
  if (!plan.urls.length) return { service: "indexnow", ok: true, detail: "unchanged", urls: 0 };
  if (dryRun) return { service: "indexnow", ok: true, detail: "dry run", urls: plan.urls.length };
  try {
    for (const urlList of indexNowBatches(plan.urls)) {
      const response = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "OddsFrontIndexNow/2.0" },
        body: JSON.stringify({ host: "oddsfront.com", key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 200 && response.status !== 202) return { service: "indexnow", ok: false, detail: `HTTP ${response.status}`, urls: plan.urls.length };
    }
    await writeFile(`${stateFile}.tmp`, JSON.stringify(plan.snapshot), { mode: 0o600 });
    await rename(`${stateFile}.tmp`, stateFile);
    return { service: "indexnow", ok: true, detail: "accepted", urls: plan.urls.length };
  } catch (error) {
    return { service: "indexnow", ok: false, detail: error instanceof Error ? error.message : "request failed", urls: plan.urls.length };
  }
}

/** WebSub ping for the English and Russian RSS feeds. */
export async function notifyWebSub(dryRun: boolean): Promise<NotifyResult> {
  const body = new URLSearchParams({ "hub.mode": "publish" });
  for (const locale of WIRE_DESK_LOCALES) body.append("hub.url", `${ORIGIN}${newsPath(locale, "/rss.xml")}`);
  if (dryRun) return { service: "websub", ok: true, detail: "dry run" };
  try {
    const response = await fetch("https://pubsubhubbub.appspot.com/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8", "User-Agent": "OddsFrontWebSub/1.0" }, body, signal: AbortSignal.timeout(15_000) });
    return { service: "websub", ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { service: "websub", ok: false, detail: error instanceof Error ? error.message : "request failed" };
  }
}
