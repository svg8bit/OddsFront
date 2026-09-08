import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { writeNewsCatalog } from "../../lib/news/storage.ts";
import { prepareEditionCovers } from "../../lib/news/edition-covers.ts";
import { uniqueEditionArticles } from "../../lib/news/duplicates.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const editionIntervalMs = 2 * 60 * 60_000;
const preparationLeadMs = 60 * 60_000;
await mkdir(directory, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_EDITION_LOCKED) {
  // An interval-only check must not wait behind offline translations. Recheck
  // after acquiring the lock as well before any edition mutation.
  if (!process.argv.includes("--force")) {
    try {
      const state = JSON.parse(await readFile(path.join(directory, "edition-state.json"), "utf8"));
      if (Date.now() < state.lastPublishedAt + editionIntervalMs - preparationLeadMs) {
        console.log(JSON.stringify({ status: "interval-not-due", nextDueAt: new Date(state.lastPublishedAt + editionIntervalMs).toISOString() }));
        process.exit(0);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const run = spawnSync("flock", ["-w", "300", path.join(directory, "edition.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_EDITION_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}
const publicDirectory = process.env.ODDSFRONT_NEWS_PUBLIC_DIRECTORY || (process.env.ODDSFRONT_NEWS_DIRECTORY ? path.join(directory, "public") : "/opt/oddsfront-market-feed/news");
const read = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
};
const atomic = async (file, value) => {
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
};
const emptyCatalog = { version: 1, updatedAt: "1970-01-01T00:00:00.000Z", articles: [], marketTranslations: {} };
const catalog = () => read(path.join(directory, "catalog.json"), emptyCatalog);
const stateFile = path.join(directory, "edition-state.json");
const state = await read(stateFile, { lastPublishedAt: 0 });
if (!process.argv.includes("--force") && Date.now() < state.lastPublishedAt + editionIntervalMs - preparationLeadMs) {
  console.log(JSON.stringify({ status: "interval-not-due", nextDueAt: new Date(state.lastPublishedAt + editionIntervalMs).toISOString() }));
  process.exit(0);
}
const pendingDirectory = path.join(directory, "pending-edition");
await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });
const pendingFile = path.join(pendingDirectory, "edition.json");
let pending = await read(pendingFile, null);
if (!pending) {
  const current = await catalog();
  pending = { startedAt: new Date().toISOString(), baseIds: current.articles.map(article => article.id) };
  await atomic(path.join(pendingDirectory, "catalog.json"), current);
  await atomic(pendingFile, pending);
}
if (!process.argv.includes("--force") && pending.retryAfter > Date.now()) {
  console.log(JSON.stringify({ status: "research-cooldown", nextResearchAt: new Date(pending.retryAfter).toISOString() }));
  process.exit(0);
}
const previous = new Set(pending.baseIds);
const stagedCatalog = () => read(path.join(pendingDirectory, "catalog.json"), emptyCatalog);
const fresh = article => article.sources.some(source => source.kind === "media" && Date.parse(source.publishedAt) >= Date.now() - 72 * 60 * 60_000);
const staged = await stagedCatalog();
staged.articles = staged.articles.filter(article => previous.has(article.id) || fresh(article));
await atomic(path.join(pendingDirectory, "catalog.json"), staged);
const startedAt = new Date().toISOString();
const rounds = [];
let prepared = (await stagedCatalog()).articles.filter(article => !previous.has(article.id));
async function checkNovelty() {
  const current = await catalog();
  const staged = await stagedCatalog();
  const candidates = staged.articles.filter(article => !previous.has(article.id));
  // A failed ledger write can leave this exact pending edition in the catalog.
  // Its persisted timestamp and unchanged article content permit an idempotent
  // export retry; an unrelated publication with the same ID does not.
  const exportedIds = new Set(candidates.filter(article => pending.publishedAt && current.articles.some(item =>
    item.id === article.id && !item.withdrawal && item.publishedAt === pending.publishedAt &&
    item.title === article.title && item.slug === article.slug &&
    JSON.stringify(item.body) === JSON.stringify(article.body) && JSON.stringify(item.sources) === JSON.stringify(article.sources),
  )).map(article => article.id));
  // Refresh old pending editions against the entire current exclusion history,
  // including withdrawals. Current records override stale staged copies.
  const history = [...current.articles.filter(article => !exportedIds.has(article.id)), ...staged.articles.filter(article => previous.has(article.id) && !current.articles.some(item => item.id === article.id))];
  const { accepted, rejected } = uniqueEditionArticles(candidates, history);
  for (const article of history) previous.add(article.id);
  pending = { ...pending, baseIds: [...previous] };
  await atomic(pendingFile, pending);
  await atomic(path.join(pendingDirectory, "catalog.json"), { ...staged, articles: [...accepted, ...history] });
  if (rejected.length) {
    const file = path.join(pendingDirectory, "research-feedback.json");
    await atomic(file, [...await read(file, []), ...rejected.map(({ article, duplicateOf }) => ({
      title: article.title, reasons: ["Already published story", `Previously covered article: ${duplicateOf}`],
      mediaSources: article.sources.filter(source => source.kind === "media").map(source => source.url),
    }))].slice(-24));
  }
  prepared = accepted;
}
await checkNovelty();
async function checkCovers() {
  if (prepared.length < 9) return;
  const { accepted, rejected } = await prepareEditionCovers(prepared);
  const staged = await stagedCatalog();
  await atomic(path.join(pendingDirectory, "catalog.json"), {
    ...staged, articles: [...accepted, ...staged.articles.filter(article => previous.has(article.id))],
  });
  if (rejected.length) {
    const file = path.join(pendingDirectory, "cover-rejections.json");
    await atomic(file, [...await read(file, []), ...rejected]);
  }
  prepared = accepted;
}
await checkCovers();
// Research may return a partial result. Persist it privately and keep filling
// the same edition; never expose five stories as a successful nine-story run.
let stalledRounds = 0;
for (let attempt = 1; attempt <= 6 && prepared.length < 9; attempt++) {
  const before = prepared.length;
  const run = spawnSync(process.execPath, ["scripts/news/publish.ts"], { stdio: "inherit", env: { ...process.env,
    ODDSFRONT_NEWS_DIRECTORY: pendingDirectory, ODDSFRONT_NEWS_PUBLIC_DIRECTORY: path.join(pendingDirectory, "public"),
    ODDSFRONT_NEWS_BATCH_SIZE: String(Math.min(3, 9 - prepared.length)) }, timeout: 11 * 60_000 });
  prepared = (await stagedCatalog()).articles.filter(article => !previous.has(article.id));
  await checkNovelty();
  await checkCovers();
  rounds.push({ attempt, exitCode: run.status, prepared: prepared.length });
  stalledRounds = prepared.length > before ? 0 : stalledRounds + 1;
  if (stalledRounds >= 2) {
    // A timer or monitor retry must not create an unbounded subscription loop
    // when discovery cannot add a usable story. Retain the partial edition.
    pending = { ...pending, retryAfter: Date.now() + 30 * 60_000 };
    await atomic(pendingFile, pending);
    break;
  }
}
await mkdir(path.join(directory, "editions"), { recursive: true, mode: 0o700 });
const target = path.join(directory, "editions", `${startedAt.replace(/[:.]/g, "-")}.json`);
if (prepared.length !== 9) {
  const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: 9, published: [], prepared: prepared.length, rounds, status: "incomplete-retrying" };
  await atomic(target, receipt);
  console.error(JSON.stringify(receipt));
  process.exit(1);
}
// Prepare privately before the deadline, so research time is not added to
// every two-hour publishing interval. A forced operator edition publishes now.
const dueAt = process.argv.includes("--force") ? Date.now() : state.lastPublishedAt + editionIntervalMs;
if (Date.now() < dueAt) console.log(JSON.stringify({status:"edition-ready",articles:9,publishAt:new Date(dueAt).toISOString()}));
while (Date.now() < dueAt) await new Promise(resolve=>setTimeout(resolve,Math.min(30_000,dueAt-Date.now())));
await checkNovelty();
if (prepared.length !== 9) {
  const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: 9, published: [], prepared: prepared.length, rounds, status: "incomplete-retrying" };
  await atomic(target, receipt);
  console.error(JSON.stringify(receipt));
  process.exit(1);
}
const publishedAt = pending.publishedAt || new Date().toISOString();
await atomic(pendingFile, { ...pending, publishedAt });
const published = prepared.map(article => ({ ...article, publishedAt, updatedAt: publishedAt }));
const ids = new Set(published.map(article => article.id));
const current = await catalog();
const next = { ...current, updatedAt: publishedAt, articles: [...published, ...current.articles.filter(article => !ids.has(article.id))] };
await writeNewsCatalog(directory, publicDirectory, next, published);
const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: 9, published: published.map(article => article.slug), photographicCovers: published.filter(article => article.cover).length, fallbackCovers: published.filter(article => !article.cover).length, rounds, status: "complete" };
await atomic(target, receipt);
await atomic(stateFile, { lastPublishedAt: Date.parse(publishedAt), articleIds: [...ids], receipt: target });
// Keep research evidence; only the disposable staged catalogs are removed.
await rename(pendingDirectory, path.join(directory, "editions", `${startedAt.replace(/[:.]/g, "-")}-research`));
console.log(JSON.stringify(receipt));
if (process.argv.includes("--with-followups")) {
  for (const [command, args, timeout] of [
    ["/root/OddsFront/.local/translation-venv/bin/python", ["scripts/news/translate.py"], 55 * 60_000],
    [process.execPath, ["scripts/news/indexnow.mjs"], 60_000],
  ]) {
    const result = spawnSync(command, args, { stdio: "inherit", env: process.env, timeout });
    if (result.status !== 0) console.error(JSON.stringify({ status: "followup-failed", command: path.basename(command), exitCode: result.status }));
  }
}
