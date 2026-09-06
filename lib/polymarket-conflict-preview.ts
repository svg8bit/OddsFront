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
const REFRESH_SECONDS = 60;
const PAGE_SIZE = 100;
const MAX_PAGES = 8;
const UPSTREAM_REQUEST_TIMEOUT_MS = 4_000;
const UPSTREAM_TOTAL_BUDGET_MS = 7_000;

interface GammaMarket {
  id?: string;
  conditionId?: string | null;
  question?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  clobTokenIds?: unknown;
  volume?: string | number | null;
  volume24hr?: string | number | null;
  liquidity?: string | number | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  updatedAt?: string | null;
  oneHourPriceChange?: string | number | null;
  oneDayPriceChange?: string | number | null;
  oneWeekPriceChange?: string | number | null;
  image?: string | null;
  icon?: string | null;
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
  image?: string | null;
  icon?: string | null;
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

const questionDeadlinePattern =
  /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+([12]?\d|3[01])(?:,\s*(\d{4}))?\s*[?.!]*$/i;

const monthIndexByName: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MAX_INFERRED_DEADLINE_MS = 370 * 24 * 60 * 60_000;

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
): { yes: number; no: number; yesProbability: number } | null {
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
  const yesProbability = yesValue / total;
  const yes = Math.round(yesProbability * 100);
  return { yes, no: 100 - yes, yesProbability };
}

function yesTokenId(market: GammaMarket): string | null {
  const outcomes = parseStringArray(market.outcomes);
  const tokens = parseStringArray(market.clobTokenIds);
  if (!outcomes || !tokens || outcomes.length !== tokens.length) return null;
  const index = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const token = index >= 0 ? tokens[index]?.trim() : "";
  return token && /^\d{8,}$/.test(token) ? token : null;
}

function cleanText(value: string): string {
  return value.replaceAll("…", "...").replace(/\s+/g, " ").trim();
}

function normalizeConditionId(value: string | null | undefined): string | null {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function normalizePolymarketImageUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname === "polymarket-upload.s3.us-east-2.amazonaws.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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

function buildUtcEndOfDay(year: number, monthIndex: number, day: number) {
  const timestamp = Date.UTC(year, monthIndex, day, 23, 59, 59, 999);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

function inferQuestionDeadline(
  question: string,
  startDate: string | null | undefined,
): string | null {
  const match = cleanText(question).match(questionDeadlinePattern);
  if (!match) return null;

  const monthIndex = monthIndexByName[match[1]!.toLowerCase()];
  const day = Number.parseInt(match[2]!, 10);
  const explicitYear = match[3] ? Number.parseInt(match[3], 10) : null;
  if (monthIndex === undefined || !Number.isInteger(day)) return null;

  if (explicitYear !== null) {
    const explicitDeadline = buildUtcEndOfDay(explicitYear, monthIndex, day);
    return explicitDeadline === null
      ? null
      : new Date(explicitDeadline).toISOString();
  }

  const startTimestamp = Date.parse(startDate ?? "");
  if (!Number.isFinite(startTimestamp)) return null;

  let inferredYear = new Date(startTimestamp).getUTCFullYear();
  let inferredDeadline = buildUtcEndOfDay(inferredYear, monthIndex, day);
  if (inferredDeadline === null) return null;
  if (inferredDeadline < startTimestamp) {
    inferredYear += 1;
    inferredDeadline = buildUtcEndOfDay(inferredYear, monthIndex, day);
  }
  if (
    inferredDeadline === null ||
    inferredDeadline - startTimestamp > MAX_INFERRED_DEADLINE_MS
  ) {
    return null;
  }

  return new Date(inferredDeadline).toISOString();
}

function reconcileMarketEndDate(
  market: GammaMarket,
  now = Date.now(),
): string | null {
  const upstreamEndDate = market.endDate ?? null;
  if (!upstreamEndDate) return upstreamEndDate;

  const upstreamTimestamp = Date.parse(upstreamEndDate);
  if (!Number.isFinite(upstreamTimestamp) || upstreamTimestamp > now) {
    return upstreamEndDate;
  }
  if (
    market.active !== true ||
    market.closed ||
    market.archived ||
    market.acceptingOrders !== true ||
    !market.question
  ) {
    return upstreamEndDate;
  }

  // Gamma occasionally keeps an earlier ladder deadline after renaming an
  // actively traded market. Only reconcile a terminal question date when the
  // order book is explicitly live; yearless dates stay anchored to startDate
  // so they cannot roll forward forever.
  const inferredDeadline = inferQuestionDeadline(
    market.question,
    market.startDate,
  );
  return inferredDeadline && !isExpired(inferredDeadline, now)
    ? inferredDeadline
    : upstreamEndDate;
}

function hasOpenOdds(odds: { yes: number; no: number }): boolean {
  return odds.yes > 0 && odds.no > 0;
}

function marketDeadlineYear(market: GammaMarket): number | null {
  const deadline =
    inferQuestionDeadline(market.question ?? "", market.startDate) ??
    market.endDate;
  const timestamp = Date.parse(deadline ?? "");
  return Number.isFinite(timestamp)
    ? new Date(timestamp).getUTCFullYear()
    : null;
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
    .map((market) => ({
      ...market,
      endDate: reconcileMarketEndDate(market),
    }))
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
      ): entry is {
        market: GammaMarket & {
          id: string;
          question: string;
          endDate: string | null;
        };
        odds: { yes: number; no: number; yesProbability: number };
      } =>
        Boolean(entry.odds && hasOpenOdds(entry.odds)),
    )
    .sort(
      (left, right) =>
        right.odds.yesProbability - left.odds.yesProbability ||
        toFiniteNumber(right.market.volume) - toFiniteNumber(left.market.volume) ||
        toFiniteNumber(right.market.volume24hr) -
          toFiniteNumber(left.market.volume24hr),
    );

  const tagText = eventTagText(event);
  const relevantMarkets = activeMarkets.filter(({ market }) =>
    isConflictRelevant(cleanText(`${event.title} ${market.question}`), tagText),
  );
  const deadlineYears = [
    ...new Set(
      relevantMarkets
        .map(({ market }) => marketDeadlineYear(market))
        .filter((year): year is number => year !== null),
    ),
  ];
  const nearestDeadlineYear =
    deadlineYears.length > 1 ? Math.min(...deadlineYears) : null;
  const representativeMarkets =
    nearestDeadlineYear === null
      ? relevantMarkets
      : relevantMarkets.filter(
          ({ market }) => marketDeadlineYear(market) === nearestDeadlineYear,
        );
  const selected = representativeMarkets[0];
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
    marketVolume: toFiniteNumber(selected.market.volume),
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
    imageUrl: [
      selected.market.image,
      selected.market.icon,
      event.image,
      event.icon,
    ].map(normalizePolymarketImageUrl).find((value): value is string => value !== null) ?? null,
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    volume24h: toFiniteNumber(selected.market.volume24hr ?? event.volume24hr),
    liquidity: toFiniteNumber(selected.market.liquidity ?? event.liquidity),
    priceChange1h: toOptionalFiniteNumber(selected.market.oneHourPriceChange),
    priceChange24h: toOptionalFiniteNumber(selected.market.oneDayPriceChange),
    priceChange7d: toOptionalFiniteNumber(selected.market.oneWeekPriceChange),
    endDate: selected.market.endDate ?? null,
    marketConditionId: normalizeConditionId(selected.market.conditionId),
    yesTokenId: yesTokenId(selected.market),
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
  ["oddsfront-live-conflict-feed-v5-freshness"],
  {
    revalidate: REFRESH_SECONDS,
    tags: ["oddsfront-live-conflict-feed"],
  },
);

let liveFeedRefreshInFlight: Promise<ConflictPreviewFeed> | null = null;

async function getSingleFlightLiveConflictPreviewFeed() {
  if (liveFeedRefreshInFlight) return liveFeedRefreshInFlight;

  const request = (async () => {
    const cached = await getCachedLiveConflictPreviewFeed();
    // Next's background revalidation can serve the first visitor an old entry.
    // Bound that age while the single-flight guard protects the upstream.
    return Date.now() - Date.parse(cached.updatedAt) > 90_000
      ? buildLiveConflictPreviewFeed()
      : cached;
  })();
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
