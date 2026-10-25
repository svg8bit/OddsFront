import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The Mini App session: a signed, HttpOnly cookie, no database. It names the verified Telegram user
 * and, once the phone proved its key, the owner address and the deposit wallet that key controls.
 * Every money route reads the wallet from here, never from the request body.
 */

export const SESSION_COOKIE = "of_tg_session";
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

export type TelegramSession = {
  /** Telegram user id. */
  user: string;
  /** Owner key address (lower case), set once the phone proved it holds the key. */
  owner?: string;
  /** The deposit wallet that owner controls (lower case). */
  wallet?: string;
  /** Expiry, unix seconds. */
  expires: number;
};

type Env = Record<string, string | undefined>;

export function sessionSecret(env: Env = process.env) {
  const secret = (env.ODDSFRONT_TG_SESSION_SECRET || "").trim();
  return secret.length >= 32 ? secret : "";
}

function mac(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`of-tg-session:${payload}`).digest("base64url");
}

export function encodeSession(session: TelegramSession, secret: string) {
  const payload = Buffer.from(JSON.stringify({ u: session.user, o: session.owner, w: session.wallet, e: session.expires })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export function decodeSession(value: string | undefined | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): TelegramSession | null {
  if (!value || !secret || value.length > 1_024) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  let raw: { u?: unknown; o?: unknown; w?: unknown; e?: unknown };
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof raw;
  } catch {
    return null;
  }
  if (typeof raw.u !== "string" || !/^\d{1,20}$/.test(raw.u) || typeof raw.e !== "number" || raw.e < nowSeconds) return null;
  const owner = typeof raw.o === "string" && EVM_ADDRESS.test(raw.o) ? raw.o : undefined;
  const wallet = owner && typeof raw.w === "string" && EVM_ADDRESS.test(raw.w) ? raw.w : undefined;
  return { user: raw.u, ...(owner ? { owner } : {}), ...(wallet ? { wallet } : {}), expires: raw.e };
}

export function readCookie(header: string | null, name = SESSION_COOKIE) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionFromRequest(request: Request, env: Env = process.env) {
  return decodeSession(readCookie(request.headers.get("cookie")), sessionSecret(env));
}

/**
 * Telegram Web shows the app in an iframe on web.telegram.org, a third-party context, so the cookie is
 * SameSite=None and Partitioned; the phone apps open the page directly and accept it as first-party.
 */
export function sessionCookieHeader(session: TelegramSession, secret: string) {
  const maxAge = Math.max(0, session.expires - Math.floor(Date.now() / 1000));
  return `${SESSION_COOKIE}=${encodeSession(session, secret)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`;
}
