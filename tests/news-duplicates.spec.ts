import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalStoryUrl, findDuplicateStory, uniqueEditionArticles } from "../lib/news/duplicates";
import { writeNewsCatalog } from "../lib/news/storage";
import { newsIndex } from "../lib/news/publication";
import { freshEditionArticles, russianTelegramArticle } from "../lib/news/telegram";
import { xNewsArticle } from "../lib/news/x-publication";
import { researchExclusions } from "../lib/news/research";
import type { NewsArticle, NewsCatalog } from "../lib/news/types";

function story(id: string, title: string, lead: string): NewsArticle {
  return { id, slug: id, title, description: "Development-only duplicate regression fixture.",
    publishedAt: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date().toISOString(), author: "Test fixture",
    body: [{ type: "paragraph", text: lead }], countries: ["EG"], topics: ["security"],
    sources: [{ id: "media", title, publisher: "Euronews", kind: "media", url: `https://www.euronews.com/test/${id}`, publishedAt: new Date().toISOString() },
      { id: "official", title: "Shared institutional background", publisher: "UN", kind: "official", url: "https://www.un.org/test/background", publishedAt: new Date().toISOString() }],
    translations: { ru: { title: "Тестовый заголовок", description: "Тестовое описание", body: [], editorReviewed: true } } };
}

const original = () => story("original-fixture", "Egyptian court sentences presenter Sarah Khalifa and 11 others to death",
  "An Egyptian court sentenced television presenter Sarah Khalifa and 11 other defendants to death in a drug manufacturing and trafficking case. The verdict can be appealed.");
const duplicate = () => story("duplicate-fixture", "Egyptian presenter Sarah Khalifa's defence plans appeal against death sentence",
  "Egyptian television presenter Sarah Khalifa's defence plans to challenge her death sentence in a synthetic-drug manufacturing and trafficking case. No appeal decision has been issued.");

test("rejects the reported verdict repackaged as plans to appeal, even at a different media URL", () => {
  const first = original(), next = duplicate();
  expect(findDuplicateStory(next, [first])?.id).toBe(first.id);
  expect(uniqueEditionArticles([first, next], []).accepted).toEqual([first]);
  // Withdrawal remains in the exclusion index, with no expiration window.
  first.withdrawal = { at: new Date().toISOString(), duplicateOf: "earlier-fixture" };
  first.publishedAt = "2020-01-01T00:00:00Z";
  expect(findDuplicateStory(next, [first])?.id).toBe(first.id);
  expect(researchExclusions([first])).toHaveLength(1);
});

test("compares canonical media URLs and source headlines without treating shared background or a person as a duplicate", () => {
  const first = original();
  const next = story("different-fixture", "Lawyers prepare the next procedural stage in Cairo drug case", "Independent development fixture lead.");
  next.sources[0].url = "https://euronews.com/test/original-fixture/?utm_source=telegram#details";
  expect(findDuplicateStory(next, [first])?.id).toBe(first.id);
  next.sources[0].url = "https://news.sky.com/story/test-different-publisher";
  next.sources[0].title = first.title;
  expect(findDuplicateStory(next, [first])?.id).toBe(first.id);
  expect(canonicalStoryUrl("https://example.com/story?id=1&utm_source=test")).not.toBe(canonicalStoryUrl("https://example.com/story?id=2"));
  expect(canonicalStoryUrl("javascript:alert(1)")).toBe("");
  const distinct = story("distinct-fixture", "Sarah Khalifa launches independent broadcasting school", "Students enrolled in a new journalism course in Alexandria.");
  expect(findDuplicateStory(distinct, [first])).toBeUndefined();
});

test("uses the lead to catch a rewritten announcement without comparing generic background paragraphs", () => {
  const first = story("bridge-fixture", "Alpine transit authority opens Rhine bridge after safety inspection", "The Alpine transit authority opened the Rhine bridge on Tuesday following structural repairs that restored freight traffic between the two border towns.");
  const next = story("bridge-rewrite-fixture", "Freight firms welcome Alpine transit authority's Rhine bridge reopening", "Following structural repairs, the Alpine transit authority opened the Rhine bridge on Tuesday, restoring freight traffic between the two border towns.");
  expect(findDuplicateStory(next, [first])?.id).toBe(first.id);
  next.body = [{ type: "paragraph", text: "Freight businesses rejected a newly announced customs tax on steel imports." }, ...first.body];
  expect(findDuplicateStory(next, [first])).toBeUndefined();
});

test("a resumed staged edition rejects an already published story and never exports an eight-story batch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-novelty-edition-"));
  try {
    const first = original();
    const titles = ["Alpine delegations reopen mountain crossing", "Coastal parliament approves maritime reform", "Desert authorities announce water-sharing framework", "Island leaders establish regional assembly", "Northern ambassadors resume diplomatic dialogue", "Eastern ministers appoint border commission", "Southern council ratifies migration accord", "Pacific representatives sign environmental treaty"];
    const candidates = [duplicate(), ...titles.map((title, i) => story(`candidate-${i}`, title, `Development fixture ${i}.`))];
    const catalog: NewsCatalog = { version: 1, updatedAt: first.updatedAt, articles: [first], marketTranslations: {} };
    await writeNewsCatalog(directory, join(directory, "public"), catalog, [first]);
    const before = await readFile(join(directory, "public/catalog.json"), "utf8");
    await mkdir(join(directory, "pending-edition"));
    await writeFile(join(directory, "pending-edition/catalog.json"), JSON.stringify({ ...catalog, articles: [...candidates, first] }));
    await writeFile(join(directory, "pending-edition/edition.json"), JSON.stringify({ startedAt: first.updatedAt, baseIds: [first.id] }));
    const input = join(directory, "empty-research.json");
    await writeFile(input, JSON.stringify({ articles: [] }));
    const run = spawnSync(process.execPath, ["scripts/news/run-edition.mjs", "--force"], { encoding: "utf8", env: { ...process.env, ODDSFRONT_NEWS_DIRECTORY: directory, ODDSFRONT_NEWS_DRAFT_FILE: input } });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('"prepared":8');
    expect(await readFile(join(directory, "public/catalog.json"), "utf8")).toBe(before);
    const staged = JSON.parse(await readFile(join(directory, "pending-edition/catalog.json"), "utf8"));
    expect(staged.articles.some((article: NewsArticle) => article.id === "duplicate-fixture")).toBe(false);
    expect(staged.articles).toHaveLength(9); // Eight private candidates plus the original history record.
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("withdrawal retains evidence and history but disappears from every export and social selector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-withdrawal-"));
  try {
    const first = original(), next = duplicate();
    first.publishedAt = new Date(Date.now() - 120_000).toISOString();
    const catalog: NewsCatalog = { version: 1, updatedAt: next.updatedAt, articles: [next, first], marketTranslations: {} };
    const publicDirectory = join(directory, "public");
    await writeNewsCatalog(directory, publicDirectory, catalog, catalog.articles);
    await writeFile(join(directory, "edition-state.json"), '{"lastPublishedAt":123}');
    const run = () => spawnSync(process.execPath, ["scripts/news/withdraw-duplicate.ts", next.id, first.id], { encoding: "utf8", env: { ...process.env, ODDSFRONT_NEWS_DIRECTORY: directory } });
    const result = run(); expect(result.status, result.stderr).toBe(0);
    expect(run().status).toBe(0);
    const retained = JSON.parse(await readFile(join(directory, "catalog.json"), "utf8")) as NewsCatalog;
    expect(retained.articles).toHaveLength(2);
    expect(newsIndex(retained).articles.map(article => article.id)).toEqual([first.id]);
    expect(freshEditionArticles(retained.articles, []).map(article => article.id)).toEqual([first.id]);
    expect(russianTelegramArticle(retained.articles, next.id, [])).toBeNull();
    expect(xNewsArticle(retained.articles, [next.id], [])).toBeNull();
    expect(await readFile(join(directory, "edition-state.json"), "utf8")).toBe('{"lastPublishedAt":123}');
    const receipt = JSON.parse(await readFile(join(directory, "withdrawals", `${next.id}.json`), "utf8"));
    expect(receipt.article).toEqual(next);
    expect((await stat(join(directory, "withdrawals", `${next.id}.json`))).mode & 0o777).toBe(0o600);
    // Test both independent export paths without loading a translation model.
    await writeNewsCatalog(directory, publicDirectory, retained, retained.articles);
    const python = spawnSync("python3", ["-c", `import importlib.util, json, sys, types
sys.modules['ctranslate2'] = types.ModuleType('ctranslate2')
sys.modules['sentencepiece'] = types.ModuleType('sentencepiece')
spec = importlib.util.spec_from_file_location('translator', 'scripts/news/translate.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.export_catalog(json.loads((module.DIRECTORY / 'catalog.json').read_text()))
`], { encoding: "utf8", env: { ...process.env, ODDSFRONT_NEWS_DIRECTORY: directory } });
    expect(python.status, python.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(publicDirectory, "catalog.json"), "utf8")).articles.map((article: NewsArticle) => article.id)).toEqual([first.id]);
    await expect(readFile(join(publicDirectory, "articles", `${next.slug}.json`))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(publicDirectory, "articles", `${first.slug}.json`), "utf8")).id).toBe(first.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
