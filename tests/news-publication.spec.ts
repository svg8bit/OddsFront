import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { validateNewsDraft, verifiedNewsAlert } from "../lib/news/validation";
import { buildNewsMarketAlerts, NEWS_ALERT_MINIMUM_MARKET_VOLUME, NEWS_ALERT_TTL_MS } from "../lib/news/alert-matching";
import { normalizeLocale, negotiateLocale, localeDirection, regionFromLanguages } from "../lib/news/locale";
import { validateMessageCoverage } from "../lib/news/messages";
import { newsIndex } from "../lib/news/publication";
import type { NewsArticle, NewsDraft, NewsCatalog } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { availableNewsArticlePath, switchNewsLocalePath } from "../lib/news/routing";
import { researchProblems, researchExclusions, researchPrompt } from "../lib/news/research";
import { NEWS_SOURCES } from "../lib/news/sources";

function draft():NewsDraft {
  return {publishable:true,rejectionReason:"",alert:{eligible:false,kind:"none",actorCountries:[],targetCountries:[]},title:"Test fixture: regional diplomatic review",description:"Development-only publication validation fixture.",countries:["UA"],topics:["diplomacy"],
    body:Array.from({length:6},(_,index)=>({type:"paragraph" as const,text:`Development fixture paragraph ${index}. `+"Participants considered the proposed diplomatic timetable and requested additional information from the parties. The discussion left several practical questions open for further review. Observers identified the next formal meeting as the point at which representatives could clarify the outstanding details. No final agreement was announced during this stage of the process. The available record distinguishes proposals from decisions and avoids presenting expectations as established outcomes."})),
    sources:[{id:"media",publisher:"BBC",url:"https://www.bbc.com/news/world/test-fixture",kind:"media",title:"Development source",publishedAt:new Date().toISOString(),evidence:"Source evidence for a development fixture. ".repeat(8)},{id:"official",publisher:"UN",url:"https://www.un.org/test-fixture",kind:"official",title:"Primary development source",publishedAt:new Date().toISOString(),evidence:"Institutional evidence describing the source record for validation. ".repeat(5)}],
    factChecks:["The meeting occurred","The timetable is unresolved","There is no announced agreement"].map(claim=>({claim,sourceIds:["media","official"]}))};
}

test("publication rejects unsupported sources, malformed data, copied prose and stale reporting",()=>{
  const valid=draft();expect(validateNewsDraft(valid,[])).toEqual([]);
  const foreign=structuredClone(valid);foreign.sources[0].url="https://abcnews.go.com/world/fixture";expect(validateNewsDraft(foreign,[])).toContain("No fresh source from the configured news publishers");
  const malformed=structuredClone(valid);malformed.sources[0].evidence=null as unknown as string;expect(validateNewsDraft(malformed,[])).toEqual(["Invalid article structure"]);
  const copied=structuredClone(valid);copied.sources[0].evidence=copied.body[0].text;expect(validateNewsDraft(copied,[])).toContain("Copied source language");
  const stale=structuredClone(valid);stale.sources[0].publishedAt="2020-01-01T00:00:00Z";expect(validateNewsDraft(stale,[])).toContain("No fresh source from the configured news publishers");
  const injected=structuredClone(valid);injected.sources[0].url="https://www.bbc.com@evil.example/story";expect(validateNewsDraft(injected,[]).length).toBeGreaterThan(0);
});

test("accepts verified calendar dates without inventing source publication times",()=>{
  const article=draft();
  article.sources[0].publishedAt="2026-09-07";
  article.sources[1].publishedAt="2026-09-04";
  article.sources[1].url="https://www.fao.org/newsroom/detail/development-fixture/en";
  expect(validateNewsDraft(article,[],new Date("2026-09-07T12:00:00Z"))).toEqual([]);
});

test("distinguishes incomplete discovery from checked news that cannot be published",()=>{
  const report={summary:"Checked current candidates; primary evidence was unavailable.",sources:NEWS_SOURCES.map(source=>({publisher:source.name,url:source.url,status:"checked" as const,candidatesReviewed:2,reason:"Current sources inspected"})),rejectedCandidates:[]};
  expect(researchProblems(report)).toEqual([]);
  expect(researchProblems({...report,sources:report.sources.slice(1)})).toContain("Research did not cover Reuters");
  expect(researchProblems({...report,sources:report.sources.map(source=>({...source,status:"unavailable",candidatesReviewed:0}))})).toContain("Research inspected no current candidates");
  expect(researchProblems(undefined)).toContain("Missing news research report");
});

test("research excludes every catalog story beyond eighty without repeating institutional background", () => {
  const articles = Array.from({length:125}, (_, index) => ({...seed.articles[0], title:`Development exclusion ${index}`, sources:[
    {...seed.articles[0].sources[0], kind:"media" as const, url:`https://www.bbc.com/news/development-${index}`},
    {...seed.articles[0].sources[0], kind:"official" as const, url:"https://www.un.org/development-background"},
  ]})) as NewsArticle[];
  const index = researchExclusions(articles);
  expect(index).toHaveLength(125);
  expect(index[124]).toEqual({title:"Development exclusion 124",sources:["https://www.bbc.com/news/development-124"]});
  const feedback = [{title:"Development rejected candidate",reasons:["Already published story"],mediaSources:["https://www.bbc.com/news/development-rejected"]}];
  const prompt = researchPrompt(articles,1,new Date(),feedback);
  expect(prompt).toContain(JSON.stringify(index));
  expect(prompt).toContain(JSON.stringify(feedback));
  expect(prompt).not.toContain("https://www.un.org/development-background");
});

test("news alert gate requires a confirmed major event and an exact high-volume market direction",()=>{
  const now = new Date("2026-09-06T18:00:00.000Z");
  const candidate = structuredClone(draft());
  candidate.title = "United States strikes Iran after attacks begin overnight";
  candidate.description = "American forces attacked Iranian military sites, according to official and independent reporting.";
  candidate.countries = ["US", "IR"];
  candidate.alert = {eligible:true,kind:"strike",actorCountries:["US"],targetCountries:["IR"]};
  candidate.factChecks[0] = {claim:"The United States attacked Iran after the operation began overnight.",sourceIds:["media","official"]};
  const alert = verifiedNewsAlert(candidate);
  expect(alert).toEqual({kind:"strike",actorCountries:["US"],targetCountries:["IR"]});
  const abbreviated=structuredClone(candidate);
  abbreviated.title="US strikes Iran after attacks begin overnight";
  abbreviated.description="US forces attacked Iranian military sites.";
  abbreviated.factChecks[0].claim="US forces attacked Iran after the operation began overnight.";
  expect(verifiedNewsAlert(abbreviated)).toEqual(alert);

  const article: NewsArticle = {
    ...candidate,
    id:"alert-fixture",
    slug:"united-states-strikes-iran",
    alert,
    author:"OddsFront Newsdesk",
    publishedAt:new Date(now.getTime()-60_000).toISOString(),
    updatedAt:new Date(now.getTime()-60_000).toISOString(),
    translations:{},
    sources:candidate.sources.map(({id,title,publisher,url,kind,publishedAt})=>({id,title,publisher,url,kind,publishedAt})),
  };
  const fixture = getConflictPreviewFixtureFeed().events[0]!;
  const matching = {
    ...fixture,
    id:"polymarket-100",
    title:"Will the United States strike Iran by September 30?",
    countryCodes:["US","IR"],
    dataOrigin:"polymarket" as const,
    marketUrl:"https://polymarket.com/event/united-states-strike-iran",
    marketVolume:NEWS_ALERT_MINIMUM_MARKET_VOLUME,
    endDate:new Date(now.getTime()+86_400_000).toISOString(),
  };
  expect(buildNewsMarketAlerts([article],[matching],now.getTime())).toHaveLength(1);
  expect(buildNewsMarketAlerts([article],[{...matching,title:"Will Iran strike the United States by September 30?"}],now.getTime())).toEqual([]);
  expect(buildNewsMarketAlerts([article],[{...matching,marketVolume:NEWS_ALERT_MINIMUM_MARKET_VOLUME-1}],now.getTime())).toEqual([]);
  expect(buildNewsMarketAlerts([article],[{...matching,marketUrl:`https://polymarket.com/event/${"very-long-market-slug-".repeat(4)}`}],now.getTime())).toEqual([]);
  expect(buildNewsMarketAlerts([{...article,publishedAt:new Date(now.getTime()-NEWS_ALERT_TTL_MS).toISOString()}],[matching],now.getTime())).toEqual([]);

  const proposal = structuredClone(candidate);
  proposal.title = "United States may strike Iran as talks continue";
  expect(verifiedNewsAlert(proposal)).toBeNull();
});

test("publisher exports English immediately and retains the edition after duplicate or rejected batches",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"oddsfront-news-test-"));
  try{
    const input=join(directory,"draft.json");await writeFile(input,JSON.stringify({articles:[draft()]}));
    const run=()=>spawnSync(process.execPath,["scripts/news/publish.ts"],{encoding:"utf8",env:{...process.env,ODDSFRONT_NEWS_DIRECTORY:directory,ODDSFRONT_NEWS_DRAFT_FILE:input}});
    const first=run();expect(first.status,first.stderr).toBe(0);
    const before=await readFile(join(directory,"catalog.json"),"utf8");
    const publicIndex=JSON.parse(await readFile(join(directory,"public/catalog.json"),"utf8"));expect(publicIndex.articles).toHaveLength(1);expect(publicIndex.articles[0].body).toEqual([]);
    const detail=JSON.parse(await readFile(join(directory,"public/articles",`${publicIndex.articles[0].slug}.json`),"utf8"));expect(detail.body).toHaveLength(6);
    expect(run().status).toBe(0);expect(await readFile(join(directory,"catalog.json"),"utf8")).toBe(before);
    await writeFile(input,JSON.stringify({articles:[{...draft(),publishable:false,rejectionReason:"Insufficient evidence"}]}));expect(run().status).toBe(0);expect(await readFile(join(directory,"catalog.json"),"utf8")).toBe(before);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("language negotiation covers browser regions, aliases, fallback and RTL",()=>{
  expect(validateMessageCoverage()).toBe(true);
  expect(negotiateLocale(["ja-JP","ru-RU"])).toBe("ru");expect(negotiateLocale(["ja-JP"])).toBe("en");
  expect(normalizeLocale("pt-PT")).toBe("pt-BR");expect(normalizeLocale("zh-Hant-TW")).toBe("zh");expect(normalizeLocale("iw-IL")).toBe("he");
  expect(regionFromLanguages(["zh-Hant-TW"])).toBe("TW");expect(localeDirection("fa")).toBe("rtl");expect(localeDirection("he")).toBe("rtl");
  expect(switchNewsLocalePath("/ru/news","de")).toBe("/de/news");
  expect(switchNewsLocalePath("/news/archive","ru")).toBe("/news/archive");
  expect(availableNewsArticlePath({...seed.articles[0],translations:{}} as NewsArticle,"ru")).toBe(`/news/${seed.articles[0].countries[0].toLowerCase()}/${seed.articles[0].slug}`);
});

test("news index excludes article bodies and the full market dictionary",()=>{
  const index=newsIndex(seed as NewsCatalog);
  expect(index).not.toHaveProperty("marketTranslations");expect(index.articles.length).toBeGreaterThan(0);
  for(const article of index.articles){expect(article.body).toEqual([]);expect(article.readingMinutes).toBeGreaterThan(0);for(const text of Object.values(article.translations))expect(text.body).toEqual([]);}
});


test("public exports remain readable under the production service's private umask", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-export-permissions-"));
  try {
    const input = join(directory, "draft.json"); await writeFile(input, JSON.stringify({ articles: [draft()] }));
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", "process.umask(0o077); await import('./scripts/news/publish.ts');"], {
      encoding: "utf8", env: { ...process.env, ODDSFRONT_EDITION_LOCKED: "1", ODDSFRONT_NEWS_DIRECTORY: directory, ODDSFRONT_NEWS_DRAFT_FILE: input },
    });
    expect(run.status, run.stderr).toBe(0);
    const index = JSON.parse(await readFile(join(directory, "public/catalog.json"), "utf8"));
    for (const file of ["public/catalog.json", `public/articles/${index.articles[0].slug}.json`]) expect((await stat(join(directory, file))).mode & 0o777).toBe(0o644);
    expect((await stat(join(directory, "catalog.json"))).mode & 0o777).toBe(0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("editions retain partial research privately, resume to exactly nine and enforce the two-hour interval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-complete-edition-"));
  const titles = ["Test: Alpine delegations reopen mountain crossing", "Test: Coastal parliament approves maritime reform", "Test: Desert authorities announce water-sharing framework", "Test: Island leaders establish regional assembly", "Test: Northern ambassadors resume diplomatic dialogue", "Test: Eastern ministers appoint border commission", "Test: Southern council ratifies migration accord", "Test: Western agencies restore emergency coordination", "Test: Pacific representatives sign environmental treaty"];
  const articles = titles.map((title, i) => { const item = draft(); item.title = title; item.sources[0].url += `-${i}`; item.sources[1].url += `-${i}`; return item; });
  try {
    const input = join(directory, "draft.json");
    const mock = join(directory, "development-cover-fetch.mjs");
    await writeFile(mock, `globalThis.fetch = async url => {
      const image = String(url).startsWith('https://images.axios.com/');
      const response = new Response(image ? new Uint8Array([137,80,78,71]) : '<meta property="og:image" content="https://images.axios.com/development-fixture.png">', { headers: { 'content-type': image ? 'image/png' : 'text/html' } });
      Object.defineProperty(response, 'url', { value: String(url) }); return response;
    };`);
    const run = () => spawnSync(process.execPath, ["--import", mock, "scripts/news/run-edition.mjs"], { encoding: "utf8", env: { ...process.env, ODDSFRONT_NEWS_DIRECTORY: directory, ODDSFRONT_NEWS_DRAFT_FILE: input } });
    await writeFile(input, JSON.stringify({ articles: articles.slice(0, 3) }));
    const partial = run(); expect(partial.status, partial.stderr).toBe(1);
    await expect(readFile(join(directory, "public/catalog.json"))).rejects.toThrow();
    const staged = JSON.parse(await readFile(join(directory, "pending-edition/catalog.json"), "utf8")); expect(staged.articles).toHaveLength(3);
    const feedback = JSON.parse(await readFile(join(directory,"pending-edition/research-feedback.json"),"utf8"));
    expect(feedback.some((item:{reasons:string[]})=>item.reasons.includes("Already published story"))).toBe(true);
    const pendingPath = join(directory,"pending-edition/edition.json");
    const pending = JSON.parse(await readFile(pendingPath,"utf8"));
    expect(pending.retryAfter).toBeGreaterThan(Date.now());
    expect(run().stdout).toContain("research-cooldown");
    await writeFile(pendingPath,JSON.stringify({...pending,retryAfter:Date.now()-1}));
    await writeFile(input, JSON.stringify({ articles: articles.slice(3) }));
    const complete = run(); expect(complete.status, complete.stderr).toBe(0);
    const before = await readFile(join(directory, "public/catalog.json"), "utf8");
    const index = JSON.parse(before); expect(index.articles).toHaveLength(9); expect(new Set(index.articles.map((a: NewsArticle) => a.publishedAt)).size).toBe(1);
    const state = JSON.parse(await readFile(join(directory, "edition-state.json"), "utf8")); expect(state.articleIds).toHaveLength(9);
    expect(run().stdout).toContain("interval-not-due"); expect(await readFile(join(directory, "public/catalog.json"), "utf8")).toBe(before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an interval check does not block behind a running translation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-interval-lock-"));
  const lock = spawn("flock", [join(directory, "edition.lock"), "sh", "-c", "echo ready; cat"], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    await once(lock.stdout!, "data");
    await writeFile(join(directory, "edition-state.json"), JSON.stringify({ lastPublishedAt: Date.now() }));
    const run = spawnSync(process.execPath, ["scripts/news/run-edition.mjs"], { encoding: "utf8", timeout: 2_000, env: { ...process.env, ODDSFRONT_NEWS_DIRECTORY: directory } });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("interval-not-due");
  } finally {
    lock.stdin!.end();
    await once(lock, "close");
    await rm(directory, { recursive: true, force: true });
  }
});
