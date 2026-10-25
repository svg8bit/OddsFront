import { buildHmacSignature } from "@polymarket/client";
import { MAX_BUILDER_SIGNING_BODY_BYTES, parseBuilderSigningPayload, relayerSubmissionBelongsTo } from "@/lib/telegram-app/builder-signing";
import { builderCredentials } from "@/lib/telegram-app/config";
import { WindowLimiter } from "@/lib/telegram-app/rate-limit";
import { clientIp, isSameOriginBrowserRequest, privateJson } from "@/lib/telegram-app/request";
import { sessionFromRequest } from "@/lib/telegram-app/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60_000;
// Builder signing is a cheap HMAC; the per-IP limit only guards against abuse (claiming winnings and
// order polling sign many requests a minute).
const signingPerIp = new WindowLimiter(400, 60_000);
// Gas-sponsored wallet operations: per Telegram user and for this whole server instance per day.
const relayerPerUser = new WindowLimiter(40, DAY_MS);
const relayerTotal = new WindowLimiter(3_000, DAY_MS, 1);

/** Builder authentication headers for the phone's Polymarket client; the builder secret stays here. */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return privateJson({ error: "Cross-origin builder signing is not allowed." }, 403);
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_BUILDER_SIGNING_BODY_BYTES) return privateJson({ error: "Builder signing payload is too large." }, 413);
  if (!signingPerIp.take(clientIp(request))) return privateJson({ error: "Builder signing rate limited." }, 429, { "Retry-After": "10" });

  const session = sessionFromRequest(request);
  if (!session) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  const credentials = builderCredentials();
  if (!credentials) return privateJson({ error: "Builder signing is not configured." }, 503);

  const payload = parseBuilderSigningPayload(await request.json().catch(() => null));
  if (!payload) return privateJson({ error: "Unsupported builder signing request." }, 400);
  if (payload.scope === "relayer-submit") {
    if (!relayerSubmissionBelongsTo(payload, session.owner)) return privateJson({ error: "This wallet action is not allowed." }, 403);
    if (!relayerPerUser.take(session.user)) return privateJson({ error: "Daily wallet action limit reached. Try again tomorrow." }, 429);
    if (!relayerTotal.take("all")) return privateJson({ error: "Daily relayer limit reached. Try again tomorrow." }, 429);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await buildHmacSignature(credentials.secret, timestamp, payload.method, payload.path, payload.body);
  return privateJson({
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: String(timestamp),
    POLY_BUILDER_API_KEY: credentials.key,
    POLY_BUILDER_PASSPHRASE: credentials.passphrase,
  });
}
