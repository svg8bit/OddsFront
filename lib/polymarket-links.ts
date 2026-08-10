export const POLYMARKET_REFERRAL_CODE = "drops1";
export const DROPSBOT_TRACK_PREFIX = "TRACKpm_";
export const MAX_DROPSBOT_TRACK_SLUG_LENGTH = 56;
export const DROPSBOT_HORMUZ_TRACK_URL =
  "https://t.me/Drops?start=pm_Hormuz";

const EVENT_SLUG_PATTERN = /^[a-z0-9-]+$/;
const EVENT_PATH_PATTERN = /^\/event\/([a-z0-9-]+)\/?$/;
const HORMUZ_EVENT_SLUG_PATTERN = /(?:^|-)hormuz(?:-|$)/;
const DROPSBOT_TRACK_URL = "https://t.me/Drops";

export function getPolymarketEventSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "polymarket.com" ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.pathname.match(EVENT_PATH_PATTERN)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildPolymarketEventUrl(slug: unknown): string | null {
  if (typeof slug !== "string" || !EVENT_SLUG_PATTERN.test(slug)) return null;
  return `https://polymarket.com/event/${slug}?via=${POLYMARKET_REFERRAL_CODE}`;
}

export function toPolymarketReferralUrl(value: unknown): string | null {
  return buildPolymarketEventUrl(getPolymarketEventSlug(value));
}

export function isOfficialPolymarketEventUrl(value: unknown): value is string {
  return toPolymarketReferralUrl(value) !== null;
}

export function buildDropsBotTrackUrl(value: unknown): string | null {
  const slug = getPolymarketEventSlug(value);
  if (!slug) return null;
  if (HORMUZ_EVENT_SLUG_PATTERN.test(slug)) {
    return DROPSBOT_HORMUZ_TRACK_URL;
  }
  if (slug.length > MAX_DROPSBOT_TRACK_SLUG_LENGTH) return null;

  const url = new URL(DROPSBOT_TRACK_URL);
  url.searchParams.set("start", `${DROPSBOT_TRACK_PREFIX}${slug}`);
  return url.toString();
}
