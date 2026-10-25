import { electionMarket, foreignElectionMarket } from "../news/hot-desk/markets.ts";

/**
 * Polymarket Yes/No markets as the Mini App trades them, parsed from the public Gamma API. A channel
 * button opens one market by its Gamma id (`m<id>_<side>`); the Рынки tab lists the hottest
 * geopolitics and politics markets.
 */

export type MarketOutcome = {
  /** CLOB token id of the outcome. */
  assetId: string;
  /** Last mid/displayed price (0–1). */
  price: number;
  /** What one share costs right now (best ask for Yes, 1 − best bid for No), when known. */
  buyPrice: number | null;
};

export type BinaryMarket = {
  id: string;
  question: string;
  slug: string;
  eventTitle: string | null;
  eventSlug: string | null;
  conditionId: string;
  negRisk: boolean;
  image: string | null;
  endDate: string | null;
  yes: MarketOutcome;
  no: MarketOutcome;
  /** Yes price change over 24 h and 7 days, in price units (0.05 = +5%). */
  change24h: number | null;
  change7d: number | null;
  /** Russian wording of the question and event title, from the server's translation cache. */
  questionRu?: string;
  eventTitleRu?: string;
  /** Set on map alerts: the move that put this market on the OddsFront map's activity rail. */
  alert?: { window: "24h" | "7d"; change: number };
  volume: number;
  volume24h: number;
  /** Open, matching orders and not already decided at 99.5/0.5. */
  open: boolean;
};

export type StartParam = { marketId: string; side: 0 | 1 };

/** `m<gamma market id>_<side>`; side 0 = Yes, 1 = No. Telegram passes `startapp` as A–Z a–z 0–9 _ -. */
export function parseStartParam(raw: unknown): StartParam | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^m(\d{1,12})_([01])$/);
  return match ? { marketId: match[1], side: Number(match[2]) as 0 | 1 } : null;
}

export function startParamFor(marketId: string, side: 0 | 1) {
  return `m${marketId}_${side}`;
}

type Raw = Record<string, unknown>;

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const price = (value: number | null) => (value !== null && value > 0 && value < 1 ? value : null);
const httpsUrl = (value: unknown) => (typeof value === "string" && value.startsWith("https://") ? value : null);

/** One Gamma market as a Yes/No market, or null when it is not a tradable two-outcome Yes/No market. */
export function parseGammaMarket(raw: unknown, event?: Raw | null): BinaryMarket | null {
  if (!raw || typeof raw !== "object") return null;
  const market = raw as Raw;
  const outcomes = list(market.outcomes).map((value) => String(value).trim().toLowerCase());
  const tokens = list(market.clobTokenIds).map((value) => String(value).trim());
  const prices = list(market.outcomePrices).map(num);
  if (outcomes.length !== 2 || outcomes[0] !== "yes" || outcomes[1] !== "no") return null;
  if (tokens.length !== 2 || !tokens.every((token) => /^\d{10,100}$/.test(token))) return null;
  const id = String(market.id ?? "").trim();
  const conditionId = text(market.conditionId);
  const question = text(market.question);
  if (!/^\d{1,12}$/.test(id) || !/^0x[0-9a-fA-F]{64}$/.test(conditionId) || !question) return null;

  const yesPrice = prices[0] ?? null;
  const noPrice = prices[1] ?? (yesPrice !== null ? 1 - yesPrice : null);
  if (yesPrice === null || noPrice === null) return null;
  const bestAsk = price(num(market.bestAsk));
  const bestBid = price(num(market.bestBid));
  const events = Array.isArray(market.events) ? (market.events as Raw[]) : [];
  const parent = event ?? events[0] ?? null;
  const decided = yesPrice >= 0.995 || yesPrice <= 0.005;
  const endDate = text(market.endDate) || null;
  return {
    id,
    question,
    slug: text(market.slug),
    eventTitle: parent ? text(parent.title) || null : null,
    eventSlug: parent ? text(parent.slug) || null : null,
    conditionId,
    negRisk: market.negRisk === true,
    image: httpsUrl(market.image) || httpsUrl(market.icon) || (parent ? httpsUrl(parent.image) : null),
    endDate,
    yes: { assetId: tokens[0], price: yesPrice, buyPrice: bestAsk },
    no: { assetId: tokens[1], price: noPrice, buyPrice: bestBid !== null ? Math.round((1 - bestBid) * 10_000) / 10_000 : null },
    change24h: num(market.oneDayPriceChange),
    change7d: num(market.oneWeekPriceChange),
    volume: num(market.volumeNum) ?? num(market.volume) ?? 0,
    volume24h: num(market.volume24hr) ?? 0,
    // Gamma's end date is a schedule: election markets keep trading past it, so only the book decides.
    open: market.active === true && market.closed !== true && market.acceptingOrders === true && market.enableOrderBook === true && !decided,
  };
}

/** The price a Yes or No share costs now: the book's ask when known, else the displayed price. */
export function sharePrice(market: BinaryMarket, side: 0 | 1) {
  const outcome = side === 0 ? market.yes : market.no;
  const value = outcome.buyPrice ?? outcome.price;
  return value > 0 && value < 1 ? value : null;
}

export const HOT_MARKET_TAGS = ["geopolitics", "politics", "world", "ukraine", "middle-east"] as const;

/** Counting games (tweets, mentions, words said) sit under politics tags but are not news markets. */
const NOT_NEWS_MARKET = /\b(?:tweets?|truth social posts?|posts? \d|mentions?|say "|says "|followers)\b/i;

/** A market for the app's lists: news, not a counting game, and no election outside the US (owner rule). */
export function isNewsMarket(market: Pick<BinaryMarket, "question" | "eventTitle">) {
  const text = `${market.question} ${market.eventTitle || ""}`;
  return !NOT_NEWS_MARKET.test(text) && !foreignElectionMarket(text);
}

const isElection = (market: BinaryMarket) => electionMarket(`${market.question} ${market.eventTitle || ""}`);

/**
 * The Рынки tab. Hot: the biggest open Yes/No markets by total volume, at most two per event, none
 * already all but decided, elections last (US only). Movers: the same pool by the size of its 24 h move.
 */
export function hotMarketsFromEvents(eventLists: unknown[][], limit = 40) {
  const seenEvents = new Set<string>();
  const seenMarkets = new Set<string>();
  const rows: Array<{ market: BinaryMarket; eventVolume24h: number }> = [];
  for (const events of eventLists) {
    for (const value of events) {
      if (!value || typeof value !== "object") continue;
      const event = value as Raw;
      const eventId = String(event.id ?? "");
      if (!eventId || seenEvents.has(eventId)) continue;
      seenEvents.add(eventId);
      const markets = (Array.isArray(event.markets) ? event.markets : [])
        .map((market) => parseGammaMarket(market, event))
        .filter((market): market is BinaryMarket => Boolean(market?.open && market.yes.price >= 0.02 && market.yes.price <= 0.98 && isNewsMarket(market)))
        .sort((left, right) => right.volume24h - left.volume24h)
        .slice(0, 2);
      for (const market of markets) {
        if (seenMarkets.has(market.id)) continue;
        seenMarkets.add(market.id);
        rows.push({ market, eventVolume24h: num(event.volume24hr) ?? market.volume24h });
      }
    }
  }
  const hot = rows.map((row) => row.market)
    .filter((market) => market.volume24h > 0)
    .sort((left, right) => Number(isElection(left)) - Number(isElection(right)) || right.volume - left.volume)
    .slice(0, limit);
  const movers = rows.map((row) => row.market)
    .filter((market) => !isElection(market) && market.change24h !== null && Math.abs(market.change24h) >= 0.01 && market.volume24h >= 5_000)
    .sort((left, right) => Math.abs(right.change24h ?? 0) - Math.abs(left.change24h ?? 0))
    .slice(0, limit);
  return { hot, movers };
}

/** The OddsFront map's activity-rail thresholds (lib/conflict-activity-signals.ts). */
export const ALERT_DAY_MOVE = 0.02;
export const ALERT_WEEK_MOVE = 0.05;

/** A map market's alert: its 24 h move when that clears the bar, else its 7-day move; null when quiet. */
export function mapAlert(change24h: number | null, change7d: number | null): BinaryMarket["alert"] | null {
  if (change24h !== null && Number.isFinite(change24h) && Math.abs(change24h) >= ALERT_DAY_MOVE && Math.abs(change24h) <= 1) return { window: "24h", change: change24h };
  if (change7d !== null && Number.isFinite(change7d) && Math.abs(change7d) >= ALERT_WEEK_MOVE && Math.abs(change7d) <= 1) return { window: "7d", change: change7d };
  return null;
}

/** Map alerts first (biggest move first), then the other big 24 h moves; each market once. */
export function moversWithAlerts(alerts: readonly BinaryMarket[], movers: readonly BinaryMarket[], limit = 40) {
  const seen = new Set<string>();
  const sortedAlerts = alerts.filter((market) => market.open && isNewsMarket(market) && !isElection(market) && market.alert)
    .toSorted((left, right) => Math.abs(right.alert!.change) - Math.abs(left.alert!.change));
  const out: BinaryMarket[] = [];
  for (const market of [...sortedAlerts, ...movers]) {
    if (seen.has(market.id) || out.length >= limit) continue;
    seen.add(market.id);
    out.push(market);
  }
  return out;
}
