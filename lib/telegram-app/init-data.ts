import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/**
 * Telegram Mini App sign-in (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Telegram signs initData twice: an HMAC keyed by the bot token and an Ed25519 signature anyone can
 * check with Telegram's public key and the bot id. The Ed25519 path needs no secret, so it is the
 * default; the HMAC path is used when a bot token is configured.
 */

const MAX_INIT_DATA_LENGTH = 4_096;
export const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

/** Telegram's published Ed25519 keys for third-party initData validation (hex). */
export const TELEGRAM_INIT_DATA_PUBLIC_KEYS = {
  production: "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  test: "40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec",
} as const;

/** @DropsAnalyticsAIbot, the bot behind the OddsFront channels and their Mini App. */
export const ODDSFRONT_MINI_APP_BOT_ID = "8783764515";
export const ODDSFRONT_MINI_APP_BOT_USERNAME = "DropsAnalyticsAIbot";

export type InitDataConfig = { botId: string; botToken: string; publicKeyHex: string };

export type TelegramLogin = {
  userId: string;
  firstName: string;
  username: string;
  languageCode: string;
  startParam: string;
  authDate: number;
};

type Env = Record<string, string | undefined>;

export function initDataConfig(env: Env = process.env): InitDataConfig | null {
  const botToken = (env.ODDSFRONT_TG_BOT_TOKEN || "").trim();
  const botId = (env.ODDSFRONT_TG_BOT_ID || botToken.split(":")[0] || ODDSFRONT_MINI_APP_BOT_ID).trim();
  if (!/^\d{5,20}$/.test(botId)) return null;
  const publicKeyHex = env.ODDSFRONT_TG_TEST_ENV === "true" ? TELEGRAM_INIT_DATA_PUBLIC_KEYS.test : TELEGRAM_INIT_DATA_PUBLIC_KEYS.production;
  return { botId, botToken, publicKeyHex };
}

function checkString(params: URLSearchParams, excluded: string[]) {
  return Array.from(params.entries())
    .filter(([key]) => !excluded.includes(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function hmacValid(params: URLSearchParams, botToken: string) {
  const hash = params.get("hash") || "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const received = Buffer.from(hash, "hex");
  // Older clients hash every field; newer ones add the Ed25519 `signature` field to the hashed string.
  return [["hash"], ["hash", "signature"]].some((excluded) => {
    const expected = createHmac("sha256", secret).update(checkString(params, excluded)).digest();
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

function signatureValid(params: URLSearchParams, botId: string, publicKeyHex: string) {
  const signature = params.get("signature") || "";
  if (!/^[A-Za-z0-9_-]{80,90}$/.test(signature)) return false;
  const message = `${botId}:WebAppData\n${checkString(params, ["hash", "signature"])}`;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKeyHex, "hex").toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message), key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

/** The verified Telegram user, or null when the data is forged, stale, from another bot or not from a user. */
export function verifyInitData(initData: unknown, config: InitDataConfig, nowSeconds = Math.floor(Date.now() / 1000)): TelegramLogin | null {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA_LENGTH) return null;
  const params = new URLSearchParams(initData);
  const valid = config.botToken ? hmacValid(params, config.botToken) : signatureValid(params, config.botId, config.publicKeyHex);
  if (!valid) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS || authDate - nowSeconds > 60) return null;

  let user: Record<string, unknown> | null;
  try {
    user = JSON.parse(params.get("user") || "null") as Record<string, unknown> | null;
  } catch {
    return null;
  }
  const id = typeof user?.id === "number" || typeof user?.id === "string" ? String(user.id) : "";
  if (!/^\d{1,20}$/.test(id)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 64) : "");
  return {
    userId: id,
    firstName: text(user?.first_name),
    username: text(user?.username),
    languageCode: text(user?.language_code),
    startParam: (params.get("start_param") || "").slice(0, 512),
    authDate,
  };
}
