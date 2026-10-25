// Live Polymarket markets for hot-desk stories, read from the public Gamma
// and CLOB APIs. Only liquid binary Yes/No markets can carry bet buttons.

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

export type GammaMarket = {
  id?: unknown; question?: unknown; slug?: unknown; conditionId?: unknown; outcomes?: unknown; outcomePrices?: unknown; clobTokenIds?: unknown;
  bestBid?: unknown; bestAsk?: unknown; spread?: unknown; lastTradePrice?: unknown; oneDayPriceChange?: unknown; oneWeekPriceChange?: unknown;
  active?: unknown; closed?: unknown; acceptingOrders?: unknown; enableOrderBook?: unknown; endDate?: unknown; image?: unknown; icon?: unknown;
  volumeNum?: unknown; volume?: unknown; liquidityNum?: unknown; groupItemTitle?: unknown; events?: unknown;
};
export type GammaEvent = { id?: unknown; title?: unknown; slug?: unknown; image?: unknown; volume24hr?: unknown; markets?: unknown };

export type HotDeskMarket = {
  id: string;
  question: string;
  slug: string;
  conditionId: string | null;
  eventId: string | null;
  eventTitle: string;
  eventSlug: string;
  yesTokenId: string;
  /** Displayed chance: the midpoint, or the last trade when the book is wide (Polymarket's own rule). */
  chance: number;
  /** One-tap buy prices: Yes at the best ask, No at one minus the best bid. */
  yesPrice: number;
  noPrice: number;
  dayChange: number | null;
  weekChange: number | null;
  volume: number;
  liquidity: number | null;
  endDate: string;
  image: string | null;
};

export type MarketPolicy = { minVolume: number; minLiquidity: number; maxSpread: number; minHoursToEnd: number };
export const DEFAULT_MARKET_POLICY: MarketPolicy = { minVolume: 50_000, minLiquidity: 5_000, maxSpread: 0.05, minHoursToEnd: 6 };

// Leaders' fates ("… out as prime minister?") stay in scope; only contests are elections.
const ELECTION = /\b(elect(?:ion|ions|ed)?|presidential|parliamentary|runoff|run-off|referendum|ballot|vote share|seats|primary|primaries|polls? lead|mayoral)\b/i;
const UNITED_STATES = /\b(U\.?S\.?A?|United States|America|American|Senate|House (?:of Representatives|majority|control|seats|race)|Congress|congressional|midterms?|governor|gubernatorial|Electoral College|Democrats?|Democratic|Republicans?|GOP|Trump|Vance|Newsom|White House)\b/;

/** Owner rule: elections only for the US. A non-US election market never carries buttons. */
export function foreignElectionMarket(text: string) {
  return ELECTION.test(text) && !UNITED_STATES.test(text);
}

/** Any election contest, US ones included (they rank last: "elections are the weakest topic"). */
export function electionMarket(text: string) {
  return ELECTION.test(text) || /\b(midterms?|balance of power|nominee|nomination)\b/i.test(text);
}

const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
function jsonList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** A tradable binary market in the shape the hot desk uses, or null with no bet buttons possible. */
export function normalizeMarket(raw: GammaMarket, event: GammaEvent | null, policy: MarketPolicy = DEFAULT_MARKET_POLICY, now = Date.now()): HotDeskMarket | null {
  const id = text(raw.id);
  const outcomes = jsonList(raw.outcomes);
  const prices = jsonList(raw.outcomePrices).map(number);
  const tokens = jsonList(raw.clobTokenIds).map(text);
  if (!/^\d{1,12}$/.test(id) || outcomes.length !== 2 || outcomes[0] !== "Yes" || outcomes[1] !== "No" || tokens.length !== 2 || !tokens.every(token => /^\d{10,100}$/.test(token))) return null;
  if (raw.active !== true || raw.closed === true || raw.acceptingOrders !== true || raw.enableOrderBook !== true) return null;
  const endDate = Date.parse(text(raw.endDate));
  // Gamma's end date is a schedule, not a gate: election markets keep trading past
  // it until results are in (acceptingOrders decides). Only an imminent future
  // deadline ("… by October 25?" closing within hours) is too short for a post.
  if (!Number.isFinite(endDate) || (endDate > now && endDate - now < policy.minHoursToEnd * 60 * 60_000)) return null;
  const volume = number(raw.volumeNum) ?? number(raw.volume) ?? 0;
  const liquidity = number(raw.liquidityNum);
  if (volume < policy.minVolume && (liquidity ?? 0) < policy.minLiquidity) return null;
  const ask = number(raw.bestAsk);
  const spread = number(raw.spread);
  const bid = number(raw.bestBid) ?? (ask !== null && spread !== null ? Math.round((ask - spread) * 10_000) / 10_000 : null);
  const yesOutcome = prices[0];
  const hasBook = ask !== null && bid !== null && ask > 0 && ask < 1 && bid > 0 && bid < 1 && ask >= bid;
  if (hasBook && ask - bid > policy.maxSpread) return null;
  const last = number(raw.lastTradePrice);
  const chance = hasBook ? (ask - bid <= 0.1 ? (ask + bid) / 2 : last ?? (ask + bid) / 2) : yesOutcome;
  if (chance === null || chance === undefined || chance < 0.01 || chance > 0.99) return null;
  const yesPrice = hasBook ? ask : chance;
  const noPrice = hasBook ? 1 - bid : 1 - chance;
  const question = text(raw.question);
  if (question.length < 8 || question.length > 300) return null;
  const nested = Array.isArray(raw.events) ? raw.events[0] as GammaEvent | undefined : undefined;
  const parent = event ?? nested ?? null;
  if (foreignElectionMarket(`${text(parent?.title)} ${question}`)) return null;
  const image = text(raw.image) || text(raw.icon) || text(parent?.image);
  const conditionId = text(raw.conditionId).toLowerCase();
  return {
    id,
    question,
    slug: text(raw.slug),
    conditionId: /^0x[0-9a-f]{64}$/.test(conditionId) ? conditionId : null,
    eventId: /^\d{1,12}$/.test(text(parent?.id)) ? text(parent?.id) : null,
    eventTitle: text(parent?.title) || question,
    eventSlug: text(parent?.slug),
    yesTokenId: tokens[0]!,
    chance,
    yesPrice,
    noPrice,
    dayChange: number(raw.oneDayPriceChange),
    weekChange: number(raw.oneWeekPriceChange),
    volume,
    liquidity,
    endDate: new Date(endDate).toISOString(),
    image: /^https:\/\//.test(image) ? image : null,
  };
}

async function gamma<T>(pathname: string): Promise<T | null> {
  try {
    const response = await fetch(`${GAMMA}${pathname}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) { await response.body?.cancel(); return null; }
    return await response.json() as T;
  } catch { return null; }
}

/** Markets of events, deduplicated, keeping each market's parent event. */
function eventMarkets(events: readonly GammaEvent[]) {
  const pairs: { raw: GammaMarket; event: GammaEvent }[] = [];
  for (const event of events) for (const raw of Array.isArray(event.markets) ? event.markets as GammaMarket[] : []) pairs.push({ raw, event });
  return pairs;
}

export async function searchMarkets(query: string): Promise<{ raw: GammaMarket; event: GammaEvent }[]> {
  const result = await gamma<{ events?: GammaEvent[] }>(`/public-search?q=${encodeURIComponent(query)}&limit_per_type=10&events_status=active`);
  return eventMarkets(result?.events ?? []);
}

export const MOVER_TAGS = ["geopolitics", "politics", "world"] as const;

export async function moverEvents(tag: string): Promise<{ raw: GammaMarket; event: GammaEvent }[]> {
  const events = await gamma<GammaEvent[]>(`/events?tag_slug=${encodeURIComponent(tag)}&active=true&closed=false&order=volume24hr&ascending=false&limit=50`);
  return eventMarkets(Array.isArray(events) ? events : []);
}

/** Full market records (best bid, liquidity, weekly change) for up to 100 ids. */
export async function marketsById(ids: readonly string[]): Promise<Map<string, GammaMarket>> {
  const unique = [...new Set(ids.filter(id => /^\d{1,12}$/.test(id)))];
  const found = new Map<string, GammaMarket>();
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const rows = await gamma<GammaMarket[]>(`/markets?${batch.map(id => `id=${id}`).join("&")}&limit=${batch.length}`);
    for (const row of Array.isArray(rows) ? rows : []) if (text(row.id)) found.set(text(row.id), row);
  }
  return found;
}

/** Full records of markets by condition id (the map's own markets). */
export async function marketsByConditionId(conditionIds: readonly string[]): Promise<GammaMarket[]> {
  const unique = [...new Set(conditionIds.map(id => id.toLowerCase()).filter(id => /^0x[0-9a-f]{64}$/.test(id)))];
  const rows: GammaMarket[] = [];
  for (let start = 0; start < unique.length; start += 40) {
    const batch = unique.slice(start, start + 40);
    const found = await gamma<GammaMarket[]>(`/markets?${batch.map(id => `condition_ids=${id}`).join("&")}&limit=${batch.length}`);
    if (Array.isArray(found)) rows.push(...found);
  }
  return rows;
}

/** "exact": the map's popup shows this very market; "event": the map shows a sibling market of its event. */
export type CandidateMarket = HotDeskMarket & { queries: string[]; onMap: "exact" | "event" | null };
export type MapMarketRef = { conditionId: string | null; eventId: string };

/**
 * Candidate markets for the editor: search hits for each story query, the
 * busiest politics/geopolitics markets and the markets on the OddsFront map,
 * enriched with full Gamma records and filtered to liquid binary markets.
 * `onMap` marks a market whose own popup ("exact") or event ("event") the map can show.
 */
export async function candidateMarkets(queries: readonly string[], policy: MarketPolicy = DEFAULT_MARKET_POLICY, now = Date.now(), map: readonly MapMarketRef[] = []): Promise<CandidateMarket[]> {
  const [searched, movers, mapped] = await Promise.all([
    Promise.all(queries.map(query => searchMarkets(query).then(pairs => pairs.map(pair => ({ ...pair, query }))))),
    Promise.all(MOVER_TAGS.map(tag => moverEvents(tag))),
    marketsByConditionId(map.map(ref => ref.conditionId ?? "")),
  ]);
  const pairs = [
    ...searched.flat(),
    ...movers.flat().map(pair => ({ ...pair, query: null as string | null })),
    ...mapped.map(raw => ({ raw, event: (Array.isArray(raw.events) ? raw.events[0] : null) as GammaEvent, query: null as string | null })),
  ];
  // Prefilter on the search payload before asking Gamma for full records.
  const firstPass = new Map<string, { raw: GammaMarket; event: GammaEvent; queries: Set<string> }>();
  for (const pair of pairs) {
    const id = text(pair.raw.id);
    if (!normalizeMarket(pair.raw, pair.event, { ...policy, minVolume: 0, minLiquidity: 0, maxSpread: 1 }, now)) continue;
    const entry = firstPass.get(id) ?? { raw: pair.raw, event: pair.event, queries: new Set<string>() };
    if (pair.query) entry.queries.add(pair.query);
    firstPass.set(id, entry);
  }
  const full = await marketsById([...firstPass.keys()]);
  const mapConditions = new Set(map.map(ref => ref.conditionId?.toLowerCase()).filter(Boolean));
  const mapEvents = new Set(map.map(ref => ref.eventId));
  const markets: CandidateMarket[] = [];
  for (const [id, entry] of firstPass) {
    const market = normalizeMarket(full.get(id) ?? entry.raw, entry.event, policy, now);
    if (market) markets.push({ ...market, queries: [...entry.queries], onMap: market.conditionId && mapConditions.has(market.conditionId) ? "exact" : market.eventId && mapEvents.has(market.eventId) ? "event" : null });
  }
  return markets;
}

/** The selected market again, right before rendering and sending. */
export async function refreshMarket(id: string, policy: MarketPolicy = DEFAULT_MARKET_POLICY, now = Date.now()): Promise<HotDeskMarket | null> {
  const raw = await gamma<GammaMarket>(`/markets/${encodeURIComponent(id)}`);
  return raw ? normalizeMarket(raw, null, policy, now) : null;
}

export type PricePoint = { t: number; p: number };

/** Seven days of hourly Yes prices for the card chart; empty when unavailable. */
export async function priceHistory(tokenId: string): Promise<PricePoint[]> {
  try {
    const response = await fetch(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1w&fidelity=60`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) { await response.body?.cancel(); return []; }
    const json = await response.json() as { history?: { t?: unknown; p?: unknown }[] };
    return (json.history ?? []).map(point => ({ t: Number(point.t), p: Number(point.p) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p >= 0 && point.p <= 1);
  } catch { return []; }
}
