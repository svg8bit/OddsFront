import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findDuplicateStory } from "../../lib/news/duplicates.ts";
import { writeNewsCatalog } from "../../lib/news/storage.ts";
import type { NewsCatalog } from "../../lib/news/types.ts";

const [articleId, originalId] = process.argv.slice(2);
if (!articleId || !originalId || articleId === originalId || !/^[a-z0-9-]+$/.test(articleId + originalId)) {
  throw new Error("Usage: node scripts/news/withdraw-duplicate.ts ARTICLE_ID ORIGINAL_ID");
}
const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
if (!process.env.ODDSFRONT_EDITION_LOCKED) {
  const run = spawnSync("flock", ["-w", "300", path.join(directory, "edition.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, ODDSFRONT_EDITION_LOCKED: "1" },
  });
  process.exit(run.status ?? 1);
}
const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as NewsCatalog;
const article = catalog.articles.find(item => item.id === articleId);
const original = catalog.articles.find(item => item.id === originalId);
if (!article || !original || original.withdrawal || Date.parse(article.publishedAt) < Date.parse(original.publishedAt) ||
    (article.withdrawal && article.withdrawal.duplicateOf !== originalId) || !findDuplicateStory(article, [original])) {
  throw new Error("Both catalog records and their duplicate relationship must be verified");
}
const at = article.withdrawal?.at ?? new Date().toISOString();
const receipts = path.join(directory, "withdrawals");
await mkdir(receipts, { recursive: true, mode: 0o700 });
const receiptPath = path.join(receipts, `${articleId}.json`);
try {
  await writeFile(receiptPath, JSON.stringify({ at, articleId, duplicateOf: originalId, article }), { mode: 0o600, flag: "wx" });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.articleId !== articleId || receipt.duplicateOf !== originalId) throw new Error("Conflicting withdrawal receipt");
}
article.withdrawal = { at, duplicateOf: originalId };
catalog.updatedAt = new Date().toISOString();
const publicDirectory = process.env.ODDSFRONT_NEWS_PUBLIC_DIRECTORY || (process.env.ODDSFRONT_NEWS_DIRECTORY ? path.join(directory, "public") : "/opt/oddsfront-market-feed/news");
await writeNewsCatalog(directory, publicDirectory, catalog, []);
console.log(JSON.stringify({ status: "withdrawn-duplicate", articleId, originalId, receipt: receiptPath }));
