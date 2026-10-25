/**
 * Which builder-authenticated Polymarket requests the app signs for the phone. The builder secret
 * stays on the server; the phone gets HMAC headers only for the CLOB, relayer and gateway calls the
 * official client makes for betting, wallet setup, winnings and withdrawals.
 */

export const MAX_BUILDER_SIGNING_BODY_BYTES = 128 * 1024;

export type BuilderSigningScope = "clob" | "relayer-read" | "relayer-submit";

export type BuilderSigningPayload = {
  method: "GET" | "POST";
  path: string;
  body?: string;
  scope: BuilderSigningScope;
};

const CLOB_GET_PATHS = [
  /^\/auth\/(?:derive-api-key|api-keys)$/,
  /^\/auth\/ban-status\/closed-only$/,
  /^\/(?:book|tick-size|neg-risk|price|balance-allowance|balance-allowance\/update|data\/orders)$/,
  /^\/(?:markets-by-token|clob-markets)\/[^/]+$/,
  /^\/fees\/builder-fees\/0x[0-9a-f]{64}$/i,
  /^\/v1\/account\/transactions\/(?:params|[^/]+)$/,
] as const;

const CLOB_POST_PATHS = [/^\/auth\/api-key$/, /^\/order$/] as const;

function classify(method: "GET" | "POST", path: string): BuilderSigningScope | null {
  const pathname = path.split("?", 1)[0];
  if (method === "POST" && pathname === "/submit") return "relayer-submit";
  if (method === "GET" && pathname === "/deployed") return "relayer-read";
  const rules = method === "GET" ? CLOB_GET_PATHS : CLOB_POST_PATHS;
  return rules.some((rule) => rule.test(pathname)) ? "clob" : null;
}

export function parseBuilderSigningPayload(input: unknown): BuilderSigningPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const payload = input as Record<string, unknown>;
  const { method, path, body } = payload;
  if ((method !== "GET" && method !== "POST") || typeof path !== "string") return null;
  if (!path.startsWith("/") || path.length > 2_048 || /[\r\n]|:\/\//.test(path)) return null;
  const scope = classify(method, path);
  if (!scope) return null;
  if (body !== undefined && typeof body !== "string") return null;
  if (typeof body === "string" && Buffer.byteLength(body, "utf8") > MAX_BUILDER_SIGNING_BODY_BYTES) return null;
  // CLOB API-key creation is the one bodyless POST: the user's own L1 signature travels in headers.
  const bodylessPost = scope === "clob" && path.split("?", 1)[0] === "/auth/api-key";
  if (method === "POST" && (!body || body.length === 0) && !bodylessPost) return null;
  return { method, path, ...(typeof body === "string" ? { body } : {}), scope };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A gas-sponsored relayer submission may only come from the session's own owner key, so the builder's
 * daily relayer budget cannot be spent on anybody else's wallet. The relayer and the deposit wallet
 * contract then check that the owner's signature controls the batch.
 */
export function relayerSubmissionBelongsTo(payload: BuilderSigningPayload, owner: string | undefined) {
  if (payload.scope !== "relayer-submit" || !payload.body || !owner) return false;
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payload.body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    body = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  const from = typeof body.from === "string" ? body.from : "";
  if (!EVM_ADDRESS.test(from)) return false;
  if (body.type !== "WALLET-CREATE" && body.type !== "WALLET") return false;
  return from.toLowerCase() === owner.toLowerCase();
}
