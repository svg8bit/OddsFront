import { createHmac, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export interface XCredentials { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string; }
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export async function xCredentials(file: string): Promise<XCredentials> {
  const info = await stat(file);
  if ((info.mode & 0o077) !== 0) throw new Error("X credential file must be private");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const named = (key: string) => lines.filter(line => line.startsWith(`${key}=`)).at(-1)?.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2") || "";
  // Only the four explicitly authorized @alotofbit keys are read. No environment is imported.
  const result = { apiKey: named("X_API_KEY"), apiSecret: named("X_API_SECRET"), accessToken: named("X_ACCESS_TOKEN"), accessSecret: named("X_ACCESS_TOKEN_SECRET") };
  if (Object.values(result).some(value => !value)) throw new Error("Named X credentials are missing");
  return result;
}

export function xAuthorization(method: string, target: string, credentials: XCredentials): string {
  const url = new URL(target);
  const oauth: Record<string, string> = { oauth_consumer_key: credentials.apiKey, oauth_nonce: randomBytes(18).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1_000)), oauth_token: credentials.accessToken, oauth_version: "1.0" };
  const parameters = [...url.searchParams.entries(), ...Object.entries(oauth)].map(([key, value]) => [encode(key), encode(value)] as const).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("&");
  const base = [method.toUpperCase(), `${url.origin}${url.pathname}`, parameters].map(encode).join("&");
  oauth.oauth_signature = createHmac("sha1", `${encode(credentials.apiSecret)}&${encode(credentials.accessSecret)}`).update(base).digest("base64");
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ")}`;
}

export async function xRequest(credentials: XCredentials, method: string, pathname: string, body?: Record<string, unknown>) {
  const target = new URL(pathname, "https://api.x.com");
  if (target.origin !== "https://api.x.com") throw new Error("Invalid X endpoint");
  let response: Response;
  try { response = await fetch(target, { method, headers: { Authorization: xAuthorization(method, target.href, credentials), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error(`X ${method} transport failed`); }
  const data = await response.json();
  if (!response.ok) throw new Error(`X ${method} ${target.pathname} rejected (${response.status}): ${String(data.title || data.detail || "Request failed").slice(0, 150)}`);
  return data;
}
