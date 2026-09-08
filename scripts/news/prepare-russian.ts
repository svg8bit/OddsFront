import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { NewsCatalog } from "../../lib/news/types.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as NewsCatalog;
const latest = catalog.articles.toSorted((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
const edition = latest ? catalog.articles.filter(article => article.publishedAt === latest.publishedAt) : [];
if (edition.length > 0 && Date.now() - Date.parse(latest!.publishedAt) < 3 * 60 * 60_000 && edition.some(article => !article.translations?.ru?.editorReviewed)) {
  // Retry a failed Russian follow-up without rerunning research, resending EN,
  // or waiting behind the edition writer's lock. The next timer retries a busy
  // translation while the publisher below continues to enforce readiness.
  const result = spawnSync("/root/OddsFront/.local/translation-venv/bin/python", ["scripts/news/translate.py"], {
    stdio: "inherit", env: { ...process.env, ODDSFRONT_TRANSLATION_LANGUAGES: "ru" }, timeout: 10 * 60_000,
  });
  if (result.status === 75) console.log(JSON.stringify({ status: "russian-translation-in-progress" }));
  else if (result.status !== 0) process.exitCode = result.status || 1;
}
