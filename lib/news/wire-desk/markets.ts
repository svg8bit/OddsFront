// Live Polymarket context for an article: the markets found by the editor's
// searches, as liquid binary markets with their current Yes chance. The writer
// may cite one of them; numbers are always taken from here, never invented.
import { DEFAULT_MARKET_POLICY, marketsById, normalizeMarket, searchMarkets, type GammaEvent, type GammaMarket, type HotDeskMarket, type MarketPolicy } from "../hot-desk/markets.ts";
import { headlineTokens, similarTokens } from "../hot-desk/headlines.ts";
import { sameMarketTheme } from "../hot-desk/state.ts";
import type { ArticleMarket } from "../types.ts";

export type StoryMarket = HotDeskMarket & { queries: string[] };

export async function storyMarkets(queries: readonly string[], policy: MarketPolicy = DEFAULT_MARKET_POLICY, now = Date.now(), limit = 6): Promise<StoryMarket[]> {
  if (!queries.length) return [];
  const found = await Promise.all(queries.map(query => searchMarkets(query).then(pairs => pairs.map(pair => ({ ...pair, query })))));
  const first = new Map<string, { raw: GammaMarket; event: GammaEvent; queries: Set<string> }>();
  for (const pair of found.flat()) {
    const id = typeof pair.raw.id === "string" || typeof pair.raw.id === "number" ? String(pair.raw.id) : "";
    if (!id || !normalizeMarket(pair.raw, pair.event, { ...policy, minVolume: 0, minLiquidity: 0, maxSpread: 1 }, now)) continue;
    const entry = first.get(id) ?? { raw: pair.raw, event: pair.event, queries: new Set<string>() };
    entry.queries.add(pair.query);
    first.set(id, entry);
  }
  const full = await marketsById([...first.keys()]);
  const markets: StoryMarket[] = [];
  for (const [id, entry] of first) {
    const market = normalizeMarket(full.get(id) ?? entry.raw, entry.event, policy, now);
    if (market) markets.push({ ...market, queries: [...entry.queries] });
  }
  return markets.toSorted((a, b) => b.queries.length - a.queries.length || b.volume - a.volume).slice(0, limit);
}

/** "23%", "4.5%", "97.5%": whole percent between 10 and 90, one decimal outside. */
export function percentText(price: number, locale: "en" | "ru" = "en") {
  const percent = price * 100;
  const rounded = Number(percent.toFixed(percent < 9.95 || percent > 90.05 ? 1 : 0)).toString();
  return `${locale === "ru" ? rounded.replace(".", ",") : rounded}%`;
}

/** What the writer sees of a market: question, chance and the level a day and a week ago, all in percent. */
export function marketBrief(market: StoryMarket) {
  const ago = (change: number | null) => (change === null || Math.abs(change) < 0.01 ? undefined : percentText(Math.min(0.999, Math.max(0.001, market.chance - change))));
  return {
    marketId: market.id,
    question: market.question,
    event: market.eventTitle !== market.question ? market.eventTitle : undefined,
    yesChance: percentText(market.chance),
    yesChanceRu: percentText(market.chance, "ru"),
    dayAgo: ago(market.dayChange),
    weekAgo: ago(market.weekChange),
    volumeUsd: Math.round(market.volume),
    endDate: market.endDate.slice(0, 10),
  };
}

/**
 * The markets an article shows beside it: the one the writer cited (it asks about exactly this
 * development), then search hits (already found by the story's own queries) whose question shares at
 * least two word stems with the story. A hit that only shares a country never qualifies, so an article
 * without a real market shows none.
 */
export function articleMarkets(markets: readonly StoryMarket[], citedId: string | null, story: { title: string; development: string; topics: readonly string[] }, limit = 3): ArticleMarket[] {
  const storyTokens = [...new Set([...headlineTokens(story.title), ...headlineTokens(story.development), ...story.topics.flatMap(topic => headlineTokens(topic))])];
  const cited = citedId ? markets.find(market => market.id === citedId) : undefined;
  const shared = (market: StoryMarket) => headlineTokens(`${market.question} ${market.eventTitle}`).filter(token => storyTokens.some(other => similarTokens(token, other))).length;
  const related = markets.filter(market => market.id !== citedId && shared(market) >= 2)
    .toSorted((a, b) => b.queries.length - a.queries.length || b.volume - a.volume);
  // One market per theme: "ceasefire by October 31" and "ceasefire by December 31" are one card.
  const chosen: StoryMarket[] = [];
  for (const market of [...(cited ? [cited] : []), ...related]) {
    if (chosen.length < limit && !chosen.some(other => sameMarketTheme(other.question, market.question))) chosen.push(market);
  }
  return chosen.map(market => ({
    id: market.id, question: market.question, eventTitle: market.eventTitle !== market.question ? market.eventTitle : undefined, eventSlug: market.eventSlug,
    conditionId: market.conditionId, yesTokenId: market.yesTokenId, image: market.image, chance: market.chance, weekChange: market.weekChange,
    volume: Math.round(market.volume), endDate: market.endDate,
  }));
}
