import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateNewsDraft } from "../lib/news/validation";
import { normalizeLocale, negotiateLocale, localeDirection, regionFromLanguages } from "../lib/news/locale";
import { validateMessageCoverage } from "../lib/news/messages";
import { newsIndex } from "../lib/news/publication";
import type { NewsDraft, NewsCatalog } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

function draft():NewsDraft {
  return {publishable:true,rejectionReason:"",title:"Test fixture: regional diplomatic review",description:"Development-only publication validation fixture.",countries:["UA"],topics:["diplomacy"],
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
});

test("news index excludes article bodies and the full market dictionary",()=>{
  const index=newsIndex(seed as NewsCatalog);
  expect(index).not.toHaveProperty("marketTranslations");expect(index.articles.length).toBeGreaterThan(0);
  for(const article of index.articles){expect(article.body).toEqual([]);expect(article.readingMinutes).toBeGreaterThan(0);for(const text of Object.values(article.translations))expect(text.body).toEqual([]);}
});
