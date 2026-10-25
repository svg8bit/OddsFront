/**
 * What the phone needs to trade: the builder code every order carries and whether betting is open for
 * this visitor. The builder API secret never leaves the server (see /api/tg/sign).
 */

export type MiniAppConfig = {
  builderCode: string;
  tradingEnabled: boolean;
  restrictedRegion: boolean;
};

type Env = Record<string, string | undefined>;

const DEFAULT_RESTRICTED_COUNTRIES = ["US"];
const DEFAULT_RESTRICTED_REGIONS = ["CA-ON", "CA-QC", "UA-43", "UA-14", "UA-09"];

export function isValidBuilderCode(value: string | undefined) {
  return /^0x[0-9a-fA-F]{64}$/.test(value || "");
}

export function builderCredentials(env: Env = process.env) {
  const key = (env.POLYMARKET_BUILDER_API_KEY || "").trim();
  const secret = (env.POLYMARKET_BUILDER_SECRET || "").trim();
  const passphrase = (env.POLYMARKET_BUILDER_PASSPHRASE || "").trim();
  return key && secret && passphrase ? { key, secret, passphrase } : null;
}

function listEnv(value: string | undefined, fallback: string[]) {
  const items = (value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  return items.length ? items : fallback;
}

/** Polymarket's restricted jurisdictions, from Vercel's IP geolocation headers. */
export function restrictedRegion(country?: string | null, region?: string | null, env: Env = process.env) {
  const countryCode = (country || "").trim().toUpperCase();
  const regionCode = (region || "").trim().toUpperCase();
  if (!countryCode) return false;
  if (listEnv(env.POLYMARKET_RESTRICTED_COUNTRIES, DEFAULT_RESTRICTED_COUNTRIES).includes(countryCode)) return true;
  return Boolean(regionCode) && listEnv(env.POLYMARKET_RESTRICTED_REGIONS, DEFAULT_RESTRICTED_REGIONS).includes(`${countryCode}-${regionCode}`);
}

export function miniAppConfig(headers: Headers, env: Env = process.env): MiniAppConfig {
  const builderCode = (env.POLYMARKET_BUILDER_CODE || "").trim();
  const configured = isValidBuilderCode(builderCode) && Boolean(builderCredentials(env));
  return {
    builderCode: configured ? builderCode : "",
    tradingEnabled: configured && (env.POLYMARKET_TRADING_ENABLED || "").toLowerCase() === "true",
    restrictedRegion: restrictedRegion(
      headers.get("x-vercel-ip-country"),
      headers.get("x-vercel-ip-country-region"),
      env,
    ),
  };
}
