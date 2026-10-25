// OddsFront website wire desk: hot stories from outlet feeds → the outlets'
// own article text, fetched server-side → one Claude call per story writing an
// original English article and its Russian edition → deterministic gates →
// OddsFront's own map cover → per-article publication into the catalog the
// feed service serves → on-demand page refresh, IndexNow and WebSub.
//
//   node scripts/news/wire-desk.ts                 dry run into ODDSFRONT_WIRE_DESK_DIRECTORY (or --out=DIR)
//   node scripts/news/wire-desk.ts --publish       publish to ODDSFRONT_NEWS_PUBLIC_DIRECTORY (/opt/oddsfront-market-feed/news)
//   --force          ask the editor even when no new story appeared (budgets still apply)
//   --retire-seed    drop the bundled week-old seed story once a new article is live
//   --no-cover       skip the map cover (the site draws its own artwork)
//   --max=N          at most N articles this run
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { executeSubscriptionWriter, WriterUsageLimitError } from "../../lib/news/writer.ts";
import { collectWireHeadlines, openStories, readableSiblings, storiesNeedingEvaluation, wireStories } from "../../lib/news/wire-desk/leads.ts";
import { fetchTrendSignals, scoreStories } from "../../lib/news/viral/signals.ts";
import { acceptedPicks, promptStories, SELECTION_SCHEMA, SELECTION_SYSTEM_PROMPT, selectionPrompt, type WirePick } from "../../lib/news/wire-desk/selection.ts";
import { gatherSources, type FetchOutcome, type SourceText } from "../../lib/news/wire-desk/source-text.ts";
import { storyMarkets, type StoryMarket } from "../../lib/news/wire-desk/markets.ts";
import { ARTICLE_SYSTEM_PROMPT, articlePrompt, cleanDraft, draftToArticle, parseArticleAnswer, reviewDraft, type ArticleDraft, type DraftReview } from "../../lib/news/wire-desk/article.ts";
import { coverContext, coverFocus, launchCoverBrowser, renderCover, type CoverContext } from "../../lib/news/wire-desk/cover.ts";
import { loadCatalog, notifyIndexNow, notifyWebSub, publishArticle, requestRevalidation, retireSeedArticles, revalidationPaths, type NotifyResult } from "../../lib/news/wire-desk/publish.ts";
import { articleAllowance, backOff, clearBackOff, countCall, countPublished, currentBudget, EMPTY_WIRE_STATE, pruneState, runBlock, wireDeskPolicy, type WireDeskState } from "../../lib/news/wire-desk/state.ts";
import type { NewsArticle, NewsCatalog } from "../../lib/news/types.ts";

const argv = process.argv.slice(2);
const publish = argv.includes("--publish");
const force = argv.includes("--force");
const retireSeed = argv.includes("--retire-seed");
const noCover = argv.includes("--no-cover");
const maxArg = Number(argv.find(arg => arg.startsWith("--max="))?.slice(6));
const outArg = argv.find(arg => arg.startsWith("--out="))?.slice(6);
const directory = path.resolve(outArg || process.env.ODDSFRONT_WIRE_DESK_DIRECTORY || (publish ? "/root/OddsFront/.local/news/wire-desk" : "/root/OddsFront/.local/news/wire-desk-dry-run"));
const livePublicDirectory = process.env.ODDSFRONT_NEWS_PUBLIC_DIRECTORY || "/opt/oddsfront-market-feed/news";
// A dry run never writes the live catalog: it publishes into its own copy.
const publicDirectory = publish ? livePublicDirectory : path.join(directory, "public");
const LIVE_REFRESH_DELAY_MS = 35_000;

await mkdir(directory, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_WIRE_DESK_LOCKED) {
  const run = spawnSync("flock", ["-n", path.join(directory, "run.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_WIRE_DESK_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}

const policy = wireDeskPolicy();
const stateFile = path.join(directory, "state.json");
const usageFile = path.join(directory, "writer-usage.jsonl");
const draftsDirectory = path.join(directory, "drafts");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), mode: publish ? "publish" : "dry-run", directory, publicDirectory };

async function atomic(file: string, value: unknown, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.${process.pid}.tmp`, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2), { mode });
  await rename(`${file}.${process.pid}.tmp`, file);
}

let state: WireDeskState = EMPTY_WIRE_STATE;
const saveState = () => atomic(stateFile, pruneState(state));

async function finish(status: string, details: Record<string, unknown> = {}): Promise<never> {
  Object.assign(receipt, { status, finishedAt: new Date().toISOString(), budget: currentBudget(state) }, details);
  await saveState();
  await atomic(path.join(directory, "runs", `${stamp}.json`), receipt);
  console.log(JSON.stringify({ status, mode: receipt.mode, ...details, receipt: path.join(directory, "runs", `${stamp}.json`) }));
  process.exit(0);
}

function writerEnv() {
  // A minimal environment: the CLI needs PATH and its own login under $HOME.
  return Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]]));
}

/** One counted Claude call: JSON for a schema, the plain answer text without one. */
async function callWriter(kind: "selectionCalls" | "writerCalls", prompt: string, schema: Record<string, unknown> | null, systemPrompt: string, purpose: "selection" | "article", timeoutMs: number): Promise<string> {
  // Count before the call: a crashed or timed-out call still spent usage.
  state = countCall(state, kind);
  await saveState();
  const output = await executeSubscriptionWriter({ prompt, schema, env: writerEnv(), model: policy.model, purpose, usageFile, timeoutMs, systemPrompt, disableThinking: true, backend: "claude" });
  state = clearBackOff(state);
  return output;
}

// The story's first report identifies it across runs (later reports only join it).
const storyKey = (pick: WirePick) => {
  const first = pick.stories.flatMap(story => story.members).toSorted((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.url.localeCompare(b.url))[0];
  return createHash("sha256").update(first?.url ?? pick.development).digest("hex").slice(0, 16);
};

async function seedIds(): Promise<Set<string>> {
  try {
    const seed = JSON.parse(await readFile(path.join(process.cwd(), "lib/news/catalog.seed.json"), "utf8")) as NewsCatalog;
    return new Set(seed.articles.map(article => article.id));
  } catch { return new Set(); }
}

async function pruneDrafts() {
  const files = await readdir(draftsDirectory).catch(() => [] as string[]);
  for (const file of files) {
    const full = path.join(draftsDirectory, file);
    const info = await stat(full).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 7 * 86_400_000) await rm(full, { force: true });
  }
}

try {
  try { state = { ...EMPTY_WIRE_STATE, ...JSON.parse(await readFile(stateFile, "utf8")) }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  state = pruneState(state);
  const block = runBlock(state, policy);
  if (block) await finish(block);

  const now = Date.now();
  const collection = await collectWireHeadlines(undefined, now, policy.windowHours * 3_600_000);
  receipt.feeds = { ok: collection.feeds.filter(feed => feed.status === "ok").length, total: collection.feeds.length, failed: collection.feeds.filter(feed => feed.status !== "ok").map(feed => feed.url), headlines: collection.headlines.length };
  if (collection.feeds.filter(feed => feed.status === "ok").length < 8) throw new Error("Too few news feeds are reachable");
  const stories = wireStories(collection.headlines);
  const open = openStories(stories, state.consumed, state.ledger, now);
  const fresh = storiesNeedingEvaluation(open, state.evaluated, now, policy.reevaluateMinutes, policy.minCoverage);
  receipt.stories = { total: stories.length, open: open.length, fresh: fresh.length };
  if (!fresh.length && !force) await finish("no-new-stories");

  // The first run starts from the live catalog (read only), so earlier stories and the map's translations stay.
  const loaded = await loadCatalog(directory, publish ? livePublicDirectory : publicDirectory);
  let catalog = loaded.catalog;
  if (!publish && loaded.bootstrapped && !catalog.articles.length) catalog = (await loadCatalog(path.join(directory, "none"), livePublicDirectory)).catalog;
  const recent = catalog.articles.filter(article => !article.withdrawal && now - Date.parse(article.publishedAt) <= 48 * 3_600_000);

  // Virality (Reddit, Google Trends, GDELT) orders the editor's list and is shown to the editor.
  const candidates = promptStories(open);
  const scores = await scoreStories(candidates, await fetchTrendSignals(), { now, stateFile: path.join(path.dirname(directory), "viral", "gdelt.json") }).catch(() => [] as Awaited<ReturnType<typeof scoreStories>>);
  candidates.forEach((story, index) => { if (scores[index]) story.viral = scores[index]; });
  receipt.viral = candidates.filter(story => story.viral && story.viral.score >= 30).toSorted((a, b) => b.viral!.score - a.viral!.score).slice(0, 10).map(story => ({ title: story.title, score: story.viral!.score, signals: story.viral!.signals }));

  const maxPicks = Math.min(articleAllowance(state, policy, now), Number.isFinite(maxArg) && maxArg > 0 ? maxArg : Infinity);
  const selection = JSON.parse(await callWriter("selectionCalls", selectionPrompt(open, recent.map(article => ({ title: article.title, publishedAt: article.publishedAt })), Math.max(1, maxPicks), now, policy.minCoverage), SELECTION_SCHEMA, SELECTION_SYSTEM_PROMPT, "selection", 150_000)) as unknown;
  // Every eligible story the editor saw is judged; it is asked again only after the re-evaluation window or when it changes.
  const shown = promptStories(open).filter(story => story.topical > 0 && (story.coverage >= policy.minCoverage || story.wire));
  state = { ...state, evaluated: [...state.evaluated, ...shown.map(story => ({ at: new Date(now).toISOString(), fingerprint: story.fingerprint }))] };
  await saveState();
  const picks = acceptedPicks(selection, open, { minPriority: policy.minPriority, minCoverage: policy.minCoverage }).slice(0, maxPicks);
  receipt.selection = { raw: selection, picks: picks.map(pick => ({ priority: pick.priority, category: pick.category, development: pick.development, coverage: pick.coverage, outlets: pick.outlets.slice(0, 8), wire: pick.wire, stories: pick.stories.map(story => story.title), marketQueries: pick.marketQueries })) };
  if (!picks.length) await finish("no-pick");

  const seeds = await seedIds();
  let browser: Browser | null = null;
  let context: CoverContext | null = null;
  const published: NewsArticle[] = [];
  const results: Record<string, unknown>[] = [];
  let lastExportAt = 0;
  try {
    for (const pick of picks) {
      const key = storyKey(pick);
      const result: Record<string, unknown> = { key, development: pick.development, priority: pick.priority };
      results.push(result);
      if (state.ledger.some(entry => entry.key === key && entry.status !== "drafted")) { result.status = "already-handled"; continue; }
      const members = pick.stories.flatMap(story => story.members);
      const fingerprint = [...new Set(pick.stories.flatMap(story => story.fingerprint))].slice(0, 14);
      const consume = () => { state = { ...state, consumed: [...state.consumed, ...members.map(member => ({ url: member.url, at: new Date().toISOString() }))] }; };
      const reject = async (reasons: string[]) => {
        consume();
        state = { ...state, ledger: [...state.ledger, { key, title: pick.development || pick.stories[0]!.title, fingerprint, at: new Date().toISOString(), status: "rejected", reasons }] };
        result.status = "rejected"; result.reasons = reasons;
        await saveState();
      };

      const draftFile = path.join(draftsDirectory, `${key}.json`);
      let cached: { draft: ArticleDraft; sources: SourceText[]; markets: StoryMarket[] } | null = null;
      try { cached = JSON.parse(await readFile(draftFile, "utf8")); } catch { cached = null; }
      let sources: SourceText[]; let markets: StoryMarket[]; let outcomes: FetchOutcome[] = [];
      if (cached) { ({ sources, markets } = cached); result.cachedDraft = true; }
      else {
        const gathered = await gatherSources([...members, ...readableSiblings(fingerprint, members, collection.headlines)], 3);
        sources = gathered.sources; outcomes = gathered.outcomes;
        markets = await storyMarkets(pick.marketQueries).catch(() => []);
      }
      result.sources = sources.map(source => ({ id: source.id, outlet: source.outlet, url: source.url, chars: source.text.length, origin: source.origin }));
      result.fetches = outcomes;
      result.markets = markets.map(market => ({ id: market.id, question: market.question, chance: market.chance }));
      if (!sources.length) { await reject(["no readable full text from an allowed outlet"]); continue; }

      let draft: ArticleDraft | null = cached?.draft ?? null;
      let review = draft ? reviewDraft(draft, sources, markets, catalog.articles) : null;
      const attempts: { problems: string[] }[] = [];
      for (let attempt = 0; (!review || review.fixable) && attempt < 2; attempt += 1) {
        if (currentBudget(state).writerCalls >= policy.dailyWriterCalls) break;
        let answer: string;
        try {
          answer = await callWriter("writerCalls", articlePrompt(pick, sources, markets, recent.map(article => article.title), Date.now(), review?.problems ?? []), null, ARTICLE_SYSTEM_PROMPT, "article", 300_000);
        } catch (error) {
          // A usage-limit refusal stops the run; any other writer failure drops this story only.
          if (error instanceof WriterUsageLimitError) throw error;
          draft = null; review = { problems: [`writer error: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`], fixable: false, overlap: null };
          break;
        }
        const parsed = parseArticleAnswer(answer);
        if (!parsed) {
          review = { problems: ["the answer did not follow the tagged answer format; reply with exactly the tags of ANSWER FORMAT"], fixable: true, overlap: null } satisfies DraftReview;
          attempts.push({ problems: review.problems });
          continue;
        }
        draft = cleanDraft(parsed);
        review = reviewDraft(draft, sources, markets, catalog.articles);
        attempts.push({ problems: review.problems });
      }
      result.attempts = attempts;
      if (!draft && review) { await reject(review.problems); continue; }
      if (!draft || !review) { result.status = "writer-budget"; continue; }
      if (review.problems.length) { await reject(review.problems); await atomic(path.join(draftsDirectory, `${key}-rejected.json`), { draft, sources, markets, review }); continue; }
      await atomic(draftFile, { draft, sources, markets });
      result.overlap = review.overlap ? { ratio: Math.round(review.overlap.ratio * 1000) / 1000, longestRun: review.overlap.longestRun } : null;

      const publishedAt = new Date().toISOString();
      const article = draftToArticle(draft, sources, publishedAt);
      if (catalog.articles.some(existing => existing.slug === article.slug || existing.id === article.id)) { await reject([`slug already published: ${article.slug}`]); continue; }
      let cover: Buffer | null = null;
      if (!noCover) {
        context ??= await coverContext();
        browser ??= await launchCoverBrowser();
        const market = draft.marketId ? markets.find(item => item.id === draft!.marketId) ?? null : null;
        const rendered = await renderCover(browser, coverFocus(context, article.countries, market ? { conditionId: market.conditionId, eventId: market.eventId } : null), process.env.ODDSFRONT_WIRE_DESK_MAP_URL || undefined);
        cover = rendered.cover?.jpeg ?? null;
        result.cover = rendered.cover ? { focus: rendered.cover.focus.kind, popupOpen: rendered.cover.popupOpen, bytes: cover?.byteLength } : { failed: rendered.reason };
      }
      article.cover = cover ? { kind: "own", imageUrl: "cover.jpg", sourceUrl: "", verifiedAt: publishedAt } : { kind: "none", imageUrl: "", sourceUrl: "", verifiedAt: publishedAt };
      if (cover) await atomic(path.join(directory, "covers", `${article.slug}.jpg`), cover);
      catalog = await publishArticle(directory, publicDirectory, catalog, article, cover);
      lastExportAt = Date.now();
      published.push(article);
      consume();
      state = countPublished(state);
      state = { ...state, ledger: [...state.ledger, { key, title: article.title, fingerprint, at: publishedAt, status: "published", slug: article.slug }] };
      await saveState();
      Object.assign(result, { status: "published", slug: article.slug, titleEn: article.title, titleRu: article.translations.ru?.title, url: `https://oddsfront.com/en/news/${article.slug}`, marketId: draft.marketId });
    }
  } finally {
    if (browser) await (browser as Browser).close().catch(() => undefined);
  }
  receipt.articles = results;
  if (!published.length) await finish("nothing-published");

  let retired: NewsArticle[] = [];
  if (retireSeed) {
    const outcome = await retireSeedArticles(directory, publicDirectory, catalog, seeds);
    catalog = outcome.catalog; retired = outcome.retired;
    if (retired.length) lastExportAt = Date.now();
  }
  const paths = revalidationPaths(catalog, published, retired);
  const notifications: (NotifyResult & { urls?: number })[] = [];
  if (publish) {
    // Warm site workers keep a catalog for 30 s; refresh after that so regenerated pages read this export.
    const wait = LIVE_REFRESH_DELAY_MS - (Date.now() - lastExportAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    notifications.push(await requestRevalidation(paths));
  }
  notifications.push(await notifyIndexNow(directory, catalog, !publish), await notifyWebSub(!publish));
  await pruneDrafts();
  await finish("published", { published: published.map(article => ({ slug: article.slug, en: article.title, ru: article.translations.ru?.title })), retired: retired.map(article => article.slug), revalidate: paths, notifications });
} catch (error) {
  if (error instanceof WriterUsageLimitError) {
    state = backOff(state);
    await finish("writer-usage-limit", { backoffUntil: new Date(state.backoff.until).toISOString() });
  }
  Object.assign(receipt, { status: "failed", error: error instanceof Error ? error.message : "Wire desk run failed" });
  await saveState().catch(() => undefined);
  await atomic(path.join(directory, "runs", `${stamp}.json`), receipt).catch(() => undefined);
  console.error(JSON.stringify({ status: "failed", mode: receipt.mode, error: receipt.error }));
  process.exitCode = 1;
}
