import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";
import { buildDropsBotTrackUrl, isOfficialPolymarketEventUrl } from "@/lib/polymarket-links";
import { isPolymarketActivityEventCurrent } from "@/lib/polymarket-activity-query";
import { isNewsPublisher, isOfficialSource, sourceHost } from "./sources";
import type { NewsArticle, NewsAlertKind } from "@/lib/news/types";

export const NEWS_ALERT_TTL_MS = 15 * 60 * 1_000;
export const NEWS_ALERT_MINIMUM_MARKET_VOLUME = 1_000_000;
export const NEWS_ACTIVITY_POOL_MS = 2 * 60 * 60_000;

export interface NewsActivityAlert {
  article: NewsArticle;
  event: ConflictPreviewEvent | null;
  publishedAt: number;
  expiresAt: number;
}

export interface NewsMarketAlert {
  article: NewsArticle;
  event: ConflictPreviewEvent;
  kind: NewsAlertKind;
  publishedAt: number;
  expiresAt: number;
}

const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  US: ["united states", "u.s.", "u.s", "us", "america", "american"],
  RU: ["russia", "russian"],
  UA: ["ukraine", "ukrainian"],
  IL: ["israel", "israeli"],
  PS: ["palestine", "palestinian", "gaza"],
  IR: ["iran", "iranian"],
  LB: ["lebanon", "lebanese", "hezbollah"],
  IQ: ["iraq", "iraqi"],
  SY: ["syria", "syrian"],
  YE: ["yemen", "yemeni", "houthi", "houthis"],
  IN: ["india", "indian"],
  PK: ["pakistan", "pakistani"],
  CN: ["china", "chinese"],
  TW: ["taiwan", "taiwanese"],
  KP: ["north korea", "north korean"],
  KR: ["south korea", "south korean"],
};
const STRIKE_PATTERN = /\b(?:air\s*strikes?|strikes?|struck|attacks?|attacked|bomb(?:s|ed|ing)?|missile\s+attacks?|military\s+(?:action|operation))\b/i;
const CEASEFIRE_PATTERN = /\b(?:ceasefire|truce)\b/i;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");
}

function aliasesPattern(code: string): string | null {
  const aliases = COUNTRY_ALIASES[code];
  return aliases?.length
    ? `(?:${aliases.map(escapePattern).join("|")})`
    : null;
}

function titleMentionsCountry(title: string, code: string): boolean {
  const pattern = aliasesPattern(code);
  return pattern ? new RegExp(`\\b${pattern}\\b`, "i").test(title) : false;
}

function strikeDirectionMatches(
  title: string,
  actorCountries: readonly string[],
  targetCountries: readonly string[],
): boolean {
  for (const actor of actorCountries) {
    const actorPattern = aliasesPattern(actor);
    if (!actorPattern) continue;
    for (const target of targetCountries) {
      const targetPattern = aliasesPattern(target);
      if (!targetPattern) continue;
      const directional = new RegExp(
        `\\b${actorPattern}\\b.{0,55}${STRIKE_PATTERN.source}.{0,65}\\b${targetPattern}\\b`,
        "i",
      );
      if (directional.test(title)) return true;
    }
  }
  return false;
}

function eventMatchesArticle(
  article: NewsArticle,
  event: ConflictPreviewEvent,
  now: number,
): boolean {
  const alert = article.alert;
  if (
    !alert ||
    article.withdrawal ||
    event.dataOrigin !== "polymarket" ||
    !isPolymarketActivityEventCurrent(event, now) ||
    !isOfficialPolymarketEventUrl(event.marketUrl) ||
    !buildDropsBotTrackUrl(event.marketUrl)
  ) {
    return false;
  }
  const volume = event.marketVolume ?? event.volume;
  if (
    !Number.isFinite(volume) || volume < NEWS_ALERT_MINIMUM_MARKET_VOLUME ||
    (event.endDate !== null && Date.parse(event.endDate) <= now)
  ) return false;

  const participants = new Set(event.countryCodes);
  if (
    !alert.actorCountries.some(code => participants.has(code)) ||
    !alert.targetCountries.some(code => participants.has(code))
  ) return false;

  if (alert.kind === "strike") {
    return STRIKE_PATTERN.test(event.title) && strikeDirectionMatches(
      event.title,
      alert.actorCountries,
      alert.targetCountries,
    );
  }
  return CEASEFIRE_PATTERN.test(event.title) &&
    alert.actorCountries.some(code => titleMentionsCountry(event.title, code)) &&
    alert.targetCountries.some(code => titleMentionsCountry(event.title, code));
}

export function buildNewsMarketAlerts(
  articles: readonly NewsArticle[],
  events: readonly ConflictPreviewEvent[],
  now = Date.now(),
): NewsMarketAlert[] {
  const alerts: NewsMarketAlert[] = [];
  for (const article of articles) {
    if (!article.alert || article.withdrawal) continue;
    const publishedAt = Date.parse(article.publishedAt);
    const expiresAt = publishedAt + NEWS_ALERT_TTL_MS;
    if (
      !Number.isFinite(publishedAt) ||
      publishedAt > now + 60_000 ||
      expiresAt <= now
    ) continue;

    const event = events
      .filter(candidate => eventMatchesArticle(article, candidate, now))
      .toSorted((left, right) =>
        (right.marketVolume ?? right.volume) - (left.marketVolume ?? left.volume) ||
        right.volume24h - left.volume24h ||
        left.id.localeCompare(right.id),
      )[0];
    if (event) {
      alerts.push({
        article,
        event,
        kind: article.alert.kind,
        publishedAt,
        expiresAt,
      });
    }
  }
  return alerts.toSorted((left, right) =>
    right.publishedAt - left.publishedAt ||
    (right.event.marketVolume ?? right.event.volume) -
      (left.event.marketVolume ?? left.event.volume),
  );
}

// News cards describe verified published reporting, not market-resolution or
// breaking-strike claims. A market is optional and still needs the strict
// direction/volume/current-event match above; country overlap alone is unused.
export function buildNewsActivityAlerts(articles: readonly NewsArticle[], events: readonly ConflictPreviewEvent[], now = Date.now()): NewsActivityAlert[] {
  const recent = articles.filter(article => {
    const publishedAt = Date.parse(article.publishedAt);
    if (article.withdrawal || !Number.isFinite(publishedAt) || publishedAt > now || now >= publishedAt + NEWS_ACTIVITY_POOL_MS) return false;
    const sources = Array.isArray(article.sources) ? article.sources : [];
    const media = sources.filter(source => source && source.kind === "media" && isNewsPublisher(source.url) &&
      Date.parse(source.publishedAt) <= now + 60_000 && Date.parse(source.publishedAt) >= now - 72 * 60 * 60_000);
    return media.length > 0 && sources.some(source => source && source.kind === "official" && isOfficialSource(source.url) && Date.parse(source.publishedAt) <= now + 60_000 && media.some(report => sourceHost(report.url) !== sourceHost(source.url)));
  }).toSorted((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  if (!recent.length) return [];
  const publishedAt = Date.parse(recent[0].publishedAt);
  const edition = [...new Map(recent.filter(article => Date.parse(article.publishedAt) === publishedAt).map(article => [article.id, article])).values()].slice(0, 9);
  const slotCount = NEWS_ACTIVITY_POOL_MS / NEWS_ALERT_TTL_MS;
  const slot = Math.floor((now - publishedAt) / NEWS_ALERT_TTL_MS);
  // Distribute all nine stories across eight quarters. Sparse editions leave
  // quiet slots instead of presenting the same story again as a new alert.
  const current = edition.slice(Math.ceil(slot * edition.length / slotCount), Math.ceil((slot + 1) * edition.length / slotCount));
  return current.map(article => ({
    article, publishedAt, expiresAt: publishedAt + (slot + 1) * NEWS_ALERT_TTL_MS,
    event: events.filter(event => eventMatchesArticle(article, event, now))
      .toSorted((a, b) => (b.marketVolume ?? b.volume) - (a.marketVolume ?? a.volume))[0] ?? null,
  }));
}
