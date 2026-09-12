import { mkdir, readFile, writeFile, rename, stat, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSubscriptionCodex } from "../../lib/news/writer.ts";
import { approvedTelegramCandidate, freshEditionArticles, russianTelegramArticle, russianNewsReady, telegramCandidates, telegramPayload, telegramSelectionPrompt, TELEGRAM_SELECTION_SCHEMA, TELEGRAM_CHANNELS } from "../../lib/news/telegram.ts";
import { socialPublicationDue } from "../../lib/news/social-publication.ts";
import type { TelegramSelection, TelegramLocale, TelegramCandidate } from "../../lib/news/telegram.ts";
import type { NewsCatalog } from "../../lib/news/types.ts";
import type { ConflictPreviewFeed } from "../../features/global-conflict-map/preview/types.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const requestedLocale = process.argv.find(argument => argument.startsWith("--locale="))?.split("=")[1] || "en";
if (requestedLocale !== "en" && requestedLocale !== "ru") throw new Error("Unsupported Telegram locale");
const locale: TelegramLocale = requestedLocale;
const channel = TELEGRAM_CHANNELS[locale];
const output = path.join(directory, channel.directory);
await mkdir(output, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_TELEGRAM_LOCKED) {
  const run = spawnSync("flock", ["-n", path.join(output, "publish.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_TELEGRAM_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}
const stateFile = path.join(output, "state.json");
interface State { lastSentAt: number; sentArticles: string[]; startAfterPublishedAt?: string; pending?: { articleId: string; attemptedAt: string }; }
async function atomic(file: string, value: unknown) {
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}
async function feed(): Promise<ConflictPreviewFeed | null> {
  try {
  const response = await fetch("https://oddsfront.com/api/global-conflict-events", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  return response.json();
  } catch { return null; }
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
  if (!process.argv.includes("--force") && !socialPublicationDue(state.lastSentAt)) { console.log(JSON.stringify({ status: "interval-not-due" })); process.exit(0); }
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as NewsCatalog;
  // The common EN/RU/X selection must have a reviewed Russian preview before
  // English delivery commits the choice for all three publishers.
  let articles = freshEditionArticles(locale === "en" ? catalog.articles.filter(russianNewsReady) : catalog.articles, state.sentArticles);
  if (!articles.length) { console.log(JSON.stringify({ status: "no-fresh-article" })); process.exit(0); }
  let selection: TelegramSelection;
  let candidates: TelegramCandidate[];
  let expectedCondition: string | null = null;
  if (locale === "ru") {
    let english: State = { lastSentAt: 0, sentArticles: [] };
    try { english = JSON.parse(await readFile(path.join(directory, "telegram/state.json"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const article = russianTelegramArticle(catalog.articles, english.sentArticles.at(-1), state.sentArticles, state.startAfterPublishedAt);
    if (!article) { console.log(JSON.stringify({ status: "waiting-for-russian-edition-selection" })); process.exit(0); }
    articles = [article];
    // Reuse the reviewed choice actually sent to English Telegram and X.
    // A second editor must not pick another story or attach another condition.
    const englishOutput = path.join(directory, "telegram");
    const receipts = (await readdir(englishOutput)).filter(name => name.endsWith("-receipt.json")).sort().reverse();
    let selected: TelegramSelection | undefined;
    for (const file of receipts) {
      const receipt = JSON.parse(await readFile(path.join(englishOutput, file), "utf8"));
      if (receipt.status !== "published" || receipt.articleId !== article.id) continue;
      const candidate = JSON.parse(await readFile(path.join(englishOutput, file.replace("-receipt.json", "-selection.json")), "utf8")) as TelegramSelection;
      if (candidate.articleId !== receipt.articleId || candidate.eventId !== receipt.eventId) throw new Error("English publication selection does not match its receipt");
      expectedCondition = receipt.marketConditionId;
      selected = candidate;
      break;
    }
    if (!selected) throw new Error("Verified English publication receipt is missing");
    selection = selected;
    candidates = telegramCandidates(articles, await feed(), state.sentArticles).filter(candidate => candidate.event.marketConditionId === expectedCondition);
  } else {
    candidates = telegramCandidates(articles, await feed(), state.sentArticles);
    selection = { articleId: articles[0]!.id, eventId: null, confidence: 1, reason: "Verified site reporting selected from the existing country/topic rotation; no related market candidates are available." };
    if (candidates.length) {
    try {
    selection = JSON.parse(await executeSubscriptionCodex({ prompt: telegramSelectionPrompt(candidates, articles), schema: TELEGRAM_SELECTION_SCHEMA, timeoutMs: 180_000,
      purpose: "selection", usageFile: path.join(output, "writer-usage.jsonl"),
      env: Object.fromEntries(["PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]])) })) as TelegramSelection;
    } catch {
      // The original article has already passed publication gates. A failed
      // optional market editor must not stop the scheduled news-only edition.
      selection = { articleId:articles[0]!.id, eventId:null, confidence:1, reason:"Verified published site reporting selected from the country/topic rotation; market editor unavailable, so no odds are attached." };
    }
    }
  }
  const article = articles.find(item => item.id === selection.articleId);
  const selected = selection.eventId === null && article && selection.confidence >= .9 && selection.reason.length >= 30
    ? { article, event: null } : approvedTelegramCandidate(selection, candidates);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await atomic(path.join(output, `${stamp}-selection.json`), selection);
  if (!selected) throw new Error("The news editor returned no acceptable selection; retry at the next check");
  // Refresh the selected condition before sending so title, odds and both links stay aligned.
  const selectedEvent = selected.event;
  const current = selectedEvent ? telegramCandidates([selected.article], await feed(), state.sentArticles).find(candidate => candidate.event.id === selectedEvent.id && candidate.event.marketConditionId === selectedEvent.marketConditionId) : selected;
  if (!current) throw new Error("Selected market is no longer fresh or active");
  const payload = telegramPayload(current, locale, catalog.marketTranslations?.[locale]);
  await atomic(path.join(output, `${stamp}-draft.json`), { selection, payload });
  if (!process.argv.includes("--send")) { console.log(JSON.stringify({ status: "draft", selection, payload })); process.exit(0); }
  const articleResponse = await fetch(payload.link_preview_options.url, { signal: AbortSignal.timeout(20_000) });
  if (!articleResponse.ok) throw new Error("Selected article is not publicly available");
  if (locale === "ru") {
    const html = await articleResponse.text();
    const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const title = current.article.translations.ru!.title;
    const imageUrl = `https://oddsfront.com/social/news/ru/${current.article.slug}?v=${encodeURIComponent(current.article.updatedAt)}`;
    if (!html.includes(`property="og:title" content="${escape(title)}"`) || !html.includes('property="og:locale" content="ru_RU"') || !html.includes(`property="og:image" content="${escape(imageUrl)}"`)) throw new Error("Russian article preview is not public yet");
    const cover = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!cover.ok || !cover.headers.get("content-type")?.startsWith("image/")) throw new Error("Russian social cover is unavailable");
    await cover.body?.cancel();
  }
  const token = await botToken();
  async function call(method: string, body: unknown) {
    let response: Response;
    try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error(`Telegram ${method} transport failed`); }
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const code = data.error_code ?? response.status;
      const error = Object.assign(new Error(`Telegram ${method} rejected (${code})`), { definiteRejection:code>=400&&code<500&&code!==408 });
      throw error;
    }
    return data.result;
  }
  const bot = await call("getMe", {});
  if (bot.username?.toLowerCase() !== "dropsanalyticsaibot") throw new Error("Wrong Telegram bot identity");
  const chat = await call("getChat", { chat_id: channel.id });
  const member = await call("getChatMember", { chat_id: channel.id, user_id: bot.id });
  if (chat.id !== channel.id || chat.username !== channel.username || chat.type !== "channel" || member.status !== "administrator" || !member.can_post_messages) throw new Error("OddsFront channel posting rights are missing");
  await atomic(stateFile, { ...state, pending: { articleId: current.article.id, attemptedAt: new Date().toISOString() } });
  let message;
  try { message = await call("sendMessage", payload); }
  catch(error) {
    if (error && typeof error === "object" && "definiteRejection" in error && error.definiteRejection) await atomic(stateFile,state);
    throw error;
  }
  if (!message.message_id || message.chat?.id !== channel.id) throw new Error("Unexpected Telegram send receipt");
  const receipt = { status: "published", locale, channelId: channel.id, articleId: current.article.id, eventId: current.event?.id ?? null, marketConditionId: current.event?.marketConditionId ?? null, sentAt: new Date().toISOString(), messageId: message.message_id, url: `https://t.me/${channel.username}/${message.message_id}`, previewBelow: message.link_preview_options?.show_above_text !== true };
  await atomic(path.join(output, `${stamp}-receipt.json`), receipt);
  await atomic(stateFile, { ...(state.startAfterPublishedAt ? { startAfterPublishedAt: state.startAfterPublishedAt } : {}), lastSentAt: Date.now(), sentArticles: [...state.sentArticles, current.article.id].slice(-1000) });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Telegram publication failed" }));
  process.exitCode = 1;
}
