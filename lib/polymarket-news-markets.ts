import { unstable_cache } from "next/cache";

import type { ConflictPreviewEvent, ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { buildPolymarketEventUrl } from "@/lib/polymarket-links";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events/keyset";
const GAMMA_DOCS_URL = "https://docs.polymarket.com/market-data/fetching-markets";
const REFRESH_SECONDS = 60;
const PAGE_SIZE = 100;
const MAX_PAGES = 6;
const MINIMUM_VOLUME = 25_000;

interface GammaMarket {
  id?: string; conditionId?: string | null; question?: string; outcomes?: unknown; outcomePrices?: unknown;
  clobTokenIds?: unknown; volume?: string | number | null; volume24hr?: string | number | null;
  liquidity?: string | number | null; active?: boolean; closed?: boolean; archived?: boolean;
  acceptingOrders?: boolean; endDate?: string | null; updatedAt?: string | null;
  oneHourPriceChange?: string | number | null; oneDayPriceChange?: string | number | null;
  oneWeekPriceChange?: string | number | null; image?: string | null; icon?: string | null;
}
interface GammaEvent {
  id?: string; title?: string; slug?: string; active?: boolean; closed?: boolean; archived?: boolean;
  volume?: string | number | null; volume24hr?: string | number | null; liquidity?: string | number | null;
  updatedAt?: string | null; image?: string | null; icon?: string | null; markets?: GammaMarket[] | null;
}
interface GammaKeysetResponse { events?: GammaEvent[] | null; next_cursor?: string | null }

function finite(value: string | number | null | undefined) {
  const number = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(number) ? number : 0;
}
function optionalFinite(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}
function stringArray(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === "string") ? parsed : null;
  } catch { return null; }
}
function binaryOdds(market: GammaMarket) {
  const outcomes = stringArray(market.outcomes);
  const prices = stringArray(market.outcomePrices)?.map(Number);
  if (!outcomes || !prices || outcomes.length !== prices.length) return null;
  const yi = outcomes.findIndex(outcome => outcome.toLowerCase() === "yes");
  const ni = outcomes.findIndex(outcome => outcome.toLowerCase() === "no");
  if (yi < 0 || ni < 0) return null;
  const y = prices[yi], n = prices[ni];
  if (!Number.isFinite(y) || !Number.isFinite(n) || y + n <= 0) return null;
  const yes = Math.round((y / (y + n)) * 100);
  return { yes, no: 100 - yes };
}
function yesTokenId(market: GammaMarket) {
  const outcomes=stringArray(market.outcomes), tokens=stringArray(market.clobTokenIds);
  if (!outcomes || !tokens || outcomes.length !== tokens.length) return null;
  const index=outcomes.findIndex(outcome=>outcome.toLowerCase()==="yes");
  const token=index>=0?tokens[index]?.trim():"";
  return token && /^\d{8,}$/.test(token) ? token : null;
}
function safeImage(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url=new URL(value);
    return url.protocol==="https:" && !url.username && !url.password &&
      url.hostname==="polymarket-upload.s3.us-east-2.amazonaws.com" ? url.toString() : null;
  } catch { return null; }
}
function activeDeadline(value: string | null | undefined) {
  if (!value) return null;
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp) && timestamp>Date.now() ? value : null;
}
function normalize(event: GammaEvent): ConflictPreviewEvent | null {
  if (!event.id || !event.title || !event.active || event.closed || event.archived || finite(event.volume)<MINIMUM_VOLUME) return null;
  const selected=(event.markets??[])
    .map(market=>({market,odds:binaryOdds(market)}))
    .filter((entry): entry is {market:GammaMarket;odds:{yes:number;no:number}} => Boolean(
      entry.market.id && entry.market.question && entry.market.active && !entry.market.closed && !entry.market.archived &&
      entry.market.acceptingOrders!==false && entry.odds && entry.odds.yes>0 && entry.odds.no>0 &&
      (!entry.market.endDate || activeDeadline(entry.market.endDate))
    ))
    .sort((a,b)=>finite(b.market.volume)-finite(a.market.volume)||finite(b.market.volume24hr)-finite(a.market.volume24hr))[0];
  if (!selected) return null;
  const market=selected.market, eventVolume=finite(event.volume);
  return {
    id:`polymarket-${event.id}`, title:String(market.question).replace(/\s+/g," ").trim(), region:"Global",
    coordinates:[0,0], countryCodes:[], countryFeatureIds:[], yesOdds:selected.odds.yes, noOdds:selected.odds.no,
    volume:eventVolume, marketVolume:finite(market.volume), tone:"violet",
    severity:eventVolume>=10_000_000?"critical":eventVolume>=1_000_000?"high":"elevated",
    regionPolygon:[], popupOffset:[0,0], locationId:`global-${event.id}`, locationLabel:"Prediction market",
    minimumZoom:0, dataOrigin:"polymarket", evidenceStatus:"regional-anchor", geographyKind:"regional",
    marketUrl:buildPolymarketEventUrl(event.slug),
    imageUrl:[market.image,market.icon,event.image,event.icon].map(safeImage).find((value):value is string=>value!==null)??null,
    updatedAt:market.updatedAt??event.updatedAt??new Date().toISOString(), sourceLabel:"Polymarket Gamma API",
    volume24h:finite(market.volume24hr??event.volume24hr), liquidity:finite(market.liquidity??event.liquidity),
    priceChange1h:optionalFinite(market.oneHourPriceChange), priceChange24h:optionalFinite(market.oneDayPriceChange),
    priceChange7d:optionalFinite(market.oneWeekPriceChange), endDate:activeDeadline(market.endDate),
    marketConditionId:typeof market.conditionId==="string"&&/^0x[a-f0-9]{64}$/i.test(market.conditionId)?market.conditionId.toLowerCase():null,
    yesTokenId:yesTokenId(market),
  };
}
async function buildFeed(): Promise<ConflictPreviewFeed> {
  const events:GammaEvent[]=[]; let cursor="";
  for(let page=0;page<MAX_PAGES;page+=1){
    const url=new URL(GAMMA_EVENTS_URL);
    url.searchParams.set("limit",String(PAGE_SIZE)); url.searchParams.set("active","true"); url.searchParams.set("closed","false");
    url.searchParams.set("volume_min",String(MINIMUM_VOLUME)); url.searchParams.set("order","volume"); url.searchParams.set("ascending","false");
    if(cursor)url.searchParams.set("after_cursor",cursor);
    const response=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"},signal:AbortSignal.timeout(5_000)});
    if(!response.ok)throw new Error(`Polymarket market feed failed with ${response.status}`);
    const payload=await response.json() as GammaKeysetResponse; const pageEvents=payload.events??[];
    events.push(...pageEvents); cursor=payload.next_cursor??""; if(!cursor||!pageEvents.length)break;
  }
  const normalized=events.map(normalize).filter((event):event is ConflictPreviewEvent=>Boolean(event))
    .sort((a,b)=>b.volume-a.volume||b.volume24h-a.volume24h);
  return {dataMode:"live",updatedAt:new Date().toISOString(),refreshSeconds:REFRESH_SECONDS,minimumVolume:MINIMUM_VOLUME,
    sourceLabel:"Polymarket Gamma API",sourceUrl:GAMMA_DOCS_URL,events:normalized,excludedCount:events.length-normalized.length};
}
const cachedFeed=unstable_cache(buildFeed,["homoludens-news-market-feed-v1"],{revalidate:REFRESH_SECONDS,tags:["homoludens-news-market-feed"]});

export async function getNewsMarketFeed(): Promise<ConflictPreviewFeed> {
  try{return await cachedFeed();}
  catch(error){
    console.warn("HomoLudens prediction-market feed unavailable.",error instanceof Error?error.message:"Unknown error");
    return {dataMode:"fallback",updatedAt:new Date().toISOString(),refreshSeconds:REFRESH_SECONDS,minimumVolume:MINIMUM_VOLUME,
      sourceLabel:"Polymarket Gamma API",sourceUrl:GAMMA_DOCS_URL,events:[],excludedCount:0};
  }
}
