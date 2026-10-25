import type { BinaryMarket } from "./markets.ts";
import type { Bet } from "./positions.ts";

/**
 * Russian wording of Polymarket questions for the Mini App. A VPS job translates each new English
 * string once (scripts/news/market-translations.ts) and the feed serves the whole map; the site never
 * calls a model. Unknown strings simply stay English.
 */

export type Translations = Record<string, string>;

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: Translations } | null = null;

export function translationsUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  url.pathname = "/v1/market-translations";
  url.search = "";
  url.hash = "";
  return url;
}

/** The current EN → RU map (empty when the feed is not configured or unreachable). */
export async function marketTranslations(env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch): Promise<Translations> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const url = env.ODDSFRONT_MARKET_FEED_URL ? translationsUrl(env.ODDSFRONT_MARKET_FEED_URL) : null;
  const token = env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (!url || !token) return {};
  try {
    const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_500) });
    const body = response.ok ? await response.json() as { ru?: unknown } : null;
    const ru = body?.ru && typeof body.ru === "object" ? body.ru as Record<string, unknown> : {};
    const value = Object.fromEntries(Object.entries(ru).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // Keep the last good map through a feed hiccup; English is the fallback.
    return cached?.value ?? {};
  }
}

export function localizeMarket(market: BinaryMarket, ru: Translations): BinaryMarket {
  const questionRu = ru[market.question];
  const eventTitleRu = market.eventTitle ? ru[market.eventTitle] : undefined;
  return { ...market, ...(questionRu ? { questionRu } : {}), ...(eventTitleRu ? { eventTitleRu } : {}) };
}

export function localizeBet(bet: Bet, ru: Translations): Bet {
  const titleRu = ru[bet.title];
  return titleRu ? { ...bet, titleRu } : bet;
}
