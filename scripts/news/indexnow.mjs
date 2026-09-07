import { readFile } from "node:fs/promises";
import { NEWS_CATEGORIES, articleCategory } from "../../lib/news/categories.ts";

const host = "oddsfront.com";
const origin = `https://${host}`;
const key = "03913c8474b65893aebfb67df212e25ed48c4ef85b4cf98297f3185ae23defd1";
const locales = ["en", "zh", "ko", "vi", "de", "es", "pt-BR", "fr", "ru", "uk", "fa", "he"];
const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";

function prefix(locale) {
  return locale === "en" ? "" : `/${locale.toLowerCase()}`;
}

try {
  const catalog = JSON.parse(await readFile(`${directory}/catalog.json`, "utf8"));
  const urls = new Set([origin, `${origin}/global-conflict-map`, `${origin}/news`, `${origin}/sitemap.xml`, `${origin}/news-sitemap.xml`]);
  const countries = new Set(["world"]);
  for (const article of catalog.articles ?? []) {
    for (const country of article.countries ?? []) countries.add(country.toLowerCase());
    for (const locale of locales) {
      if (locale !== "en" && !article.translations?.[locale]) continue;
      const country = (article.countries?.[0] || "world").toLowerCase();
      urls.add(`${origin}${prefix(locale)}/news/${country}/${article.slug}`);
    }
  }
  for (const locale of locales) {
    urls.add(`${origin}${prefix(locale)}/news`);
    for(const topic of NEWS_CATEGORIES.filter(topic=>catalog.articles.some(article=>articleCategory(article)===topic))) urls.add(`${origin}${prefix(locale)}/news/topic/${topic}`);
    for (const country of countries) urls.add(`${origin}${prefix(locale)}/news/${country}`);
  }
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "OddsFrontIndexNow/1.0" },
    body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: [...urls].slice(0, 10_000) }),
    signal: AbortSignal.timeout(15_000),
  });
  console.log(JSON.stringify({ service: "IndexNow", status: response.status, submitted: Math.min(urls.size, 10_000), accepted: response.status === 200 || response.status === 202 }));
} catch (error) {
  console.warn(JSON.stringify({ service: "IndexNow", accepted: false, error: error instanceof Error ? error.message : "Unknown error" }));
}
