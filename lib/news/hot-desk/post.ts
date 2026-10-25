import type { HotDeskMarket } from "./markets.ts";

export type HotDeskLocale = "en" | "ru";
export const HOT_DESK_CHANNELS = {
  en: { id: -1004406802006, username: "oddsfront" },
  ru: { id: -1004118165561, username: "oddsfront_ru" },
} as const;
export const MINI_APP_BOT = "DropsAnalyticsAIbot";
export const HOT_DESK_CATEGORIES = ["war", "geopolitics", "us-politics", "world-politics", "elections", "economy"] as const;
export type HotDeskCategory = typeof HOT_DESK_CATEGORIES[number];

/** The writer's copy for one post, validated before it reaches a template. */
export type HotDeskCopy = {
  category: HotDeskCategory;
  titleEn: string;
  titleRu: string;
  contextEn: string;
  contextRu: string;
  marketQuestionRu: string;
};

const LABELS: Record<HotDeskCategory, Record<HotDeskLocale, string>> = {
  war: { en: "Breaking · Conflict", ru: "Срочно · Конфликт" },
  geopolitics: { en: "Breaking · Geopolitics", ru: "Срочно · Геополитика" },
  "us-politics": { en: "Breaking · US politics", ru: "Срочно · Политика США" },
  "world-politics": { en: "Breaking · Politics", ru: "Срочно · Политика" },
  elections: { en: "Breaking · Elections", ru: "Срочно · Выборы" },
  economy: { en: "Breaking · Economy", ru: "Срочно · Экономика" },
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

/** Signed 24-hour move in percentage points, or null under one point. */
export function formatChange(change: number | null, locale: HotDeskLocale) {
  if (change === null || !Number.isFinite(change)) return null;
  const points = Math.round(change * 100);
  if (Math.abs(points) < 1) return null;
  return locale === "ru" ? `${points > 0 ? "▲ +" : "▼ −"}${Math.abs(points)} п.п. за сутки` : `${points > 0 ? "▲ +" : "▼ −"}${Math.abs(points)} pp in 24h`;
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

export function hotDeskCaption(copy: HotDeskCopy, market: Pick<HotDeskMarket, "question" | "chance" | "dayChange">, locale: HotDeskLocale) {
  const ru = locale === "ru";
  const change = formatChange(market.dayChange, locale);
  const odds = `${ru ? "Да" : "Yes"} — <b>${formatPercent(market.chance, locale)}</b>${change ? ` · ${change}` : ""}`;
  const caption = [
    `⚡️ <b>${escapeHtml(ru ? copy.titleRu : copy.titleEn)}</b>`,
    escapeHtml(ru ? copy.contextRu : copy.contextEn),
    `📊 ${escapeHtml(ru ? copy.marketQuestionRu : market.question)}\n${odds}`,
    ru ? "Ставка в один тап 👇" : "One-tap bet 👇",
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
  field("contextEn", 40, 260, false);
  field("contextRu", 40, 300, true);
  field("marketQuestionRu", 8, 200, true);
  if (!HOT_DESK_CATEGORIES.includes(copy.category as HotDeskCategory)) problems.push("category: unknown");
  return problems;
}
