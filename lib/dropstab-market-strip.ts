import "server-only";

import { unstable_cache } from "next/cache";

import type {
  MarketStripAsset,
  MarketStripFeed,
} from "@/features/global-conflict-map/preview/market-strip-types";
import {
  buildDropstabAssetUrl,
  buildDropsBotAssetTrackUrl,
  isDropstabAssetSlug,
} from "@/lib/dropstab-links";

const DROPSTAB_API_BASE = "https://public-api.dropstab.com/api/v1";
const DROPSTAB_WEB_BASE = "https://dropstab.com";
const DROPSTAB_TRADFI_URL = `${DROPSTAB_WEB_BASE}/tab/tradfi`;
const DROPSTAB_READER_URL =
  "https://r.jina.ai/http://dropstab.com/tab/tradfi";
const YAHOO_SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark";
const REFRESH_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_MS = 6_000;
const READER_TIMEOUT_MS = 12_000;
const NEXT_DATA_PATTERN =
  /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

interface MarketStripDefinition {
  id: string;
  displaySymbol: string;
  fallbackName: string;
  slug: string;
  yahooSymbol: string;
}

interface DropstabApiCoin {
  slug?: unknown;
  name?: unknown;
  symbol?: unknown;
  price?: unknown;
  priceChange24h?: unknown;
}

interface DropstabApiResponse {
  data?: DropstabApiCoin | null;
  failure?: unknown;
}

const MARKET_STRIP_DEFINITIONS: readonly MarketStripDefinition[] = [
  {
    id: "bitcoin",
    displaySymbol: "BTC",
    fallbackName: "Bitcoin",
    slug: "bitcoin",
    yahooSymbol: "BTC-USD",
  },
  {
    id: "gold",
    displaySymbol: "Gold",
    fallbackName: "Gold",
    slug: "gold-metal",
    yahooSymbol: "GC=F",
  },
  {
    id: "silver",
    displaySymbol: "Silver",
    fallbackName: "Silver",
    slug: "silver-metal",
    yahooSymbol: "SI=F",
  },
  {
    id: "copper",
    displaySymbol: "Copper",
    fallbackName: "Copper",
    slug: "copper-metal",
    yahooSymbol: "HG=F",
  },
  {
    id: "oil",
    displaySymbol: "Oil",
    fallbackName: "Brent Crude Oil",
    slug: "brent-crude-oil",
    yahooSymbol: "BZ=F",
  },
  {
    id: "sp500",
    displaySymbol: "S&P 500",
    fallbackName: "S&P 500",
    slug: "sp500-index",
    yahooSymbol: "^GSPC",
  },
  {
    id: "nvidia",
    displaySymbol: "NVDA",
    fallbackName: "NVIDIA Corporation",
    slug: "nvidia-corporation",
    yahooSymbol: "NVDA",
  },
  {
    id: "apple",
    displaySymbol: "AAPL",
    fallbackName: "Apple Inc.",
    slug: "apple-aapl",
    yahooSymbol: "AAPL",
  },
  {
    id: "spacex",
    displaySymbol: "SpaceX",
    fallbackName: "SpaceX Technologies Corp.",
    slug: "spacex-technologies",
    yahooSymbol: "SPCX",
  },
  {
    id: "ethereum",
    displaySymbol: "ETH",
    fallbackName: "Ethereum",
    slug: "ethereum",
    yahooSymbol: "ETH-USD",
  },
];

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const number = toFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function hasUsableMarketValues(coin: DropstabApiCoin | null): coin is DropstabApiCoin {
  return (
    coin !== null &&
    toPositiveFiniteNumber(coin.price) !== null &&
    toFiniteNumber(coin.priceChange24h) !== null
  );
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replaceAll("…", "...").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 80) : fallback;
}

function normalizeSlug(value: unknown, fallback: string): string {
  return isDropstabAssetSlug(value) ? value : fallback;
}

function buildAsset(
  definition: MarketStripDefinition,
  coin: DropstabApiCoin | null,
): MarketStripAsset {
  const slug = normalizeSlug(coin?.slug, definition.slug);
  return {
    id: definition.id,
    displaySymbol: definition.displaySymbol,
    name: cleanText(coin?.name, definition.fallbackName),
    sourceSymbol: cleanText(coin?.symbol, definition.displaySymbol),
    slug,
    price: toPositiveFiniteNumber(coin?.price),
    priceChange24h: toFiniteNumber(coin?.priceChange24h),
    dropsBotUrl: buildDropsBotAssetTrackUrl(slug)!,
    dropstabUrl: buildDropstabAssetUrl(slug)!,
  };
}

const MARKET_STRIP_SLUGS = new Set(
  MARKET_STRIP_DEFINITIONS.map((definition) => definition.slug),
);

function pagePrice(value: unknown): number | null {
  if (!value || typeof value !== "object") return toPositiveFiniteNumber(value);
  return toPositiveFiniteNumber((value as Record<string, unknown>).USD);
}

function pagePriceChange24h(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const oneDay = (value as Record<string, unknown>)["1D"];
  if (!oneDay || typeof oneDay !== "object") return toFiniteNumber(oneDay);
  return toFiniteNumber((oneDay as Record<string, unknown>).USD);
}

function collectPageCoins(
  value: unknown,
  coins: Map<string, DropstabApiCoin>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPageCoins(item, coins);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const slug = typeof record.slug === "string" ? record.slug : "";
  if (MARKET_STRIP_SLUGS.has(slug) && !coins.has(slug)) {
    const price = pagePrice(record.price);
    const priceChange24h = pagePriceChange24h(record.change);
    if (price !== null && priceChange24h !== null) {
      coins.set(slug, {
        slug,
        name: record.name,
        symbol: record.symbol,
        price,
        priceChange24h,
      });
    }
  }
  for (const child of Object.values(record)) collectPageCoins(child, coins);
}

function parseDropstabPage(html: string): Map<string, DropstabApiCoin> {
  const match = NEXT_DATA_PATTERN.exec(html);
  if (!match?.[1]) return new Map();
  const payload: unknown = JSON.parse(match[1]);
  const coins = new Map<string, DropstabApiCoin>();
  collectPageCoins(payload, coins);
  return coins;
}

async function fetchPageCoins(url: string): Promise<Map<string, DropstabApiCoin>> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "OddsFront/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`DropsTab page returned ${response.status}`);
  }
  return parseDropstabPage(await response.text());
}

function parseReaderTradfi(markdown: string): Map<string, DropstabApiCoin> {
  const coins = new Map<string, DropstabApiCoin>();
  for (const definition of MARKET_STRIP_DEFINITIONS) {
    const assetUrl = `${DROPSTAB_WEB_BASE}/coins/${definition.slug}`;
    const row = markdown
      .split("\n")
      .find((line) => line.startsWith("|") && line.includes(assetUrl));
    if (!row) continue;
    const values = row.match(
      /\|\s*\[\$([\d,.]+)\]\([^)]+\)\s*\|\s*([+−-]?[\d,.]+)%/,
    );
    if (!values?.[1] || !values[2]) continue;
    const price = toPositiveFiniteNumber(values[1].replaceAll(",", ""));
    const priceChange24h = toFiniteNumber(
      values[2].replaceAll(",", "").replace("−", "-"),
    );
    if (price === null || priceChange24h === null) continue;
    coins.set(definition.slug, {
      slug: definition.slug,
      name: definition.fallbackName,
      symbol: definition.displaySymbol,
      price,
      priceChange24h,
    });
  }
  return coins;
}

async function fetchReaderTradfiCoins(): Promise<Map<string, DropstabApiCoin>> {
  const response = await fetch(DROPSTAB_READER_URL, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "OddsFront/1.0",
      "X-No-Cache": "true",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(READER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`DropsTab reader returned ${response.status}`);
  }
  return parseReaderTradfi(await response.text());
}

async function fetchYahooCoins(): Promise<Map<string, DropstabApiCoin>> {
  const url = new URL(YAHOO_SPARK_URL);
  url.searchParams.set(
    "symbols",
    MARKET_STRIP_DEFINITIONS.map((definition) => definition.yahooSymbol).join(","),
  );
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "5m");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OddsFront/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Live market fallback returned ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return new Map();
  const spark = (payload as Record<string, unknown>).spark;
  if (!spark || typeof spark !== "object") return new Map();
  const results = (spark as Record<string, unknown>).result;
  if (!Array.isArray(results)) return new Map();

  const definitionByYahooSymbol = new Map(
    MARKET_STRIP_DEFINITIONS.map((definition) => [
      definition.yahooSymbol,
      definition,
    ]),
  );
  const coins = new Map<string, DropstabApiCoin>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const symbol = typeof record.symbol === "string" ? record.symbol : "";
    const definition = definitionByYahooSymbol.get(symbol);
    if (!definition || !Array.isArray(record.response)) continue;
    const firstResponse = record.response[0];
    if (!firstResponse || typeof firstResponse !== "object") continue;
    const meta = (firstResponse as Record<string, unknown>).meta;
    if (!meta || typeof meta !== "object") continue;
    const metaRecord = meta as Record<string, unknown>;
    const price = toPositiveFiniteNumber(metaRecord.regularMarketPrice);
    const previousClose = toFiniteNumber(metaRecord.chartPreviousClose);
    if (price === null || previousClose === null || previousClose === 0) continue;
    coins.set(definition.slug, {
      slug: definition.slug,
      name: definition.fallbackName,
      symbol: definition.displaySymbol,
      price,
      priceChange24h: (price / previousClose - 1) * 100,
    });
  }
  return coins;
}

async function fetchVpsCoins(): Promise<Map<string, DropstabApiCoin>> {
  const feedUrl = process.env.ODDSFRONT_MARKET_FEED_URL?.trim() ?? "";
  const feedToken = process.env.ODDSFRONT_MARKET_FEED_TOKEN?.trim() ?? "";
  if (!feedUrl.startsWith("https://") || feedToken.length < 32) {
    return new Map();
  }
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${feedToken}`,
      "User-Agent": "OddsFront-Vercel/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OddsFront VPS feed returned ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return new Map();
  const assets = (payload as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) return new Map();
  const coins = new Map<string, DropstabApiCoin>();
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const record = asset as Record<string, unknown>;
    const slug = typeof record.slug === "string" ? record.slug : "";
    if (!MARKET_STRIP_SLUGS.has(slug)) continue;
    const price = toPositiveFiniteNumber(record.price);
    const priceChange24h = toFiniteNumber(record.priceChange24h);
    if (price === null || priceChange24h === null) continue;
    coins.set(slug, {
      slug,
      name: record.name,
      symbol: record.sourceSymbol,
      price,
      priceChange24h,
    });
  }
  return coins;
}

async function fetchApiCoin(
  definition: MarketStripDefinition,
  apiKey: string,
): Promise<DropstabApiCoin | null> {
  const url = new URL(
    `${DROPSTAB_API_BASE}/coins/detailed/${definition.slug}`,
  );
  url.searchParams.set("currency", "USD");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OddsFront/1.0",
      "x-dropstab-api-key": apiKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`DropsTab API returned ${response.status}`);
  }
  const payload = (await response.json()) as DropstabApiResponse;
  if (payload.failure === true || !payload.data) return null;
  return payload.data;
}

function unavailableFeed(now = new Date()): MarketStripFeed {
  return {
    dataMode: "unavailable",
    updatedAt: now.toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    sourceLabel: "DropsTab",
    assets: MARKET_STRIP_DEFINITIONS.map((definition) =>
      buildAsset(definition, null),
    ),
  };
}

async function buildLiveMarketStrip(): Promise<MarketStripFeed> {
  const now = new Date();
  const apiKey = process.env.DROPSTAB_API_KEY?.trim() ?? "";
  const coins = new Map<string, DropstabApiCoin>();

  try {
    const vpsCoins = await fetchVpsCoins();
    for (const [slug, coin] of vpsCoins) coins.set(slug, coin);
  } catch {
    // Continue through the public read-only fallbacks below.
  }

  if (coins.size < MARKET_STRIP_DEFINITIONS.length && apiKey) {
    const apiCoins = await Promise.all(
      MARKET_STRIP_DEFINITIONS.map(async (definition) => {
        try {
          return await fetchApiCoin(definition, apiKey);
        } catch {
          return null;
        }
      }),
    );
    apiCoins.forEach((coin, index) => {
      if (hasUsableMarketValues(coin)) {
        coins.set(MARKET_STRIP_DEFINITIONS[index]!.slug, coin);
      }
    });
  }

  if (coins.size < MARKET_STRIP_DEFINITIONS.length) {
    try {
      const tradfiCoins = await fetchPageCoins(DROPSTAB_TRADFI_URL);
      for (const [slug, coin] of tradfiCoins) {
        if (!coins.has(slug)) coins.set(slug, coin);
      }
    } catch {
      // The cached VPS and public read-only fallbacks remain available below.
    }
  }

  if (coins.size < MARKET_STRIP_DEFINITIONS.length) {
    const [readerResult, yahooResult] = await Promise.allSettled([
      fetchReaderTradfiCoins(),
      fetchYahooCoins(),
    ]);
    if (readerResult.status === "fulfilled") {
      for (const [slug, coin] of readerResult.value) {
        if (!coins.has(slug)) coins.set(slug, coin);
      }
    }
    if (yahooResult.status === "fulfilled") {
      for (const [slug, coin] of yahooResult.value) {
        if (!coins.has(slug)) coins.set(slug, coin);
      }
    }
  }

  const assets = MARKET_STRIP_DEFINITIONS.map((definition) =>
    buildAsset(definition, coins.get(definition.slug) ?? null),
  );
  const liveAssetCount = assets.filter(
    (asset) => asset.price !== null && asset.priceChange24h !== null,
  ).length;
  if (liveAssetCount === 0) {
    throw new Error("DropsTab market strip returned no live asset values");
  }
  return {
    dataMode: liveAssetCount === assets.length ? "live" : "partial",
    updatedAt: now.toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    sourceLabel: "DropsTab",
    assets,
  };
}

const getCachedMarketStrip = unstable_cache(
  buildLiveMarketStrip,
  ["oddsfront-dropstab-market-strip-v4"],
  {
    revalidate: REFRESH_SECONDS,
    tags: ["oddsfront-dropstab-market-strip"],
  },
);

let marketStripRefreshInFlight: Promise<MarketStripFeed> | null = null;

export async function getDropstabMarketStrip(): Promise<MarketStripFeed> {
  if (marketStripRefreshInFlight) return marketStripRefreshInFlight;
  const request = (async () => {
    try {
      return await getCachedMarketStrip();
    } catch (error) {
      console.warn(
        "DropsTab market strip unavailable; returning link-only feed.",
        error instanceof Error ? error.message : "Unknown error",
      );
      return unavailableFeed();
    }
  })();
  marketStripRefreshInFlight = request;
  try {
    return await request;
  } finally {
    if (marketStripRefreshInFlight === request) {
      marketStripRefreshInFlight = null;
    }
  }
}

export function getDropstabMarketStripFixture(): MarketStripFeed {
  const sampleValues: ReadonlyArray<[number, number]> = [
    [64_970.99, -0.09],
    [4_345.7, 0.43],
    [63.85, -0.41],
    [6.64, 0],
    [81.93, 0.31],
    [7_745.5, 0.26],
    [223.76, 1.11],
    [312.57, 0.24],
    [133.57, 15.18],
    [1_919.54, 0.24],
  ];
  return {
    dataMode: "live",
    updatedAt: "2026-08-08T00:00:00.000Z",
    refreshSeconds: REFRESH_SECONDS,
    sourceLabel: "DropsTab fixture",
    assets: MARKET_STRIP_DEFINITIONS.map((definition, index) => {
      const [price, priceChange24h] = sampleValues[index]!;
      return {
        ...buildAsset(definition, {
          slug: definition.slug,
          name: definition.fallbackName,
          symbol: definition.displaySymbol,
          price,
          priceChange24h,
        }),
      };
    }),
  };
}
