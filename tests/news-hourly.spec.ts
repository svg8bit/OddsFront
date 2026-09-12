import { expect,test } from "@playwright/test";
import { articleCategory } from "../lib/news/categories";
import { freshEditionArticles,TELEGRAM_INTERVAL_MS } from "../lib/news/telegram";
import { X_NEWS_INTERVAL_MS } from "../lib/news/x-publication";
import { publicationHealthPlan,PUBLICATION_JOBS,type PublicationHealth,type PublicationJob } from "../lib/news/supervision";
import { newsRss } from "../lib/news/rss";
import seed from "../lib/news/catalog.seed.json";
import type { NewsArticle,NewsCatalog } from "../lib/news/types";

test("hourly selection alternates available countries and editorial topics without repeating articles",()=>{
  const now=Date.now();const base={...seed.articles[0],publishedAt:new Date(now-60_000).toISOString()} as NewsArticle;
  const previous={...base,id:"previous",title:"Drones strike Ukraine",countries:["UA","RU"],topics:["attack"]};
  const repeat={...previous,id:"same-conflict"};
  const differentPlace={...previous,id:"another-strike",countries:["IR","IL"]};
  const differentBoth={...base,id:"other-topic-country",title:"German election results announced",countries:["DE"],topics:["elections"]};
  expect(freshEditionArticles([previous,repeat,differentPlace,differentBoth],[previous.id],now).map(a=>a.id)).toEqual([differentBoth.id]);
  expect(freshEditionArticles([previous,repeat],[previous.id],now).map(a=>a.id)).toEqual([repeat.id]);
  expect(TELEGRAM_INTERVAL_MS).toBe(18_000_000);expect(X_NEWS_INTERVAL_MS).toBe(18_000_000);
  expect(articleCategory({title:"Iran and US agree a ceasefire",topics:["Iran"]})).toBe("ceasefires");
  expect(articleCategory({title:"Ground invasion begins",topics:[]})).toBe("invasions");
  expect(articleCategory({title:"Aid reaches displaced families",topics:[]})).toBe("humanitarian");
});

test("supervision stays quiet while healthy, recovers a stopped timer and never resends an ambiguous post",()=>{
  const now=Date.now();
  const rows:PublicationHealth[]=(Object.keys(PUBLICATION_JOBS) as PublicationJob[]).map(job=>({job,lastPublication:now-60_000,pending:false,timerActive:true,serviceRunning:false}));
  expect(publicationHealthPlan(rows,now)).toEqual({actions:[],incidents:[]});
  const x=rows.find(row=>row.job==="x")!;
  x.lastPublication=now-4*3_600_000;
  expect(publicationHealthPlan(rows,now)).toEqual({actions:[],incidents:[]});
  x.timerActive=false;x.lastPublication=now-6*3_600_000;
  expect(publicationHealthPlan(rows,now).actions).toEqual([{job:"x",action:"enable-timer"},{job:"x",action:"start-service"}]);
  x.pending=true;expect(publicationHealthPlan(rows,now).actions).toEqual([]);
  x.pending=false;x.serviceRunning=true;
  expect(publicationHealthPlan(rows,now).actions).toEqual([{job:"x",action:"enable-timer"}]);
  x.pausedUntil=now+60_000;expect(publicationHealthPlan(rows,now)).toEqual({actions:[],incidents:[]});
});

test("topic pages and localized RSS expose editorial categories and both Telegram channels",async({page,request})=>{
  await page.goto("/ru/news");
  const nav=page.getByRole("navigation",{name:"Категории новостей"});
  await expect(nav.getByRole("link",{name:"Удары",exact:true})).toHaveAttribute("href","/ru/news/topic/strikes");
  await expect(nav.getByRole("link",{name:"Все страны",exact:true})).toHaveCount(0);
  await expect(page.locator('footer a[href="https://t.me/oddsfront_ru"]')).toBeVisible();
  await page.goto("/news/topic/diplomacy");
  await expect(page.getByRole("heading",{level:1})).toHaveText("Diplomacy");
  const catalog=seed as NewsCatalog;const rss=newsRss(catalog,"ru");
  expect(rss).toContain("<language>ru</language>");expect(rss).toContain("/ru/news/rss.xml");
  expect(rss).toContain("media:content");expect(rss).toContain("<category>");
  for(const code of ["jm","ro","md","tg","ba","fi","ie","sg"]) {
    const flag=await request.get(`/flags/${code}.svg`);expect(flag.ok()).toBe(true);expect(await flag.text()).toContain("<svg");
  }
  const feed=await request.get("/ru/news/rss.xml");expect(feed.ok()).toBe(true);
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
});
