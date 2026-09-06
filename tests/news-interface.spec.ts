import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import seed from "../lib/news/catalog.seed.json";
import { LOCALES } from "../lib/news/types";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { newsArticlePath } from "../lib/news/routing";
import { PNG } from "pngjs";

test("news remains lightweight and preserves language and region selection",async({page})=>{
  const requests:string[]=[];page.on("request",request=>requests.push(request.url()));
  await page.goto("/news");await expect(page.getByRole("heading",{level:1})).toBeVisible();
  await page.getByRole("button",{name:"Language and region",exact:true}).click();
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang","ru");
  await expect(page).toHaveURL(/\/ru\/news$/);
  await page.getByRole("button",{name:"Язык и регион",exact:true}).click();
  await page.getByRole("combobox",{name:"Регион",exact:true}).selectOption("UA");
  await page.keyboard.press("Escape");await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang","ru");await expect(page.getByRole("heading",{name:"Украина",exact:true})).toBeVisible();
  expect(requests.filter(url=>/maplibre|\.pbf|\.mjs/.test(url))).toEqual([]);
});

test("switching a directly loaded localized page updates its server route",async({page})=>{
  await page.goto("/ru/news");
  await page.getByRole("button",{name:"Язык и регион",exact:true}).click();
  await page.getByRole("combobox",{name:"Язык",exact:true}).selectOption("de");
  await expect(page).toHaveURL(/\/de\/news$/);
  await expect(page.locator("html")).toHaveAttribute("lang","de");
});

test("all localized article paths, branded covers, mobile and RTL layouts remain readable",async({browser})=>{
  const article=seed.articles[0];const path=`/news/${article.countries[0].toLowerCase()}/${article.slug}`;
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    for(const language of LOCALES){
      const localizedPath=newsArticlePath(article,language);
      await page.goto(localizedPath);await expect(page.locator("html")).toHaveAttribute("lang",language);
      await expect(page.locator("html")).toHaveAttribute("dir",language==="fa"||language==="he"?"rtl":"ltr");
      await expect(page.locator("article h1")).not.toBeEmpty();
      const expectedTitle=language==="en"?article.title:article.translations[language].title;
      await expect(page.locator("article h1")).toHaveText(expectedTitle);
      await expect(page.locator("article").getByText("OddsFront",{exact:true}).first()).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(language!=="en")await expect(page.locator(`a[href="${path}"]`)).toBeVisible();
    }
    for(const source of article.sources)expect(await page.locator(`a[href="${source.url}"]`).count()).toBe(0);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test("news keeps a newer edition when a refresh returns older data",async({page})=>{
  await page.route("**/api/news",route=>route.fulfill({json:{updatedAt:"2000-01-01T00:00:00Z",articles:[]}}));
  await page.goto("/news/world");await expect(page.getByRole("heading",{name:seed.articles[0].title,exact:true}).first()).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading",{name:seed.articles[0].title,exact:true}).first()).toBeVisible();
});

test("localized articles expose reciprocal search metadata and a branded 1200x630 social image",async({request})=>{
  const article=seed.articles[0];
  const path=newsArticlePath(article,"ru");
  const response=await request.get(path);
  expect(response.ok()).toBe(true);
  const html=await response.text();
  expect(html).toMatch(/<html[^>]+lang="ru"[^>]+dir="ltr"/);
  expect(html).toContain(`rel="canonical" href="https://oddsfront.com${path}"`);
  for(const language of [...LOCALES,"x-default"])expect(html).toContain(`hrefLang="${language}"`);
  const imagePath=html.match(/<meta property="og:image" content="https:\/\/oddsfront\.com([^\"]+)/)?.[1]?.replaceAll("&amp;","&");
  expect(imagePath).toBeTruthy();
  const imageResponse=await request.get(imagePath!);
  expect(imageResponse.ok()).toBe(true);
  const russianImage=await imageResponse.body();
  const image=PNG.sync.read(russianImage);
  expect({width:image.width,height:image.height}).toEqual({width:1200,height:630});
  const localizedHashes=[createHash("sha256").update(russianImage).digest("hex")];
  for(const locale of ["zh","ko","fa","he"] as const){
    const localizedResponse=await request.get(`/social/news/${locale}/${article.slug}`);
    expect(localizedResponse.ok()).toBe(true);
    const body=await localizedResponse.body();
    const localizedImage=PNG.sync.read(body);
    expect({width:localizedImage.width,height:localizedImage.height}).toEqual({width:1200,height:630});
    localizedHashes.push(createHash("sha256").update(body).digest("hex"));
  }
  expect(new Set(localizedHashes).size).toBe(localizedHashes.length);
  const persian=await (await request.get(newsArticlePath(article,"fa"))).text();
  expect(persian).toMatch(/<html[^>]+lang="fa"[^>]+dir="rtl"/);
  const robots=await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://oddsfront.com/news-sitemap.xml");
  const sitemapIndex=await (await request.get("/sitemap.xml")).text();
  expect(sitemapIndex).toContain("https://oddsfront.com/sitemaps/articles-1.xml");
  const sitemap=await (await request.get("/sitemaps/articles-1.xml")).text();
  expect(sitemap).toContain(`hreflang="ru" href="https://oddsfront.com${path}"`);
});

test("Persian map loads RTL shaping and glyphs under the production content policy",async({page})=>{
  const glyphResponses:number[]=[];page.on("response",response=>{if(response.url().includes("fonts/unicode-v1/"))glyphResponses.push(response.status());});
  await page.goto("/?lang=fa");await expect(page.locator('[data-map-ready="true"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>{const path="/vendor/maplibre/6.1.0/maplibre-gl.mjs";const maplibre=await import(path);return maplibre.getRTLTextPluginStatus();})).toBe("loaded");
  await expect.poll(()=>glyphResponses.length).toBeGreaterThan(0);expect(glyphResponses.every(status=>status===200)).toBe(true);
});

test("a strict fresh news match renders a blue 15-minute alert and popup-safe controls",async({page})=>{
  const now=Date.now();
  const base=getConflictPreviewFixtureFeed();
  const event={...base.events[0]!,id:"polymarket-100",title:"Will the United States strike Iran by September 30?",countryCodes:["US","IR"],dataOrigin:"polymarket" as const,marketUrl:"https://polymarket.com/event/united-states-strike-iran",imageUrl:"https://polymarket-upload.s3.us-east-2.amazonaws.com/development-fixture.png",volume:2_000_000,marketVolume:2_000_000,volume24h:250_000,endDate:new Date(now+86_400_000).toISOString(),updatedAt:new Date(now).toISOString(),marketConditionId:`0x${"1".padStart(64,"0")}`,priceChange7d:.12};
  const feed={...base,dataMode:"live" as const,updatedAt:new Date(now+30_000).toISOString(),events:[event]};
  const article={...seed.articles[0],id:"news-alert-fixture",slug:"united-states-strikes-iran",title:"United States strikes Iran after attacks begin overnight",description:"American forces attacked Iranian military sites, according to official and independent reporting.",countries:["US","IR"],publishedAt:new Date(now-1_000).toISOString(),updatedAt:new Date(now-1_000).toISOString(),translations:{},alert:{kind:"strike" as const,actorCountries:["US"],targetCountries:["IR"]}};
  await page.route("https://tiles.openfreemap.org/planet/**",route=>route.fulfill({status:200,contentType:"application/x-protobuf",body:Buffer.alloc(0)}));
  await page.route("**/api/global-conflict-events",route=>route.fulfill({json:feed}));
  await page.route("**/api/news",route=>route.fulfill({json:{updatedAt:new Date(now).toISOString(),articles:[article]}}));
  await page.route("**/_next/image**",route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")}));
  await page.goto("/global-conflict-map-preview");
  const alert=page.locator('[data-activity-kind="news"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("News");
  await expect(alert).toContainText(article.title);
  await expect(alert.locator("[data-activity-metric]")).toHaveCount(0);
  await expect(alert).not.toContainText(/YES\s+\d+%|Odds/i);
  await expect(alert.locator("[data-activity-actions] a")).toHaveCount(2);
  const expiresAt=Date.parse(await alert.getAttribute("data-expires-at")??"");
  expect(expiresAt-Date.parse(article.publishedAt)).toBe(15*60_000);

  const navigation=page.getByRole("navigation",{name:"Language and region"});
  await expect(navigation).toBeVisible();
  await page.locator(`[data-market-event-id="${event.id}"]`).click();
  const popup=page.getByTestId("conflict-popup");
  await expect(popup).toBeVisible();
  await expect(navigation).toHaveCount(0);
  await expect(popup.locator("[data-market-image]")).toBeVisible();
  await expect(popup.getByTestId("popup-weekly-change")).toContainText("7D");
  await expect(popup.getByTestId("popup-weekly-change")).not.toContainText(/Odds change/i);

  await popup.getByRole("button",{name:"Close"}).click();
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button",{name:"Language and region",exact:true}).click();
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang","ru");
  await page.keyboard.press("Escape");
  await expect(alert.locator("[data-activity-actions]")).toContainText("DropsBot");
  await expect(alert.locator("[data-activity-actions]")).toContainText("Market");
  const footerLayout=await alert.locator("[data-activity-footer]").evaluate(footer=>{
    const actions=footer.querySelector<HTMLElement>("[data-activity-actions]");
    const footerRect=footer.getBoundingClientRect();
    const actionsRect=actions?.getBoundingClientRect();
    return {flexWrap:getComputedStyle(footer).flexWrap,footerRight:footerRect.right,actionsRight:actionsRect?.right??Infinity};
  });
  expect(footerLayout.flexWrap).toBe("nowrap");
  expect(footerLayout.actionsRight).toBeLessThanOrEqual(footerLayout.footerRight+1);
});
