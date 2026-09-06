import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSubscriptionCodex } from "../../lib/news/writer.ts";
import { NEWS_BATCH_SCHEMA, researchPrompt } from "../../lib/news/research.ts";
import { articleSlug, validateNewsDraft } from "../../lib/news/validation.ts";
import type { NewsArticle, NewsCatalog, NewsDraft } from "../../lib/news/types.ts";
import { articleSummary } from "../../lib/news/publication.ts";

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
  const requested = Number(process.env.ODDSFRONT_NEWS_BATCH_SIZE || "9");
  const maxArticles = Number.isFinite(requested) ? Math.min(9, Math.max(1, Math.floor(requested))) : 9;
  const startedAt = new Date().toISOString();
  const raw = process.env.ODDSFRONT_NEWS_DRAFT_FILE
    ? await readFile(process.env.ODDSFRONT_NEWS_DRAFT_FILE, "utf8")
    : await executeSubscriptionCodex({ prompt: researchPrompt(catalog.articles, maxArticles), schema: NEWS_BATCH_SCHEMA,
      env: Object.fromEntries(["PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].map(key => [key, process.env[key]])),
      timeoutMs: 600_000 });
  const parsed = JSON.parse(raw) as { articles: NewsDraft[] };
  if (!Array.isArray(parsed.articles)) throw new Error("Invalid news batch");
  const published: NewsArticle[] = [];
  const rejected: { title: string; reasons: string[] }[] = [];
  for (const draft of parsed.articles.slice(0, maxArticles)) {
    const reasons = validateNewsDraft(draft, [...published, ...catalog.articles]);
    if (reasons.length) { rejected.push({ title: draft.title, reasons }); continue; }
    const now = new Date().toISOString();
    const slug = articleSlug(draft.title);
    const id = createHash("sha256").update(slug).digest("hex").slice(0, 20);
    const { title, description, body, countries, topics } = draft;
    published.push({ id, slug, title, description, body, countries, topics, author: "OddsFront Newsdesk", publishedAt: now, updatedAt: now, translations: {},
      sources: draft.sources.map(source => ({ id:source.id,title:source.title,publisher:source.publisher,url:source.url,kind:source.kind,publishedAt:source.publishedAt })) });
  }
  const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: maxArticles, published: published.map(article => article.slug), rejected };
  await mkdir(path.join(directory, "receipts"), { recursive: true });
  await writeFile(path.join(directory, "receipts", `${startedAt.replace(/[:.]/g,"-")}.json`), JSON.stringify({ receipt, evidence: parsed }, null, 2), { mode: 0o600 });
  if (!published.length) { console.log(JSON.stringify({...receipt,status:"No verified new stories; retained existing edition"})); process.exit(0); }
  const next = { ...catalog, updatedAt: receipt.finishedAt, articles: [...published, ...catalog.articles] };
  const temporary = `${catalogPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, catalogPath);
  const publicDirectory=process.env.ODDSFRONT_NEWS_PUBLIC_DIRECTORY || (process.env.ODDSFRONT_NEWS_DIRECTORY ? path.join(directory,"public") : "/opt/oddsfront-market-feed/news");
  await mkdir(path.join(publicDirectory,"articles"),{recursive:true});
  await chmod(publicDirectory,0o755);await chmod(path.join(publicDirectory,"articles"),0o755);
  for(const article of published){const file=path.join(publicDirectory,"articles",`${article.slug}.json`);await writeFile(`${file}.tmp`,JSON.stringify(article),{mode:0o644});await rename(`${file}.tmp`,file);}
  const indexPath=path.join(publicDirectory,"catalog.json");
  await writeFile(`${indexPath}.tmp`,JSON.stringify({...next,articles:next.articles.map(articleSummary)}),{mode:0o644});
  await rename(`${indexPath}.tmp`,indexPath);
  console.log(JSON.stringify(receipt));
}
