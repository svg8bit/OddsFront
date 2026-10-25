// OddsFront Telegram hot desk: the hottest geopolitical/political story of the
// moment, paired with the live market it moves, posted with Yes/No buttons
// that open the one-tap bet Mini App. Dry run by default; --preview sends the
// draft to the owner's DM; --send publishes to @oddsfront and @oddsfront_ru.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSubscriptionWriter, WriterUsageLimitError } from "../../lib/news/writer.ts";
import { clusterHeadlines, collectHeadlines } from "../../lib/news/hot-desk/headlines.ts";
import { candidateMarkets, priceHistory, refreshMarket, DEFAULT_MARKET_POLICY } from "../../lib/news/hot-desk/markets.ts";
import { acceptedPair, acceptedStoryPicks, pairSelectionPrompt, storySelectionPrompt, MIN_HYPE, MIN_PAIR_CONFIDENCE, PAIR_SELECTION_SCHEMA, STORY_SELECTION_SCHEMA } from "../../lib/news/hot-desk/editor.ts";
import { betKeyboard, hotDeskCaption, HOT_DESK_CHANNELS, type HotDeskLocale } from "../../lib/news/hot-desk/post.ts";
import { marketThumbnail, renderCards } from "../../lib/news/hot-desk/card.ts";
import { EMPTY_STATE, hotDeskPolicy, marketResting, needsEvaluation, publicationBlock, recordPost, storyAlreadyPosted, type HotDeskState } from "../../lib/news/hot-desk/state.ts";
import { botToken, telegramClient, TelegramRejection } from "../../lib/news/hot-desk/telegram-api.ts";

const mode = process.argv.includes("--send") ? "send" : process.argv.includes("--preview") ? "preview" : "dry-run";
const force = process.argv.includes("--force");
const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const output = path.join(directory, "hot-desk");
await mkdir(output, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_HOT_DESK_LOCKED) {
  const run = spawnSync("flock", ["-n", path.join(output, "run.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_HOT_DESK_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}

const stateFile = path.join(output, "state.json");
const usageFile = path.join(output, "writer-usage.jsonl");
const policy = hotDeskPolicy();
const minHype = Number(process.env.ODDSFRONT_HOT_DESK_MIN_HYPE) || MIN_HYPE;
const minConfidence = Number(process.env.ODDSFRONT_HOT_DESK_MIN_CONFIDENCE) || MIN_PAIR_CONFIDENCE;
const windowHours = Number(process.env.ODDSFRONT_HOT_DESK_WINDOW_HOURS) || 8;
const model = process.env.ODDSFRONT_HOT_DESK_MODEL || "sonnet";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

async function atomic(file: string, value: unknown) {
  await writeFile(`${file}.${process.pid}.tmp`, typeof value === "string" ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}

async function editor<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
  // A minimal environment: the CLI needs PATH and its own login under $HOME.
  const env = Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]]));
  return JSON.parse(await executeSubscriptionWriter({ prompt, schema, env, model, purpose: "selection", usageFile, timeoutMs: 240_000 })) as T;
}

function finish(status: string, details: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ status, mode, ...details }));
  process.exit(0);
}

try {
  let state: HotDeskState = EMPTY_STATE;
  try { state = { ...EMPTY_STATE, ...JSON.parse(await readFile(stateFile, "utf8")) }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (mode === "send" && state.pending) throw new Error("Previous send has an unknown outcome; reconcile it before retrying");
  if (mode === "send" && !force) {
    const block = publicationBlock(state, policy);
    if (block) finish(block);
  }

  const now = Date.now();
  const collection = await collectHeadlines(undefined, now, windowHours * 60 * 60_000);
  if (collection.feeds.filter(feed => feed.status === "ok").length < 5) throw new Error("Too few news feeds are reachable");
  const clusters = clusterHeadlines(collection.headlines).filter(cluster => !storyAlreadyPosted(state, cluster.fingerprint, policy, now));
  if (!clusters.length) finish("no-fresh-headlines");
  // An unchanged news cycle was already judged: skip the model call.
  if (mode === "send" && !force && !needsEvaluation(state, clusters, policy, now)) finish("no-new-developments");

  const recent = state.posts.filter(post => now - Date.parse(post.at) <= policy.storyMemoryHours * 60 * 60_000).map(post => post.storyTitle);
  const picks = acceptedStoryPicks(await editor(storySelectionPrompt(clusters, recent, now), STORY_SELECTION_SCHEMA), clusters, minHype);
  if (mode === "send") {
    state = { ...state, evaluated: { at: new Date(now).toISOString(), fingerprints: clusters.filter(cluster => cluster.coverage >= 2).map(cluster => cluster.fingerprint).slice(0, 80) } };
    await atomic(stateFile, state);
  }
  const draft: Record<string, unknown> = {
    collectedAt: collection.collectedAt,
    feeds: collection.feeds,
    topStories: clusters.slice(0, 15).map(cluster => ({ id: cluster.id, title: cluster.title, coverage: cluster.coverage, outlets: cluster.outlets.slice(0, 6), topStory: cluster.topStory })),
    picks,
  };
  const saveDraft = async (status: string) => atomic(path.join(output, `${stamp}-draft.json`), { status, mode, ...draft });
  if (!picks.length) { await saveDraft("no-hot-story"); finish("no-hot-story", { topStories: (draft.topStories as unknown[]).slice(0, 5) }); }

  const markets = (await candidateMarkets(picks.flatMap(pick => pick.queries), DEFAULT_MARKET_POLICY, now))
    .filter(market => !marketResting(state, market.id, market.dayChange, policy, now))
    // Search hits first, then the busiest movers; keep the prompt bounded.
    .toSorted((a, b) => b.queries.length - a.queries.length || Math.abs(b.dayChange ?? 0) - Math.abs(a.dayChange ?? 0) || b.volume - a.volume)
    .slice(0, 60);
  draft.candidates = markets.length;
  if (!markets.length) { await saveDraft("no-market"); finish("no-market", { picks }); }

  const { pair, problems } = acceptedPair(await editor(pairSelectionPrompt(picks, clusters, markets, now), PAIR_SELECTION_SCHEMA), picks, clusters, markets, minConfidence);
  if (!pair) { draft.problems = problems; await saveDraft("no-pair"); finish("no-pair", { picks, problems }); }

  // Refresh prices right before rendering so the card, caption and buttons agree.
  const refreshed = await refreshMarket(pair.market.id, DEFAULT_MARKET_POLICY);
  if (!refreshed) { draft.problems = ["selected market is no longer tradable"]; await saveDraft("market-closed"); finish("market-closed"); }
  const market = { ...pair.market, ...refreshed, eventTitle: pair.market.eventTitle, eventSlug: pair.market.eventSlug, image: refreshed.image ?? pair.market.image };
  const [history, thumbnail] = await Promise.all([priceHistory(market.yesTokenId), marketThumbnail(market.image)]);
  const locales: HotDeskLocale[] = ["en", "ru"];
  const images = await renderCards(locales.map(locale => ({ locale, copy: pair.copy, market, history, thumbnail })));
  const posts = locales.map((locale, index) => ({ locale, image: images[index]!, caption: hotDeskCaption(pair.copy, market, locale), keyboard: betKeyboard(market, locale) }));
  for (const post of posts) await writeFile(path.join(output, `${stamp}-${post.locale}.png`), post.image, { mode: 0o600 });
  Object.assign(draft, {
    story: { id: pair.cluster.id, title: pair.cluster.title, outlets: pair.cluster.outlets, coverage: pair.cluster.coverage, hype: pair.pick.hype, category: pair.pick.category },
    selection: pair.selection,
    market: { id: market.id, question: market.question, event: market.eventTitle, chance: market.chance, yesPrice: market.yesPrice, noPrice: market.noPrice, dayChange: market.dayChange, volume: Math.round(market.volume), endDate: market.endDate },
    posts: posts.map(post => ({ locale: post.locale, caption: post.caption, keyboard: post.keyboard, image: path.join(output, `${stamp}-${post.locale}.png`) })),
  });
  await saveDraft("ready");
  if (mode === "dry-run") finish("draft", { draft: path.join(output, `${stamp}-draft.json`), story: draft.story, market: draft.market, confidence: pair.selection.confidence });

  const telegram = telegramClient(await botToken());
  const bot = await telegram.verifyBot();
  if (mode === "preview") {
    const chat = process.env.ODDSFRONT_HOT_DESK_PREVIEW_CHAT;
    if (!chat || !/^-?\d{5,20}$/.test(chat)) throw new Error("ODDSFRONT_HOT_DESK_PREVIEW_CHAT is not configured");
    const sent = [];
    for (const post of posts) sent.push((await telegram.sendPhoto(chat, post.image, post.caption, post.keyboard)).message_id);
    finish("previewed", { chat, messages: sent, draft: path.join(output, `${stamp}-draft.json`) });
  }

  for (const locale of locales) await telegram.verifyChannel(locale, bot.id);
  const sent: { en: number | null; ru: number | null } = { en: null, ru: null };
  const pending = () => ({ marketId: market.id, storyTitle: pair.cluster.title, attemptedAt: new Date().toISOString(), sent: { ...sent } });
  await atomic(stateFile, { ...state, pending: pending() });
  const failures: string[] = [];
  for (const post of posts) {
    const channel = HOT_DESK_CHANNELS[post.locale];
    try {
      const message = await telegram.sendPhoto(channel.id, post.image, post.caption, post.keyboard);
      if (message.chat?.id !== channel.id) throw new TelegramRejection("Telegram receipt names another chat", false);
      sent[post.locale] = message.message_id;
      await atomic(stateFile, { ...state, pending: pending() });
    } catch (error) {
      // An ambiguous outcome keeps the pending guard so nothing is posted twice.
      if (!(error instanceof TelegramRejection && error.definite)) throw error;
      failures.push(`${post.locale}: ${error.message}`);
    }
  }
  if (sent.en === null && sent.ru === null) {
    await atomic(stateFile, state);
    throw new Error(`Both channels rejected the post: ${failures.join("; ")}`);
  }
  const receipt = {
    status: "published", sentAt: new Date().toISOString(), marketId: market.id, story: pair.cluster.title, failures,
    urls: locales.filter(locale => sent[locale] !== null).map(locale => `https://t.me/${HOT_DESK_CHANNELS[locale].username}/${sent[locale]}`),
  };
  await atomic(path.join(output, `${stamp}-receipt.json`), receipt);
  await atomic(stateFile, recordPost(state, { at: receipt.sentAt, storyTitle: pair.cluster.title, storyFingerprint: pair.cluster.fingerprint, marketId: market.id, dayChange: market.dayChange, messages: sent }));
  console.log(JSON.stringify(receipt));
} catch (error) {
  if (error instanceof WriterUsageLimitError) finish("writer-usage-limit");
  console.error(JSON.stringify({ status: "failed", mode, error: error instanceof Error ? error.message : "Hot desk run failed" }));
  process.exitCode = 1;
}
