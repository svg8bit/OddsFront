import { expect, test } from "@playwright/test";
import seed from "../lib/news/catalog.seed.json";
import { LOCALES } from "../lib/news/types";

test("news remains lightweight and preserves language and region selection",async({page})=>{
  const requests:string[]=[];page.on("request",request=>requests.push(request.url()));
  await page.goto("/news");await expect(page.getByRole("heading",{level:1})).toBeVisible();
  await page.getByRole("button",{name:"Language and region",exact:true}).click();
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang","ru");
  await page.getByRole("combobox",{name:"Регион",exact:true}).selectOption("UA");
  await page.keyboard.press("Escape");await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang","ru");await expect(page.getByRole("heading",{name:"Украина",exact:true})).toBeVisible();
  expect(requests.filter(url=>/maplibre|\.pbf|\.mjs/.test(url))).toEqual([]);
});

test("all article languages, source links, mobile and RTL layouts remain readable",async({browser})=>{
  const article=seed.articles[0];const path=`/news/${article.countries[0].toLowerCase()}/${article.slug}`;
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    for(const language of LOCALES){
      await page.goto(`${path}?lang=${language}`);await expect(page.locator("html")).toHaveAttribute("lang",language);
      await expect(page.locator("html")).toHaveAttribute("dir",language==="fa"||language==="he"?"rtl":"ltr");
      await expect(page.locator("article h1")).not.toBeEmpty();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(language!=="en")await expect(page.locator(`a[href="${path}?lang=en"]`)).toBeVisible();
    }
    for(const source of article.sources)expect(await page.locator(`a[href="${source.url}"]`).count()).toBe(1);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});

test("news keeps a newer edition when a refresh returns older data",async({page})=>{
  await page.route("**/api/news",route=>route.fulfill({json:{updatedAt:"2000-01-01T00:00:00Z",articles:[]}}));
  await page.goto("/news/world");await expect(page.getByRole("heading",{name:seed.articles[0].title,exact:true}).first()).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading",{name:seed.articles[0].title,exact:true}).first()).toBeVisible();
});

test("Persian map loads RTL shaping and glyphs under the production content policy",async({page})=>{
  const glyphResponses:number[]=[];page.on("response",response=>{if(response.url().includes("fonts/unicode-v1/"))glyphResponses.push(response.status());});
  await page.goto("/?lang=fa");await expect(page.locator('[data-map-ready="true"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>{const path="/vendor/maplibre/6.1.0/maplibre-gl.mjs";const maplibre=await import(path);return maplibre.getRTLTextPluginStatus();})).toBe("loaded");
  await expect.poll(()=>glyphResponses.length).toBeGreaterThan(0);expect(glyphResponses.every(status=>status===200)).toBe(true);
});
