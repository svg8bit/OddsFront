import type { Metadata } from "next";
import { ODDSFRONT_URL } from "@/lib/oddsfront-site";
import { articleText, countryName } from "./locale.ts";
import { message } from "./messages.ts";
import { articleLocales, languageAlternates, newsArticlePath, newsCountryPath, newsPath } from "./routing.ts";
import type { Locale, NewsArticle } from "./types.ts";

const OPEN_GRAPH_LOCALES: Record<Locale, string> = {
  en: "en_US", zh: "zh_CN", ko: "ko_KR", vi: "vi_VN", de: "de_DE", es: "es_ES",
  "pt-BR": "pt_BR", fr: "fr_FR", ru: "ru_RU", uk: "uk_UA", fa: "fa_IR", he: "he_IL",
};

export function newsMetadata(locale: Locale, country?: string): Metadata {
  const englishPath = country ? `/news/${country}` : "/news";
  const canonical = country ? newsCountryPath(country, locale) : newsPath(locale);
  const label = !country || country === "world" ? message(locale, "latest") : countryName(country.toUpperCase(), locale);
  const title = `${label} — ${message(locale, "news")} | OddsFront`;
  const description = message(locale, "description");
  return {
    title, description,
    alternates: { canonical, languages: languageAlternates(englishPath), ...(country ? {} : { types: { "application/rss+xml": "/news/rss.xml" } }) },
    openGraph: { title, description, type: "website", url: canonical, locale: OPEN_GRAPH_LOCALES[locale], siteName: "OddsFront" },
    twitter: { card: "summary_large_image", title, description },
    other: { "content-language": locale },
  };
}

export function articleMetadata(article: NewsArticle, locale: Locale): Metadata {
  const text = articleText(article, locale);
  const canonical = newsArticlePath(article, locale);
  const locales = articleLocales(article);
  const image = `/social/news/${locale.toLowerCase()}/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`;
  return {
    title: `${text.title} | OddsFront`, description: text.description,
    alternates: { canonical, languages: languageAlternates(newsArticlePath(article, "en"), locales) },
    openGraph: {
      type: "article", title: text.title, description: text.description, publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt, url: canonical, locale: OPEN_GRAPH_LOCALES[locale],
      alternateLocale: locales.filter((candidate) => candidate !== locale).map((candidate) => OPEN_GRAPH_LOCALES[candidate]),
      siteName: "OddsFront", images: [{ url: image, width: 1200, height: 630, alt: text.title, type: "image/png" }],
    },
    twitter: { card: "summary_large_image", title: text.title, description: text.description, images: [{ url: image, alt: text.title }] },
    other: { "content-language": locale },
  };
}

export function articleStructuredData(article: NewsArticle, locale: Locale) {
  const text = articleText(article, locale);
  const canonical = `${ODDSFRONT_URL}${newsArticlePath(article, locale)}`;
  const image = `${ODDSFRONT_URL}/social/news/${locale.toLowerCase()}/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`;
  return {
    "@context": "https://schema.org", "@type": "NewsArticle", headline: text.title, description: text.description,
    image: [image], datePublished: article.publishedAt, dateModified: article.updatedAt, inLanguage: locale,
    isAccessibleForFree: true,
    author: { "@type": "Organization", name: article.author, url: `${ODDSFRONT_URL}/news` },
    publisher: { "@type": "Organization", name: "OddsFront", url: ODDSFRONT_URL, logo: { "@type": "ImageObject", url: `${ODDSFRONT_URL}/brand/oddsfront-app-512-v1.png`, width: 512, height: 512 } },
    mainEntityOfPage: canonical, citation: article.sources.map((source) => source.url),
  };
}
