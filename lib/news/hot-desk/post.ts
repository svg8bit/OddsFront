import { ODDSFRONT_MINI_APP_BOT_USERNAME } from "../../telegram-app/init-data.ts";
import type { HotDeskMarket } from "./markets.ts";

export type HotDeskLocale = "en" | "ru";
export const HOT_DESK_CHANNELS = {
  en: { id: -1004406802006, username: "oddsfront" },
  ru: { id: -1004118165561, username: "oddsfront_ru" },
} as const;
/** @OddsFrontBot posts to both channels and hosts the one-tap bet Mini App. */
export const MINI_APP_BOT = ODDSFRONT_MINI_APP_BOT_USERNAME;
// Owner's topic map: wars and escalation, energy/Hormuz/shipping, Russia–Ukraine–NATO,
// China–Taiwan, sanctions and trade wars, big US politics. Elections: the US only.
export const HOT_DESK_CATEGORIES = ["war", "geopolitics", "energy", "trade", "us-politics", "us-elections", "world-politics"] as const;
export type HotDeskCategory = typeof HOT_DESK_CATEGORIES[number];

/** The writer's copy for one post, validated before it reaches a template. */
export type HotDeskCopy = {
  category: HotDeskCategory;
  titleEn: string;
  titleRu: string;
  /** 3–8 word picture headlines ("Odds of US ending Iran blockade fall to 12%"). */
  cardTitleEn: string;
  cardTitleRu: string;
  contextEn: string;
  contextRu: string;
  marketQuestionRu: string;
};

const LABELS: Record<HotDeskCategory, Record<HotDeskLocale, string>> = {
  war: { en: "Breaking · Conflict", ru: "Срочно · Конфликт" },
  geopolitics: { en: "Breaking · Geopolitics", ru: "Срочно · Геополитика" },
  energy: { en: "Breaking · Oil & shipping", ru: "Срочно · Нефть и судоходство" },
  trade: { en: "Breaking · Trade war", ru: "Срочно · Торговая война" },
  "us-politics": { en: "Breaking · US politics", ru: "Срочно · Политика США" },
  "us-elections": { en: "Breaking · US elections", ru: "Срочно · Выборы в США" },
  "world-politics": { en: "Breaking · Politics", ru: "Срочно · Политика" },
};

export function categoryLabel(category: HotDeskCategory, locale: HotDeskLocale) {
  return LABELS[category][locale];
}

/** The Mini App link a button opens: `m<market id>_<side>`, side 0 = Yes, 1 = No. */
export function miniAppBetUrl(marketId: string, side: 0 | 1) {
  if (!/^\d{1,12}$/.test(marketId)) throw new Error("Invalid market id for a Mini App link");
  return `https://t.me/${MINI_APP_BOT}?startapp=m${marketId}_${side}&mode=compact`;
}

/** 23% / 2.4% / 97.6%: whole percent from 10% to 90%, one decimal outside; Russian uses a decimal comma. */
export function formatPercent(price: number, locale: HotDeskLocale = "en") {
  const percent = price * 100;
  const decimals = percent < 9.95 || percent > 90.05 ? 1 : 0;
  const rounded = Number(percent.toFixed(decimals)).toString();
  return `${locale === "ru" ? rounded.replace(".", ",") : rounded}%`;
}

/**
 * A signed odds move shown in percent only ("▼ 1.3% in 24h"), never in points;
 * null under one percent. `span` picks the 24-hour or the 7-day wording.
 */
export function formatChange(change: number | null, locale: HotDeskLocale, span: "day" | "week" = "day") {
  if (change === null || !Number.isFinite(change)) return null;
  const percent = Math.abs(change * 100);
  if (percent < 1) return null;
  const value = Number(percent.toFixed(percent < 10 ? 1 : 0)).toString();
  const arrow = change > 0 ? "▲" : "▼";
  const suffix = locale === "ru" ? (span === "day" ? "за сутки" : "за неделю") : (span === "day" ? "in 24h" : "in 7 days");
  return `${arrow} ${locale === "ru" ? value.replace(".", ",") : value}% ${suffix}`;
}

/** The odds line under the card headline: the Yes chance and its most telling move. */
export function oddsLine(market: Pick<HotDeskMarket, "chance" | "dayChange" | "weekChange">, locale: HotDeskLocale) {
  const move = formatChange(market.dayChange, locale) ?? (market.weekChange !== null && Math.abs(market.weekChange) >= 0.03 ? formatChange(market.weekChange, locale, "week") : null);
  return `${locale === "ru" ? "Шанс «Да»" : "Yes chance"} ${formatPercent(market.chance, locale)}${move ? ` · ${move}` : ""}`;
}

export function betKeyboard(market: Pick<HotDeskMarket, "id" | "yesPrice" | "noPrice">, locale: HotDeskLocale) {
  const [yes, no] = locale === "ru" ? ["Да", "Нет"] : ["Yes", "No"];
  return {
    inline_keyboard: [[
      { text: `✅ ${yes} · ${formatPercent(market.yesPrice, locale)}`, url: miniAppBetUrl(market.id, 0) },
      { text: `❌ ${no} · ${formatPercent(market.noPrice, locale)}`, url: miniAppBetUrl(market.id, 1) },
    ]],
  };
}

export function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const CAPTION_LIMIT = 1024;

export function hotDeskCaption(copy: HotDeskCopy, market: Pick<HotDeskMarket, "question" | "chance" | "dayChange">, locale: HotDeskLocale, articleUrl: string | null = null) {
  const ru = locale === "ru";
  const title = escapeHtml(ru ? copy.titleRu : copy.titleEn);
  const change = formatChange(market.dayChange, locale);
  const odds = `${ru ? "Да" : "Yes"} — <b>${formatPercent(market.chance, locale)}</b>${change ? ` · ${change}` : ""}`;
  const caption = [
    // The headline opens the full OddsFront article when the site already carries the story.
    `⚡️ <b>${articleUrl ? `<a href="${escapeHtml(articleUrl)}">${title}</a>` : title}</b>`,
    escapeHtml(ru ? copy.contextRu : copy.contextEn),
    // The odds belong to the market's own question, labelled as such, never to the headline.
    `📊 <b>${ru ? "Рынок" : "Market"}:</b> ${escapeHtml(ru ? copy.marketQuestionRu : market.question)}\n${odds}`,
    ru ? "Сделать ставку прямо в Telegram 👇" : "Bet right in Telegram 👇",
  ].join("\n\n");
  // Telegram counts the visible text; markup tags are a safe upper bound.
  if (caption.length > CAPTION_LIMIT) throw new Error("Hot desk caption exceeds Telegram's limit");
  return caption;
}

const CYRILLIC = /[А-Яа-яЁё]/;

/** Reasons the writer's copy cannot be published (empty when it can). */
export function copyProblems(copy: Partial<Record<keyof HotDeskCopy, unknown>>): string[] {
  const problems: string[] = [];
  const field = (key: keyof HotDeskCopy, min: number, max: number, russian: boolean) => {
    const value = copy[key];
    if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) problems.push(`${key}: length ${typeof value === "string" ? value.trim().length : "missing"} outside ${min}–${max}`);
    else if (russian && !CYRILLIC.test(value)) problems.push(`${key}: not Russian`);
    else if (!russian && CYRILLIC.test(value)) problems.push(`${key}: not English`);
    else if (/https?:\/\/|<|>/.test(value)) problems.push(`${key}: contains links or markup`);
  };
  field("titleEn", 20, 120, false);
  field("titleRu", 20, 140, true);
  field("cardTitleEn", 12, 64, false);
  field("cardTitleRu", 12, 72, true);
  field("contextEn", 40, 260, false);
  field("contextRu", 40, 300, true);
  field("marketQuestionRu", 8, 200, true);
  if (!HOT_DESK_CATEGORIES.includes(copy.category as HotDeskCategory)) problems.push("category: unknown");
  return problems;
}
