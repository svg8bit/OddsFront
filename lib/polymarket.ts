import { CONFLICT_FIXTURE } from "@/features/global-conflict-map/data/conflicts.fixture";
import { REGION_DEFINITIONS } from "@/features/global-conflict-map/data/regions";
import type {
  ConflictFeed,
  ConflictMarket,
  RegionDefinition,
} from "@/features/global-conflict-map/types";
import { buildPolymarketEventUrl } from "@/lib/polymarket-links";

const GAMMA_SEARCH_URL = "https://gamma-api.polymarket.com/public-search";
const GAMMA_DOCS_URL =
  "https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles";
const REFRESH_SECONDS = 60;

interface GammaMarket {
  id?: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string | number;
  volume24hr?: string | number | null;
  liquidity?: string | number | null;
  active?: boolean;
  closed?: boolean;
  endDate?: string | null;
  updatedAt?: string | null;
}
interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  volume24hr?: string | number | null;
  updatedAt?: string | null;
  markets?: GammaMarket[] | null;
}

interface GammaSearchResponse {
  events?: GammaEvent[] | null;
}

function parseStringArray(value: string | undefined): string[] | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeBinaryPrices(
  market: GammaMarket,
): { yes: number; no: number } | null {
  const outcomes = parseStringArray(market.outcomes);
  const prices = parseStringArray(market.outcomePrices)?.map(Number);

  if (!outcomes || !prices || outcomes.length !== prices.length) return null;

  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0) return null;

  const yesValue = prices[yesIndex];
  const noValue = prices[noIndex];
  if (!Number.isFinite(yesValue) || !Number.isFinite(noValue)) return null;

  const total = yesValue + noValue;
  if (total <= 0) return null;

  const yes = Math.round((yesValue / total) * 100);
  return { yes, no: 100 - yes };
}

function cleanQuestion(value: string): string {
  return value.replaceAll("…", "...").replace(/\s+/g, " ").trim();
}

function normalizeRegionMarket(
  region: RegionDefinition,
  event: GammaEvent,
  market: GammaMarket,
): ConflictMarket | null {
  const odds = normalizeBinaryPrices(market);
  if (!odds || !market.id || !market.question || !event.id || !event.title) return null;

  return {
    id: market.id,
    eventId: event.id,
    eventTitle: cleanQuestion(event.title),
    regionId: region.id,
    region: region.name,
    tone: region.tone,
    anchor: region.anchor,
    polygon: region.polygon,
    cardOffset: region.cardOffset,
    question: cleanQuestion(market.question),
    yes: odds.yes,
    no: odds.no,
    volume24h: toFiniteNumber(market.volume24hr ?? event.volume24hr),
    totalVolume: toFiniteNumber(market.volume),
    liquidity: toFiniteNumber(market.liquidity),
    endDate: market.endDate ?? null,
    updatedAt: market.updatedAt ?? event.updatedAt ?? new Date().toISOString(),
    dataOrigin: "polymarket",
    evidenceStatus: "regional-anchor",
    marketUrl: buildPolymarketEventUrl(event.slug),
    sourceLabel: "Polymarket Gamma API",
    sourceUrl: GAMMA_DOCS_URL,
  };
}

async function fetchRegionMarket(region: RegionDefinition): Promise<ConflictMarket | null> {
  const url = new URL(GAMMA_SEARCH_URL);
  url.searchParams.set("q", region.searchQuery);
  url.searchParams.set("events_status", "active");
  url.searchParams.set("limit_per_type", "10");
  url.searchParams.set("search_tags", "false");
  url.searchParams.set("search_profiles", "false");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: REFRESH_SECONDS },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Polymarket search failed with ${response.status}`);
  }

  const payload = (await response.json()) as GammaSearchResponse;
  const candidates: ConflictMarket[] = [];

  for (const event of payload.events ?? []) {
    if (!event.active || event.closed) continue;

    for (const market of event.markets ?? []) {
      if (!market.active || market.closed) continue;
      const normalized = normalizeRegionMarket(region, event, market);
      if (normalized) candidates.push(normalized);
    }
  }

  candidates.sort(
    (left, right) =>
      right.volume24h - left.volume24h || right.totalVolume - left.totalVolume,
  );
  return candidates[0] ?? null;
}

export async function getConflictFeed(): Promise<ConflictFeed> {
  const settled = await Promise.allSettled(
    REGION_DEFINITIONS.map((region) => fetchRegionMarket(region)),
  );

  const liveByRegion = new Map<string, ConflictMarket>();
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      liveByRegion.set(result.value.regionId, result.value);
    }
  }

  const markets = REGION_DEFINITIONS.map((region) => {
    const live = liveByRegion.get(region.id);
    if (live) return live;
    return CONFLICT_FIXTURE.find((market) => market.regionId === region.id);
  }).filter((market): market is ConflictMarket => Boolean(market));

  const liveCount = markets.filter((market) => market.dataOrigin === "polymarket").length;
  const dataMode =
    liveCount === markets.length ? "live" : liveCount > 0 ? "mixed" : "fallback";

  return {
    dataMode,
    updatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    markets,
  };
}
