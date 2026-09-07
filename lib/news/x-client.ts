import { createHmac, randomBytes } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";

export interface XOAuth1Credentials { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string; }
export interface XOAuth2Credentials { oauth2: true; clientId: string; clientSecret: string; accessToken: string; refreshToken: string; expiresAt: number; file: string; }
export type XCredentials = XOAuth1Credentials | XOAuth2Credentials;
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export async function xCredentials(file: string): Promise<XCredentials> {
  const info = await stat(file);
  if ((info.mode & 0o077) !== 0) throw new Error("X credential file must be private");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const named = (key: string) => lines.filter(line => line.startsWith(`${key}=`)).at(-1)?.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2") || "";
  if (lines.some(line => line.startsWith("X_OAUTH2_"))) {
    const result: XOAuth2Credentials = { oauth2: true, clientId: named("X_OAUTH2_CLIENT_ID"), clientSecret: named("X_OAUTH2_CLIENT_SECRET"), accessToken: named("X_OAUTH2_ACCESS_TOKEN"), refreshToken: named("X_OAUTH2_REFRESH_TOKEN"), expiresAt: Number(named("X_OAUTH2_EXPIRES_AT")), file };
    if (!result.clientId || !result.clientSecret || !result.accessToken || !result.refreshToken || !Number.isFinite(result.expiresAt) || result.expiresAt <= 0) throw new Error("Named X OAuth2 credentials are missing");
    return result;
  }
  // Only the four explicitly authorized @alotofbit keys are read. No environment is imported.
  const result = { apiKey: named("X_API_KEY"), apiSecret: named("X_API_SECRET"), accessToken: named("X_ACCESS_TOKEN"), accessSecret: named("X_ACCESS_TOKEN_SECRET") };
  if (Object.values(result).some(value => !value)) throw new Error("Named X credentials are missing");
  return result;
}

export function xAuthorization(method: string, target: string, credentials: XOAuth1Credentials): string {
  const url = new URL(target);
  const oauth: Record<string, string> = { oauth_consumer_key: credentials.apiKey, oauth_nonce: randomBytes(18).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1_000)), oauth_token: credentials.accessToken, oauth_version: "1.0" };
  const parameters = [...url.searchParams.entries(), ...Object.entries(oauth)].map(([key, value]) => [encode(key), encode(value)] as const).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("&");
  const base = [method.toUpperCase(), `${url.origin}${url.pathname}`, parameters].map(encode).join("&");
  oauth.oauth_signature = createHmac("sha1", `${encode(credentials.apiSecret)}&${encode(credentials.accessSecret)}`).update(base).digest("base64");
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ")}`;
}

async function refreshOAuth2(credentials: XOAuth2Credentials) {
  const temporary = `${credentials.file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  // Reserve writable private storage before consuming a rotating refresh token.
  // A read-only service mount must fail before the provider invalidates it.
  const storage = await open(temporary, "wx", 0o600);
  try {
    // Allocate and flush data blocks too: creating an empty file alone can
    // succeed when the filesystem cannot store the replacement credentials.
    const reservation = Buffer.alloc(64 * 1024);
    const reserved = await storage.write(reservation, 0, reservation.length, 0);
    if (reserved.bytesWritten !== reservation.length) throw new Error("X credential storage reservation is incomplete");
    await storage.sync();
    let response: Response;
    try {
      response = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new Error("X OAuth2 refresh transport failed"); }
    if (!response.ok) throw new Error(`X OAuth2 refresh rejected (${response.status})`);
    const tokens = await response.json();
    const validToken = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\r\n\0]/.test(value);
    if (!validToken(tokens.access_token) || !validToken(tokens.refresh_token) || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error("Invalid X OAuth2 refresh response");
    const next = { ...credentials, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1_000 };
    const content = Object.entries({ X_OAUTH2_CLIENT_ID: next.clientId, X_OAUTH2_CLIENT_SECRET: next.clientSecret, X_OAUTH2_ACCESS_TOKEN: next.accessToken, X_OAUTH2_REFRESH_TOKEN: next.refreshToken, X_OAUTH2_EXPIRES_AT: String(next.expiresAt) }).map(([key, value]) => `${key}=${value}\n`).join("");
    // The positional reservation left this handle's write cursor at byte zero.
    await storage.writeFile(content);
    await storage.truncate(Buffer.byteLength(content));
    await storage.sync();
    await rename(temporary, credentials.file);
    // The publisher holds its process lock across refresh, send and receipt writes.
    Object.assign(credentials, next);
  } finally {
    await storage.close();
    await unlink(temporary).catch(() => {});
  }
}

export async function xRequest(credentials: XCredentials, method: string, pathname: string, body?: Record<string, unknown>) {
  const target = new URL(pathname, "https://api.x.com");
  if (target.origin !== "https://api.x.com") throw new Error("Invalid X endpoint");
  if ("oauth2" in credentials && credentials.expiresAt <= Date.now() + 60_000) await refreshOAuth2(credentials);
  const authorization = "oauth2" in credentials ? `Bearer ${credentials.accessToken}` : xAuthorization(method, target.href, credentials);
  let response: Response;
  try { response = await fetch(target, { method, headers: { Authorization: authorization, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error(`X ${method} transport failed`); }
  const data = await response.json();
  if (!response.ok) throw new Error(`X ${method} ${target.pathname} rejected (${response.status}): ${String(data.title || data.detail || "Request failed").slice(0, 150)}`);
  return data;
}
