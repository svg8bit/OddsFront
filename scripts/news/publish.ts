import { collectNewsFeedDiscovery, selectNewsDiscoveryLeads, type NewsFeedDiscovery } from "../../lib/news/feed-discovery.ts";
import { NEWS_EDITION_SIZE } from "../../lib/news/edition-policy.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSubscriptionCodex } from "../../lib/news/writer.ts";
import { NEWS_BATCH_SCHEMA, researchPrompt, researchProblems } from "../../lib/news/research.ts";
import type { NewsResearchReport, NewsResearchRejection } from "../../lib/news/research.ts";
import { articleSlug, validateNewsDraft, verifiedNewsAlert } from "../../lib/news/validation.ts";
import type { NewsArticle, NewsCatalog, NewsDraft } from "../../lib/news/types.ts";
import { writeNewsCatalog } from "../../lib/news/storage.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const catalogPath = path.join(directory, "catalog.json");
await mkdir(directory, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_EDITION_LOCKED) {
  const run=spawnSync("flock", ["-n",path.join(directory,"edition.lock"),process.execPath,...process.execArgv,...process.argv.slice(1)], {stdio:"inherit",env:{...process.env,ODDSFRONT_EDITION_LOCKED:"1"}});
  if(run.error)throw run.error;
  process.exit(run.status??1);
}
{
  let catalog: NewsCatalog = { version: 1, updatedAt: "1970-01-01T00:00:00.000Z", articles: [], marketTranslations: {} };
  try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let coverRejected: NewsArticle[] = [];
  try { coverRejected = JSON.parse(await readFile(path.join(directory, "cover-rejections.json"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const feedbackPath = path.join(directory, "research-feedback.json");
  let feedback: NewsResearchRejection[] = [];
  try { feedback = JSON.parse(await readFile(feedbackPath, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const requested = Number(process.env.ODDSFRONT_NEWS_BATCH_SIZE || NEWS_EDITION_SIZE);
  const maxArticles = Number.isFinite(requested) ? Math.min(NEWS_EDITION_SIZE, Math.max(1, Math.floor(requested))) : NEWS_EDITION_SIZE;
  const startedAt = new Date().toISOString();
  let discovery: NewsFeedDiscovery | undefined;
  if (!process.env.ODDSFRONT_NEWS_DRAFT_FILE) {
    const file = path.join(directory, "discovery-feeds.json");
    try {
      const cached = JSON.parse(await readFile(file, "utf8")) as NewsFeedDiscovery;
      const age = Date.now() - Date.parse(cached.collectedAt);
      if (age >= 0 && age < 10 * 60_000 && Array.isArray(cached.leads) && Array.isArray(cached.feeds)) discovery = cached;
    } catch { /* A missing or invalid cache is refreshed from public feeds. */ }
    if (!discovery) {
      discovery = await collectNewsFeedDiscovery();
      await writeFile(`${file}.tmp`, JSON.stringify(discovery), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    }
    discovery = { ...discovery, leads: selectNewsDiscoveryLeads(discovery, [...coverRejected, ...catalog.articles]) };
  }
  const raw = process.env.ODDSFRONT_NEWS_DRAFT_FILE
    ? await readFile(process.env.ODDSFRONT_NEWS_DRAFT_FILE, "utf8")
    : await executeSubscriptionCodex({ prompt: researchPrompt([...coverRejected, ...catalog.articles], maxArticles, new Date(), feedback, discovery), schema: NEWS_BATCH_SCHEMA,
      env: Object.fromEntries(["PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]])),
      timeoutMs: 600_000 });
  const parsed = JSON.parse(raw) as { articles: NewsDraft[]; research?: NewsResearchReport };
  if (!Array.isArray(parsed.articles)) throw new Error("Invalid news batch");
  const researchErrors = process.env.ODDSFRONT_NEWS_DRAFT_FILE && !parsed.research ? [] : researchProblems(parsed.research);
  const published: NewsArticle[] = [];
  const rejected: { title: string; reasons: string[] }[] = [];
  for (const draft of researchErrors.length ? [] : parsed.articles.slice(0, NEWS_EDITION_SIZE * 3)) {
    if (published.length === maxArticles) break;
    const reasons = validateNewsDraft(draft, [...published, ...catalog.articles, ...coverRejected]);
    if (reasons.length) { rejected.push({ title: draft.title, reasons }); continue; }
    const now = new Date().toISOString();
    const slug = articleSlug(draft.title);
    const id = createHash("sha256").update(slug).digest("hex").slice(0, 20);
    const { title, description, body, countries, topics } = draft;
    published.push({ id, slug, title, description, body, countries, topics, alert: verifiedNewsAlert(draft), author: "OddsFront Newsdesk", publishedAt: now, updatedAt: now, translations: {},
      sources: draft.sources.map(source => ({ id:source.id,title:source.title,publisher:source.publisher,url:source.url,kind:source.kind,publishedAt:source.publishedAt })) });
  }
  const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: maxArticles, published: published.map(article => article.slug), rejected, research: parsed.research, researchErrors };
  await mkdir(path.join(directory, "receipts"), { recursive: true });
  await writeFile(path.join(directory, "receipts", `${startedAt.replace(/[:.]/g,"-")}.json`), JSON.stringify({ receipt, evidence: parsed }, null, 2), { mode: 0o600 });
  const failures = rejected.map(item => ({ ...item, mediaSources: (parsed.articles.find(draft => draft?.title === item.title)?.sources ?? []).filter(source => source?.kind === "media" && typeof source.url === "string").map(source => source.url) }));
  const updatedTitles = new Set(failures.map(item => item.title));
  feedback = [...feedback.filter(item => !updatedTitles.has(item.title)), ...failures].slice(-24);
  await writeFile(`${feedbackPath}.tmp`, JSON.stringify(feedback), { mode: 0o600 });
  await rename(`${feedbackPath}.tmp`, feedbackPath);
  if (researchErrors.length) throw new Error(`News research incomplete: ${researchErrors.join("; ")}`);
  if (!published.length) { console.log(JSON.stringify({...receipt,status:"No verified new stories; retained existing edition"})); process.exit(0); }
  const next = { ...catalog, updatedAt: receipt.finishedAt, articles: [...published, ...catalog.articles] };
  const publicDirectory=process.env.ODDSFRONT_NEWS_PUBLIC_DIRECTORY || (process.env.ODDSFRONT_NEWS_DIRECTORY ? path.join(directory,"public") : "/opt/oddsfront-market-feed/news");
  await writeNewsCatalog(directory, publicDirectory, next, published);
  console.log(JSON.stringify(receipt));
}
