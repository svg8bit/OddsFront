import { unstable_cache } from "next/cache";

import {
  PREVIEW_MINIMUM_VOLUME,
  getConflictPreviewFixtureFeed,
} from "@/features/global-conflict-map/preview/fixture";
import {
  resolveConflictLocation,
  resolveConflictParticipants,
} from "@/features/global-conflict-map/preview/location-rules";
import type {
  ConflictPreviewEvent,
  ConflictPreviewFeed,
} from "@/features/global-conflict-map/preview/types";
import { buildPolymarketEventUrl } from "@/lib/polymarket-links";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events/keyset";
const GAMMA_DOCS_URL = "https://docs.polymarket.com/market-data/fetching-markets";
const GEOPOLITICS_TAG_ID = "100265";
const REFRESH_SECONDS = 300;
const PAGE_SIZE = 100;
const MAX_PAGES = 8;
const UPSTREAM_REQUEST_TIMEOUT_MS = 4_000;
const UPSTREAM_TOTAL_BUDGET_MS = 7_000;

interface GammaMarket {
  id?: string;
  question?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  volume?: string | number | null;
  volume24hr?: string | number | null;
  liquidity?: string | number | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string | null;
  updatedAt?: string | null;
  oneHourPriceChange?: string | number | null;
  oneDayPriceChange?: string | number | null;
  oneWeekPriceChange?: string | number | null;
}

interface GammaTag {
  slug?: string;
  label?: string;
}

export interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  endDate?: string | null;
  volume?: string | number | null;
  volume24hr?: string | number | null;
  liquidity?: string | number | null;
  updatedAt?: string | null;
  markets?: GammaMarket[] | null;
  tags?: GammaTag[] | null;
}

interface GammaKeysetResponse {
  events?: GammaEvent[] | null;
  next_cursor?: string | null;
}

const directConflictPattern =
  /\b(?:invad(?:e|es|ed|ing|er|ers|sion)?|strike|strikes|struck|airstrike|attack|attacks|attacked|ceasefire|military clash|military action|military engagement|military operation|declare war|declares war|war on|ground offensive|ground operation|troops fighting|forces enter|forces withdraw|capture|captures|captured|re-enter|annex|annexes|annexation|blockade|disarm|disarms|peace deal|peace talks|peace agreement|peacekeeping force|nuclear test|nuclear weapon|nuclear weapons|nuclear bomb|nuclear warhead|atomic weapon|nuke|warship|hostage)\b/i;

const conflictInfrastructurePattern =
  /strait of hormuz|\bhormuz\b|airspace closure|closes its airspace|uranium|nuclear deal|nuclear site|npt|enrichment|litani river|military draft/i;

const conflictTagPattern =
  /\b(?:armed conflict|ceasefire|diplomacy ceasefire|hostages?|invasion|military action|military strikes?|nuclear weapons?|peace deal|strike|war)\b/i;

const excludedContextPattern =
  /nobel peace prize|election|prime minister|president|leader end|out as|out by|leadership change|regime fall|coup attempt|referendum|visit |will .* visit|meet(?:s|ing)? with|recogniz(?:e|es|ed|ing)|normaliz(?:e|es|ed|ing) relations|economic deal|trade deal|tariff|gdp|inflation|legalize|internet blackout|rejoin the g7|board of peace/i;

function isConflictRelevant(text: string, tagText: string): boolean {
  const direct = directConflictPattern.test(text);
  const infrastructure = conflictInfrastructurePattern.test(text);
  const conflictTagged = conflictTagPattern.test(tagText);
  if (!direct && !infrastructure && !conflictTagged) return false;
  if (excludedContextPattern.test(text) && !direct) return false;
  return true;
}

function toFiniteNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(numeric) ? numeric : 0;
}

function toOptionalFiniteNumber(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseStringArray(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  if (typeof value !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
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

function cleanText(value: string): string {
  return value.replaceAll("…", "...").replace(/\s+/g, " ").trim();
}

function eventTagText(event: GammaEvent): string {
  return cleanText(
    (event.tags ?? [])
      .flatMap((tag) => [tag.label ?? "", (tag.slug ?? "").replaceAll("-", " ")])
      .join(" "),
  );
}

function isExpired(endDate: string | null | undefined, now = Date.now()): boolean {
  if (!endDate) return false;
  const timestamp = Date.parse(endDate);
  // Invalid upstream dates are not safe to publish as active. Fail closed so
  // every non-null date in the public feed is both parseable and in the future.
  return !Number.isFinite(timestamp) || timestamp <= now;
}

function hasOpenOdds(odds: { yes: number; no: number }): boolean {
  return odds.yes > 0 && odds.no > 0;
}

function minimumZoomForVolume(volume: number): number {
  if (volume >= 5_000_000) return 1;
  if (volume >= 1_000_000) return 1.8;
  if (volume >= 250_000) return 2.8;
  if (volume >= 100_000) return 3.7;
  return 4.4;
}

function severityForEvent(
  volume: number,
  yesOdds: number,
): ConflictPreviewEvent["severity"] {
  if (volume >= 10_000_000 || yesOdds >= 65) return "critical";
  if (volume >= 1_000_000 || yesOdds >= 35) return "high";
  return "elevated";
}

export function normalizeConflictPreviewEvent(
  event: GammaEvent,
): ConflictPreviewEvent | null {
  const eventVolume = toFiniteNumber(event.volume);
  if (
    !event.id ||
    !event.title ||
    !event.active ||
    event.closed ||
    event.archived ||
    eventVolume < PREVIEW_MINIMUM_VOLUME
  ) {
    return null;
  }

  // Gamma aggregate events can retain a historical endDate after Polymarket
  // adds new dated markets. Market-level state below is authoritative, so an
  // open future market is not hidden by a stale event-level date.

  const activeMarkets = (event.markets ?? [])
    .filter(
      (market) =>
        market.id &&
        market.question &&
        market.active &&
        !market.closed &&
        !market.archived &&
        market.acceptingOrders !== false &&
        !isExpired(market.endDate),
    )
    .map((market) => ({ market, odds: normalizeBinaryPrices(market) }))
    .filter(
      (
        entry,
      ): entry is { market: GammaMarket & { id: string; question: string }; odds: { yes: number; no: number } } =>
        Boolean(entry.odds && hasOpenOdds(entry.odds)),
    )
    .sort(
      (left, right) =>
        toFiniteNumber(right.market.volume) - toFiniteNumber(left.market.volume) ||
        toFiniteNumber(right.market.volume24hr) -
          toFiniteNumber(left.market.volume24hr),
    );

  const tagText = eventTagText(event);
  const selected = activeMarkets.find(({ market }) =>
    isConflictRelevant(cleanText(`${event.title} ${market.question}`), tagText),
  );
  if (!selected) return null;

  const searchableText = cleanText(
    `${event.title} ${selected.market.question}`,
  );

  const location =
    resolveConflictLocation(searchableText) ?? resolveConflictLocation(tagText);
  if (!location) return null;
  // Related Gamma tags are useful as a safe country fallback but may mention
  // adjacent topics that are not actual belligerents. Participants therefore
  // come only from the event/question text plus the resolved anchor.
  const participants = resolveConflictParticipants(searchableText, location);

  const title = cleanText(selected.market.question);
  const updatedAt =
    selected.market.updatedAt ?? event.updatedAt ?? new Date().toISOString();

  return {
    id: `polymarket-${event.id}`,
    title,
    region: location.region,
    coordinates: location.coordinates,
    countryCodes: participants.countryCodes,
    countryFeatureIds: participants.countryFeatureIds,
    yesOdds: selected.odds.yes,
    noOdds: selected.odds.no,
    volume: eventVolume,
    tone: location.tone,
    severity: severityForEvent(eventVolume, selected.odds.yes),
    regionPolygon: [],
    popupOffset: [24, -190],
    locationId: location.id,
    locationLabel: location.label,
    minimumZoom: minimumZoomForVolume(eventVolume),
    dataOrigin: "polymarket",
    evidenceStatus: location.evidenceStatus,
    geographyKind: participants.geographyKind,
    marketUrl: buildPolymarketEventUrl(event.slug),
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    volume24h: toFiniteNumber(selected.market.volume24hr ?? event.volume24hr),
    liquidity: toFiniteNumber(selected.market.liquidity ?? event.liquidity),
    priceChange1h: toOptionalFiniteNumber(selected.market.oneHourPriceChange),
    priceChange24h: toOptionalFiniteNumber(selected.market.oneDayPriceChange),
    priceChange7d: toOptionalFiniteNumber(selected.market.oneWeekPriceChange),
    endDate: selected.market.endDate ?? null,
  };
}

async function fetchPolymarketGeopoliticsEvents(): Promise<GammaEvent[]> {
  const events: GammaEvent[] = [];
  let cursor = "";
  const deadline = Date.now() + UPSTREAM_TOTAL_BUDGET_MS;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const remainingBudget = deadline - Date.now();
    if (remainingBudget < 250) {
      throw new Error("Polymarket keyset request exceeded the total time budget");
    }

    const url = new URL(GAMMA_EVENTS_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("volume_min", String(PREVIEW_MINIMUM_VOLUME));
    url.searchParams.set("tag_id", GEOPOLITICS_TAG_ID);
    url.searchParams.set("related_tags", "true");
    url.searchParams.set("order", "volume");
    url.searchParams.set("ascending", "false");
    if (cursor) url.searchParams.set("after_cursor", cursor);

    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(
        Math.min(UPSTREAM_REQUEST_TIMEOUT_MS, remainingBudget),
      ),
    });
    if (!response.ok) {
      throw new Error(`Polymarket keyset request failed with ${response.status}`);
    }

    const payload = (await response.json()) as GammaKeysetResponse;
    const pageEvents = payload.events ?? [];
    events.push(...pageEvents);
    cursor = payload.next_cursor ?? "";

    if (!cursor || pageEvents.length === 0) return events;
  }

  throw new Error("Polymarket keyset pagination exceeded the safety limit");
}

async function buildLiveConflictPreviewFeed(): Promise<ConflictPreviewFeed> {
  const upstreamEvents = await fetchPolymarketGeopoliticsEvents();
  const events = upstreamEvents
    .map(normalizeConflictPreviewEvent)
    .filter((event): event is ConflictPreviewEvent => Boolean(event))
    .sort(
      (left, right) =>
        right.volume - left.volume || right.volume24h - left.volume24h,
    );

  if (events.length === 0) throw new Error("No geolocated conflict events returned");

  return {
    dataMode: "live",
    updatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    minimumVolume: PREVIEW_MINIMUM_VOLUME,
    sourceLabel: "Polymarket Gamma API",
    sourceUrl: GAMMA_DOCS_URL,
    events,
    excludedCount: upstreamEvents.length - events.length,
  };
}

const getCachedLiveConflictPreviewFeed = unstable_cache(
  buildLiveConflictPreviewFeed,
  ["oddsfront-live-conflict-feed-v3-five-minute-freshness"],
  {
    revalidate: REFRESH_SECONDS,
    tags: ["oddsfront-live-conflict-feed"],
  },
);

let liveFeedRefreshInFlight: Promise<ConflictPreviewFeed> | null = null;

async function getSingleFlightLiveConflictPreviewFeed() {
  if (liveFeedRefreshInFlight) return liveFeedRefreshInFlight;

  const request = getCachedLiveConflictPreviewFeed();
  liveFeedRefreshInFlight = request;
  try {
    return await request;
  } finally {
    if (liveFeedRefreshInFlight === request) liveFeedRefreshInFlight = null;
  }
}

export async function getConflictPreviewFeed(): Promise<ConflictPreviewFeed> {
  try {
    return await getSingleFlightLiveConflictPreviewFeed();
  } catch (error) {
    console.warn(
      "Polymarket conflict preview feed unavailable; using deterministic fallback.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return getConflictPreviewFixtureFeed();
  }
}
