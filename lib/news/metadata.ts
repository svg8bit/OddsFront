import type { Metadata } from "next";
import { ODDSFRONT_URL, SOCIAL_PREVIEW_PATH } from "@/lib/oddsfront-site";
import { articleText, countryName } from "./locale.ts";
import { message } from "./messages.ts";
import { articleLocales, languageAlternates, newsArticlePath, newsCountryPath, newsPath, newsTopicPath } from "./routing.ts";
import { articleCategory, categoryLabel, type NewsCategory } from "./categories.ts";
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
    alternates: { canonical, languages: languageAlternates(englishPath), ...(country ? {} : { types: { "application/rss+xml": newsPath(locale,"/rss.xml") } }) },
    openGraph: {
      title, description, type: "website", url: canonical, locale: OPEN_GRAPH_LOCALES[locale], siteName: "OddsFront",
      images: [{ url: SOCIAL_PREVIEW_PATH, width: 1200, height: 630, alt: "OddsFront", type: "image/png" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [{ url: SOCIAL_PREVIEW_PATH, alt: "OddsFront" }] },
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
    isAccessibleForFree: true, articleSection: categoryLabel(articleCategory(article),locale), keywords: article.topics.join(", "),
    author: { "@type": "Organization", name: article.author, url: `${ODDSFRONT_URL}/news` },
    publisher: { "@type": "Organization", name: "OddsFront", url: ODDSFRONT_URL, sameAs: ["https://t.me/oddsfront","https://t.me/oddsfront_ru"], logo: { "@type": "ImageObject", url: `${ODDSFRONT_URL}/brand/oddsfront-app-512-v1.png`, width: 512, height: 512 } },
    mainEntityOfPage: canonical, citation: article.sources.map((source) => source.url),
  };
}

export function topicMetadata(topic: NewsCategory, locale: Locale): Metadata {
  const base = newsMetadata(locale);
  const label = categoryLabel(topic,locale);
  const title = `${label} — ${message(locale,"news")} | OddsFront`;
  const description = `${label}. ${message(locale,"description")}`;
  const canonical = newsTopicPath(topic,locale);
  return { ...base, title, description, alternates: { canonical, languages: languageAlternates(newsTopicPath(topic,"en")) },
    openGraph: { ...base.openGraph, title, description, url:canonical }, twitter: { ...base.twitter, title, description } };
}

export function topicStructuredData(topic: NewsCategory, locale: Locale, articles: NewsArticle[]) {
  const url = `${ODDSFRONT_URL}${newsTopicPath(topic,locale)}`;
  return { "@context":"https://schema.org", "@type":"CollectionPage", name:categoryLabel(topic,locale), url, inLanguage:locale,
    isPartOf:{ "@type":"WebSite", name:"OddsFront", url:ODDSFRONT_URL },
    mainEntity:{ "@type":"ItemList", itemListElement:articles.filter(article=>articleCategory(article)===topic).slice(0,20).map((article,index)=>({ "@type":"ListItem", position:index+1, url:`${ODDSFRONT_URL}${newsArticlePath(article,locale === "en" || article.translations[locale] ? locale : "en")}`, name:articleText(article,locale).title })) } };
}
