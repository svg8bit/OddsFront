import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";
import type { NewsArticle } from "./types";
const STOP_WORDS = new Set(["will", "before", "after", "about", "their", "there", "would", "could", "should", "which", "under", "over", "between", "world", "affairs", "says", "said", "news"]);
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3 && !STOP_WORDS.has(word));

/**
 * Map markets for an article that has no markets of its own. A market qualifies only by sharing at
 * least two words with the headline and topics; a shared country only breaks ties, so an article
 * about tariffs never shows NATO markets just because both mention the United States.
 */
export function relatedMarkets(article: Pick<NewsArticle, "title" | "countries" | "topics">, events: ConflictPreviewEvent[]) {
  const tokens = new Set(words(`${article.title} ${article.topics.join(" ")}`));
  return events.filter(event => event.dataOrigin === "polymarket" && event.marketUrl && (!event.endDate || Date.parse(event.endDate) > Date.now()))
    .map(event => ({ event, shared: new Set(words(event.title).filter(word => tokens.has(word))).size, countries: event.countryCodes.filter(code => article.countries.includes(code)).length }))
    .filter(item => item.shared >= 2)
    .toSorted((left, right) => right.shared - left.shared || right.countries - left.countries || right.event.volume - left.event.volume)
    .slice(0, 4).map(item => item.event);
}
