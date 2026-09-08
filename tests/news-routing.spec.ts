import { expect, test } from "@playwright/test";
import seed from "../lib/news/catalog.seed.json";
import { languageAlternates, newsArticlePath, switchNewsLocalePath } from "../lib/news/routing";

const article = seed.articles[0];
const country = article.countries[0].toLowerCase();

test("article paths contain one explicit language and no country segment", () => {
  const russian = { ...article, countries: ["RU"] };
  expect(newsArticlePath(russian, "en")).toBe(`/en/news/${article.slug}`);
  expect(newsArticlePath(russian, "ru")).toBe(`/ru/news/${article.slug}`);
  expect(switchNewsLocalePath(`/ru/news/${article.slug}`, "en")).toBe(`/en/news/${article.slug}`);
  expect(switchNewsLocalePath(`/news/ru/${article.slug}`, "ru")).toBe(`/ru/news/${article.slug}`);
  expect(switchNewsLocalePath("/ru/news/topic/strikes", "en")).toBe("/news/topic/strikes");
  const alternates = languageAlternates(newsArticlePath(russian, "en"), ["en", "ru"]);
  expect(alternates).toEqual({ en: `/en/news/${article.slug}`, ru: `/ru/news/${article.slug}`, "x-default": `/en/news/${article.slug}` });
});

test("legacy country article URLs redirect once to the correct language and preserve missing-article guards", async ({ request }) => {
  for (const [oldPath, target] of [
    [`/news/${country}/${article.slug}`, `/en/news/${article.slug}`],
    [`/news/ru/${article.slug}`, `/en/news/${article.slug}`],
    [`/news/${country}/${article.slug}?lang=ru`, `/ru/news/${article.slug}`],
    [`/ru/news/${country}/${article.slug}`, `/ru/news/${article.slug}`],
    [`/ru/news/ru/${article.slug}`, `/ru/news/${article.slug}`],
    [`/news/${article.slug}`, `/en/news/${article.slug}`],
  ]) {
    const response = await request.get(oldPath, { maxRedirects: 0 });
    expect(response.status(), oldPath).toBe(308);
    expect(response.headers().location).toBe(target);
    expect((await request.get(target, { maxRedirects: 0 })).status()).toBe(200);
  }
  for (const path of ["/en/news/nonexistent-development-story", "/ru/news/nonexistent-development-story", "/news/ru/nonexistent-development-story"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});

test("canonical article language switch preserves the slug and localized metadata", async ({ page }) => {
  await page.goto(newsArticlePath(article, "ru"));
  await page.getByRole("button", { name: "Язык", exact: true }).click();
  await page.getByRole("combobox", { name: "Язык", exact: true }).selectOption("en");
  await expect(page).toHaveURL(new RegExp(`/en/news/${article.slug}$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://oddsfront.com/en/news/${article.slug}`);
  await expect(page.locator('link[hreflang="ru"]')).toHaveAttribute("href", `https://oddsfront.com/ru/news/${article.slug}`);
});
