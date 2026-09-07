import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSubscriptionCodex } from "../../lib/news/writer.ts";
import { approvedTelegramCandidate, freshEditionArticles, telegramCandidates, telegramPayload, telegramSelectionPrompt, TELEGRAM_SELECTION_SCHEMA, TELEGRAM_INTERVAL_MS, TELEGRAM_CHANNEL_ID } from "../../lib/news/telegram.ts";
import type { TelegramSelection } from "../../lib/news/telegram.ts";
import type { NewsCatalog } from "../../lib/news/types.ts";
import type { ConflictPreviewFeed } from "../../features/global-conflict-map/preview/types.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const output = path.join(directory, "telegram");
await mkdir(output, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_TELEGRAM_LOCKED) {
  const run = spawnSync("flock", ["-n", path.join(output, "publish.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_TELEGRAM_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}
const stateFile = path.join(output, "state.json");
interface State { lastSentAt: number; sentArticles: string[]; pending?: { articleId: string; attemptedAt: string }; }
async function atomic(file: string, value: unknown) {
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}
async function feed(): Promise<ConflictPreviewFeed> {
  const response = await fetch("https://oddsfront.com/api/global-conflict-events", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Live market feed unavailable");
  return response.json();
}
async function botToken() {
  if (process.env.ODDSFRONT_TELEGRAM_BOT_TOKEN) return process.env.ODDSFRONT_TELEGRAM_BOT_TOKEN;
  const file = process.env.ODDSFRONT_TELEGRAM_CREDENTIAL_ENV;
  const key = process.env.ODDSFRONT_TELEGRAM_CREDENTIAL_KEY || "ODDSFRONT_TELEGRAM_BOT_TOKEN";
  if (!file || !/^[A-Z_]+$/.test(key)) throw new Error("Telegram credential reference is not configured");
  const mode = await stat(file);
  if ((mode.mode & 0o077) !== 0) throw new Error("Telegram credential file permissions must be 600");
  // Read only the user-authorized bot key; never import or copy another product's environment.
  const value = (await readFile(file, "utf8")).split(/\r?\n/).filter(line => line.startsWith(`${key}=`)).at(-1)?.slice(key.length + 1).trim();
  const token = value?.replace(/^(["'])(.*)\1$/, "$2");
  if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error("Named Telegram bot credential is missing");
  return token;
}

try {
  let state: State = { lastSentAt: 0, sentArticles: [] };
  try { state = JSON.parse(await readFile(stateFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (state.pending) throw new Error("Previous send has an unknown outcome; reconcile it before retrying");
  if (!process.argv.includes("--force") && Date.now() - state.lastSentAt < TELEGRAM_INTERVAL_MS) { console.log(JSON.stringify({ status: "interval-not-due" })); process.exit(0); }
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as NewsCatalog;
  const articles = freshEditionArticles(catalog.articles, state.sentArticles);
  if (!articles.length) { console.log(JSON.stringify({ status: "no-fresh-article" })); process.exit(0); }
  const candidates = telegramCandidates(articles, await feed(), state.sentArticles);
  const selection = JSON.parse(await executeSubscriptionCodex({ prompt: telegramSelectionPrompt(candidates, articles), schema: TELEGRAM_SELECTION_SCHEMA, timeoutMs: 180_000,
    env: Object.fromEntries(["PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]])) })) as TelegramSelection;
  const article = articles.find(item => item.id === selection.articleId);
  const selected = selection.eventId === null && article && selection.confidence >= .9 && selection.reason.length >= 30
    ? { article, event: null } : approvedTelegramCandidate(selection, candidates);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await atomic(path.join(output, `${stamp}-selection.json`), selection);
  if (!selected) { console.log(JSON.stringify({ status: "no-strong-market-match", reason: selection.reason })); process.exit(0); }
  // Refresh the selected condition before sending so title, odds and both links stay aligned.
  const selectedEvent = selected.event;
  const current = selectedEvent ? telegramCandidates([selected.article], await feed(), state.sentArticles).find(candidate => candidate.event.id === selectedEvent.id && candidate.event.marketConditionId === selectedEvent.marketConditionId) : selected;
  if (!current) throw new Error("Selected market is no longer fresh or active");
  const payload = telegramPayload(current);
  await atomic(path.join(output, `${stamp}-draft.json`), { selection, payload });
  if (!process.argv.includes("--send")) { console.log(JSON.stringify({ status: "draft", selection, payload })); process.exit(0); }
  const articleResponse = await fetch(payload.link_preview_options.url, { signal: AbortSignal.timeout(20_000) });
  if (!articleResponse.ok) throw new Error("Selected article is not publicly available");
  const token = await botToken();
  async function call(method: string, body: unknown) {
    let response: Response;
    try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error(`Telegram ${method} transport failed`); }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method} rejected (${data.error_code ?? response.status})`);
    return data.result;
  }
  const bot = await call("getMe", {});
  if (bot.username?.toLowerCase() !== "dropsanalyticsaibot") throw new Error("Wrong Telegram bot identity");
  const chat = await call("getChat", { chat_id: TELEGRAM_CHANNEL_ID });
  const member = await call("getChatMember", { chat_id: TELEGRAM_CHANNEL_ID, user_id: bot.id });
  if (chat.id !== TELEGRAM_CHANNEL_ID || chat.username !== "oddsfront" || chat.type !== "channel" || member.status !== "administrator" || !member.can_post_messages) throw new Error("OddsFront channel posting rights are missing");
  await atomic(stateFile, { ...state, pending: { articleId: current.article.id, attemptedAt: new Date().toISOString() } });
  const message = await call("sendMessage", payload);
  if (!message.message_id || message.chat?.id !== TELEGRAM_CHANNEL_ID) throw new Error("Unexpected Telegram send receipt");
  const receipt = { status: "published", articleId: current.article.id, eventId: current.event?.id ?? null, marketConditionId: current.event?.marketConditionId ?? null, sentAt: new Date().toISOString(), messageId: message.message_id, url: `https://t.me/oddsfront/${message.message_id}`, previewBelow: message.link_preview_options?.show_above_text !== true };
  await atomic(path.join(output, `${stamp}-receipt.json`), receipt);
  await atomic(stateFile, { lastSentAt: Date.now(), sentArticles: [...state.sentArticles, current.article.id].slice(-1000) });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Telegram publication failed" }));
  process.exitCode = 1;
}
