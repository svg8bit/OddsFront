import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";
import type { NewsArticle } from "./types";
const STOP_WORDS = new Set(["will", "before", "after", "about", "their", "there", "would", "could", "should", "which", "under", "over", "between"]);
export function relatedMarkets(article: Pick<NewsArticle, "title" | "countries" | "topics">, events: ConflictPreviewEvent[]) {
  const tokens = new Set(`${article.title} ${article.topics.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3 && !STOP_WORDS.has(word)));
  return events.filter(event => event.dataOrigin === "polymarket" && event.marketUrl && (!event.endDate || Date.parse(event.endDate) > Date.now()))
    .map(event => ({ event, score: event.countryCodes.filter(code => article.countries.includes(code)).length * 5 + event.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => tokens.has(word)).length * 2 }))
    .filter(item => item.score >= 4)
    .toSorted((left, right) => right.score - left.score || right.event.volume - left.event.volume)
    .slice(0, 4).map(item => item.event);
}
