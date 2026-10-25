import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";
import type { HotDeskMarket, PricePoint } from "./markets.ts";
import { captureMapShot, mapCardHtml, MAP_SCALE, MAP_VIEWPORT, type MapFocus, type MarketPlaque } from "./map-card.ts";
import { categoryLabel, escapeHtml, formatChange, formatPercent, type HotDeskCopy, type HotDeskLocale } from "./post.ts";

export const CARD_WIDTH = 1280;
export const CARD_HEIGHT = 720;
const MAX_IMAGE_BYTES = 3_000_000;

/** The market's own artwork as a small PNG data URI, or null when it cannot be fetched safely. */
export async function marketThumbnail(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type") || "";
    const size = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !type.startsWith("image/") || size > MAX_IMAGE_BYTES) { await response.body?.cancel(); return null; }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).resize(192, 192, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch { return null; }
}

/** SVG line chart of the Yes price; empty string without enough history. */
export function priceChartSvg(points: readonly PricePoint[], width = 376, height = 190): string {
  const series = points.toSorted((a, b) => a.t - b.t);
  if (series.length < 6) return "";
  const prices = series.map(point => point.p * 100);
  let low = Math.min(...prices); let high = Math.max(...prices);
  // A flat market must not look like a cliff: show at least four points of range.
  if (high - low < 4) { const middle = (high + low) / 2; low = middle - 2; high = middle + 2; }
  low = Math.max(0, low - (high - low) * 0.12); high = Math.min(100, high + (high - low) * 0.12);
  const start = series[0]!.t; const span = Math.max(1, series.at(-1)!.t - start);
  const top = 10; const bottom = height - 10;
  const xy = series.map((point, index) => [((point.t - start) / span) * width, bottom - ((prices[index]! - low) / (high - low)) * (bottom - top)] as const);
  const line = xy.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = xy.at(-1)!;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7778FF" stop-opacity="0.38"/><stop offset="1" stop-color="#7778FF" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map(share => `<line x1="0" x2="${width}" y1="${(top + (bottom - top) * share).toFixed(1)}" y2="${(top + (bottom - top) * share).toFixed(1)}" stroke="rgba(159,176,200,0.12)" stroke-width="1"/>`).join("")}
    <path d="${line} L${width} ${height} L0 ${height} Z" fill="url(#fill)"/>
    <path d="${line}" fill="none" stroke="#8b8cff" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="7" fill="#f8fafc" stroke="#6d6aff" stroke-width="4"/>
  </svg>`;
}

type CardFonts = { bold: string; variable: string };

export async function loadCardFonts(root = process.cwd()): Promise<CardFonts> {
  const [bold, variable] = await Promise.all([
    readFile(path.join(root, "public/fonts/inter-social-v1.ttf")),
    readFile(path.join(root, "public/fonts/inter-roman.var.woff2")),
  ]);
  return { bold: bold.toString("base64"), variable: variable.toString("base64") };
}

export type CardInput = { locale: HotDeskLocale; copy: HotDeskCopy; market: HotDeskMarket; history: readonly PricePoint[]; thumbnail: string | null };

/** The 24-hour move, or a notable weekly move on a quiet day, in percent. */
export function oddsMove(market: Pick<HotDeskMarket, "dayChange" | "weekChange">, locale: HotDeskLocale) {
  const day = formatChange(market.dayChange, locale);
  if (day) return { change: day, up: (market.dayChange ?? 0) > 0 };
  const week = market.weekChange !== null && Math.abs(market.weekChange) >= 0.03 ? formatChange(market.weekChange, locale, "week") : null;
  return { change: week, up: (market.weekChange ?? 0) > 0 };
}

export function cardHtml({ locale, copy, market, history, thumbnail }: CardInput, fonts: CardFonts) {
  const ru = locale === "ru";
  const { change, up } = oddsMove(market, locale);
  const prices = history.map(point => point.p);
  const range = prices.length >= 6 ? `${formatPercent(Math.min(...prices), locale)} – ${formatPercent(Math.max(...prices), locale)}` : "";
  const chart = priceChartSvg(history);
  const title = ru ? copy.cardTitleRu : copy.cardTitleEn;
  const question = ru ? copy.marketQuestionRu : market.question;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter Card"; src: url(data:font/woff2;base64,${fonts.variable}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Inter Card Bold"; src: url(data:font/ttf;base64,${fonts.bold}) format("truetype"); font-weight: 700; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; }
body { font-family: "Inter Card", sans-serif; color: #f8fafc; overflow: hidden;
  background: radial-gradient(900px 520px at 88% 30%, rgba(99,102,241,0.20), transparent 60%), radial-gradient(700px 420px at 0% 100%, rgba(85,72,255,0.10), transparent 60%), linear-gradient(160deg, #0d1528 0%, #070f1f 55%, #020a16 100%); }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(159,176,200,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(159,176,200,0.045) 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(90deg, rgba(0,0,0,0.9), rgba(0,0,0,0.25)); }
.frame { position: absolute; inset: 0; padding: 52px 60px 44px; display: flex; flex-direction: column; }
.top { display: flex; align-items: center; justify-content: space-between; height: 44px; }
.brand { display: flex; align-items: center; gap: 14px; font-family: "Inter Card Bold"; font-size: 26px; letter-spacing: -0.01em; }
.brand svg { width: 46px; height: 34px; }
.label { display: flex; align-items: center; gap: 10px; padding: 9px 18px 9px 14px; border-radius: 999px; background: rgba(239,68,68,0.14); border: 1px solid rgba(248,113,113,0.42); color: #fecaca; font-size: 19px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
.label i { width: 10px; height: 10px; border-radius: 50%; background: #f87171; box-shadow: 0 0 0 5px rgba(248,113,113,0.20); }
.main { flex: 1; display: flex; gap: 44px; margin-top: 34px; min-height: 0; }
.story { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.headline { font-family: "Inter Card Bold"; font-size: 58px; line-height: 1.08; letter-spacing: -0.025em; max-height: 330px; overflow: hidden; text-wrap: balance; }
.market { margin-top: auto; display: flex; align-items: center; gap: 20px; padding-top: 26px; border-top: 1px solid rgba(159,176,200,0.18); }
.market img { width: 76px; height: 76px; border-radius: 18px; object-fit: cover; flex: none; border: 1px solid rgba(255,255,255,0.10); }
.market-text { min-width: 0; }
.market-kicker { font-size: 17px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #8b8cff; margin-bottom: 6px; }
.question { font-size: 27px; line-height: 1.25; font-weight: 560; color: #dbe4f0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.question.long { font-size: 23px; }
.panel { width: 440px; flex: none; border-radius: 30px; padding: 30px 32px 26px; background: linear-gradient(180deg, rgba(23,32,56,0.92), rgba(12,19,36,0.92)); border: 1px solid rgba(139,140,255,0.22); box-shadow: 0 30px 80px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.06); display: flex; flex-direction: column; }
.panel-kicker { font-size: 18px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase; color: #9fb0c8; }
.odds { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin-top: 6px; }
.odds strong { font-family: "Inter Card Bold"; font-size: 112px; line-height: 1; letter-spacing: -0.045em; }
.badge { padding: 8px 14px; border-radius: 12px; font-size: 22px; font-weight: 700; white-space: nowrap; }
.badge.up { color: #86efac; background: rgba(34,197,94,0.14); border: 1px solid rgba(74,222,128,0.35); }
.badge.down { color: #fca5a5; background: rgba(239,68,68,0.14); border: 1px solid rgba(248,113,113,0.35); }
.chart { margin-top: auto; }
.chart-meta { display: flex; justify-content: space-between; font-size: 16px; color: #7f91ab; margin-top: 8px; letter-spacing: 0.02em; }
.chart-meta b { color: #c7d2e3; font-weight: 600; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: 26px; font-size: 21px; color: #9fb0c8; }
.foot b { color: #f8fafc; font-weight: 650; }
</style></head><body><div class="grid"></div><div class="frame">
  <div class="top">
    <div class="brand"><svg viewBox="0 0 300 224"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7778FF"/><stop offset="1" stop-color="#5548FF"/></linearGradient></defs><path d="M106 0H178L72 224H0Z M228 0H300L194 224H122Z" fill="url(#m)"/></svg>OddsFront</div>
    <div class="label"><i></i>${escapeHtml(categoryLabel(copy.category, locale))}</div>
  </div>
  <div class="main">
    <div class="story">
      <h1 class="headline" id="headline">${escapeHtml(title)}</h1>
      <div class="market">
        ${thumbnail ? `<img src="${thumbnail}" alt="">` : ""}
        <div class="market-text"><div class="market-kicker">${ru ? "Рынок прогнозов" : "Prediction market"}</div><div class="question${question.length > 64 ? " long" : ""}">${escapeHtml(question)}</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-kicker">${ru ? "Шанс «Да»" : "Yes chance"}</div>
      <div class="odds"><strong>${escapeHtml(formatPercent(market.chance, locale))}</strong>${change ? `<span class="badge ${up ? "up" : "down"}">${escapeHtml(change)}</span>` : ""}</div>
      ${chart ? `<div class="chart">${chart}<div class="chart-meta"><span>${ru ? "7 дней назад" : "7 days ago"}</span>${range ? `<span>${ru ? "диапазон" : "range"} <b>${escapeHtml(range)}</b></span>` : ""}<span>${ru ? "сейчас" : "now"}</span></div></div>` : ""}
    </div>
  </div>
  <div class="foot"><b>oddsfront.com</b><span>${ru ? "Новости через призму шансов" : "See the world through the odds"}</span></div>
</div>
</body></html>`;
}

async function fitHeadline(page: Page, from: number, to: number) {
  await page.evaluate(() => document.fonts.ready);
  // Shrink the headline until it fits its block (after the web fonts load).
  // Glyph overhang makes scrollHeight exceed the box by a few pixels even when it fits.
  const fits = await page.evaluate(([start, end]) => {
    const headline = document.getElementById("headline")!;
    const limit = Number.parseFloat(getComputedStyle(headline).maxHeight) + 6;
    let size = start;
    while (headline.scrollHeight > limit && size > end) { size -= 2; headline.style.fontSize = `${size}px`; }
    return headline.scrollHeight <= limit;
  }, [from, to]);
  if (!fits) throw new Error("Hot desk headline does not fit the card");
}

export type PostCardInput = CardInput & { focus: MapFocus | null };

function compactUsd(value: number) {
  if (value >= 1_000_000) return `$${(Math.round(value / 100_000) / 10).toString()}M`;
  if (value >= 1_000) return `$${(Math.round(value / 100) / 10).toString()}K`;
  return `$${Math.round(value)}`;
}

/** The post's own market as the map-style plaque: same question and numbers as the caption. */
export function marketPlaque({ locale, copy, market, thumbnail }: CardInput): MarketPlaque {
  const ru = locale === "ru";
  const move = oddsMove(market, locale);
  return {
    label: "Polymarket",
    question: ru ? copy.marketQuestionRu : market.question,
    yesLabel: ru ? "ДА" : "YES",
    noLabel: ru ? "НЕТ" : "NO",
    yes: formatPercent(market.chance, locale),
    no: formatPercent(1 - market.chance, locale),
    change: move.change,
    up: move.up,
    volume: ru ? `Объём ${compactUsd(market.volume)}` : `${compactUsd(market.volume)} Vol`,
    thumbnail,
  };
}
export type PostCard = { png: Buffer; style: "map" | "classic"; mapFocus: MapFocus["kind"] | null; popupOpen: boolean; fallbackReason: string | null };

/**
 * Both locale cards in one browser: the live-map card when the map can frame
 * the story, otherwise (or on any map failure) the classic card. Never throws
 * for a map problem; the post is not blocked by the picture.
 */
export async function renderCards(inputs: readonly PostCardInput[], root = process.cwd(), siteUrl?: string): Promise<PostCard[]> {
  const { chromium } = await import("@playwright/test");
  const fonts = await loadCardFonts(root);
  const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const compose = async (html: string, width: number, height: number, scale: number, headline: [number, number]) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    try {
      // Cards are self-contained: block every network request from the template.
      await page.route("**/*", route => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
      await page.setContent(html, { waitUntil: "load" });
      await fitHeadline(page, ...headline);
      return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    } finally {
      await page.close();
    }
  };
  try {
    const cards: PostCard[] = [];
    // Both locales share one English map shot of the same focus.
    const shots = new Map<string, Awaited<ReturnType<typeof captureMapShot>>>();
    for (const input of inputs) {
      let fallbackReason = input.focus ? null : "no related marker or country on the map";
      if (input.focus) {
        try {
          const key = JSON.stringify(input.focus);
          const map = shots.get(key) ?? await captureMapShot(browser, input.focus, siteUrl);
          shots.set(key, map);
          const html = mapCardHtml({ locale: input.locale, title: input.locale === "ru" ? input.copy.cardTitleRu : input.copy.cardTitleEn, map, plaque: marketPlaque(input) }, fonts);
          cards.push({ png: await compose(html, MAP_VIEWPORT.width, MAP_VIEWPORT.height, MAP_SCALE, [62, 40]), style: "map", mapFocus: input.focus.kind, popupOpen: map.popupOpen, fallbackReason: null });
          continue;
        } catch (error) {
          fallbackReason = error instanceof Error ? error.message.slice(0, 200) : "map capture failed";
        }
      }
      cards.push({ png: await compose(cardHtml(input, fonts), CARD_WIDTH, CARD_HEIGHT, 1, [58, 36]), style: "classic", mapFocus: null, popupOpen: false, fallbackReason });
    }
    return cards;
  } finally {
    await browser.close();
  }
}
