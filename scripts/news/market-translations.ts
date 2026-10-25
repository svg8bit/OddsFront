// Russian wording of the Mini App's market questions. Every English string is translated once and
// kept forever in the feed's market-translations.json; a run with nothing new makes no model call.
// Sources: the Mini App's own market lists (oddsfront.com/api/tg/markets), the site map's markets and
// places (oddsfront.com/api/global-conflict-events) and the questions the hot desk already translated
// for its posts (no model call for those).
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeSubscriptionWriter, WriterUsageLimitError } from "../../lib/news/writer.ts";
import { collectMapStrings, collectStrings, mergeHotDeskPairs, translationPrompt, TRANSLATION_SCHEMA, acceptedTranslations, type TranslationFile } from "../../lib/news/market-translations.ts";

// Served by the feed as /v1/news/articles/market-translations-ru (lib/telegram-app/translations.ts).
const file = process.env.ODDSFRONT_TRANSLATIONS_FILE || "/opt/oddsfront-market-feed/news/articles/market-translations-ru.json";
const hotDeskDirectory = path.join(process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news", "hot-desk");
const usageFile = path.join(process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news", "market-translations-usage.jsonl");
const marketsUrl = process.env.ODDSFRONT_TG_MARKETS_URL || "https://oddsfront.com/api/tg/markets";
const mapUrl = process.env.ODDSFRONT_MAP_EVENTS_URL || "https://oddsfront.com/api/global-conflict-events";
const batchSize = 60;
const dryRun = process.argv.includes("--dry-run");

async function load(): Promise<TranslationFile> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as TranslationFile;
    return { version: 1, updatedAt: data.updatedAt, ru: data.ru && typeof data.ru === "object" ? data.ru : {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { version: 1, updatedAt: new Date(0).toISOString(), ru: {} };
  }
}

async function save(data: TranslationFile) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  // World-readable: the feed service runs as a dynamic user.
  await writeFile(temporary, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }), { mode: 0o644 });
  await rename(temporary, file);
}

async function hotDeskDrafts() {
  const names = (await readdir(hotDeskDirectory).catch(() => [] as string[])).filter(name => name.endsWith("-draft.json")).sort().slice(-200);
  const drafts: unknown[] = [];
  for (const name of names) drafts.push(JSON.parse(await readFile(path.join(hotDeskDirectory, name), "utf8").catch(() => "null")));
  return drafts;
}

try {
  const data = await load();
  const before = Object.keys(data.ru).length;
  data.ru = mergeHotDeskPairs(data.ru, await hotDeskDrafts());
  const response = await fetch(marketsUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Mini App markets unavailable (${response.status})`);
  const strings = collectStrings(await response.json());
  // The map is a second source; a map outage must not stop the Mini App's translations.
  const map = await fetch(mapUrl, { signal: AbortSignal.timeout(30_000) }).then(reply => reply.ok ? reply.json() : null).catch(() => null);
  const pending = [...new Set([...strings, ...collectMapStrings(map)])].filter(text => !data.ru[text]);
  let translated = 0;
  let costUsd = 0;
  for (let start = 0; start < pending.length && !dryRun; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const env = Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]]));
    const output = JSON.parse(await executeSubscriptionWriter({ prompt: translationPrompt(batch), schema: TRANSLATION_SCHEMA, env, model: process.env.ODDSFRONT_TRANSLATIONS_MODEL || "sonnet", purpose: "translation", usageFile, timeoutMs: 240_000 }));
    const accepted = acceptedTranslations(output, batch);
    Object.assign(data.ru, accepted);
    translated += Object.keys(accepted).length;
  }
  try {
    const lines = (await readFile(usageFile, "utf8")).trim().split("\n").slice(-Math.ceil(pending.length / batchSize));
    costUsd = lines.reduce((sum, line) => sum + (Number((JSON.parse(line) as { totalCostUsd?: number }).totalCostUsd) || 0), 0);
  } catch { /* usage log is optional */ }
  if (Object.keys(data.ru).length !== before && !dryRun) await save(data);
  console.log(JSON.stringify({ status: dryRun ? "dry-run" : "ok", known: Object.keys(data.ru).length, pending: pending.length, translated, fromHotDesk: Object.keys(data.ru).length - before - translated, costUsd: Math.round(costUsd * 1000) / 1000 }));
} catch (error) {
  if (error instanceof WriterUsageLimitError) {
    console.log(JSON.stringify({ status: "writer-usage-limit" }));
    process.exit(0);
  }
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Translation run failed" }));
  process.exitCode = 1;
}
