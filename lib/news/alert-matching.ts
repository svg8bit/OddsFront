import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";
import { buildDropsBotTrackUrl, isOfficialPolymarketEventUrl } from "@/lib/polymarket-links";
import type { NewsArticle, NewsAlertKind } from "@/lib/news/types";

export const NEWS_ALERT_TTL_MS = 15 * 60 * 1_000;
export const NEWS_ALERT_MINIMUM_MARKET_VOLUME = 1_000_000;

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
    event.dataOrigin !== "polymarket" ||
    !isOfficialPolymarketEventUrl(event.marketUrl) ||
    !buildDropsBotTrackUrl(event.marketUrl)
  ) {
    return false;
  }
  const volume = event.marketVolume ?? event.volume;
  if (
    volume < NEWS_ALERT_MINIMUM_MARKET_VOLUME ||
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
    if (!article.alert) continue;
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
