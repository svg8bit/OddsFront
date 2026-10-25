import { isValidBuilderCode } from "@/lib/telegram-app/config";
import { POLYMARKET_BRIDGE_URL } from "@/lib/telegram-app/contracts";
import { isSameOriginBrowserRequest, privateJson } from "@/lib/telegram-app/request";
import { sessionFromRequest } from "@/lib/telegram-app/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-wallet deposit addresses (USDT/USDC on other networks, BTC) from the Polymarket bridge. */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return privateJson({ error: "Same-origin request required." }, 403);
  const session = sessionFromRequest(request);
  if (!session) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  // Money only ever lands on the session's own deposit wallet.
  if (!session.wallet) return privateJson({ error: "Telegram wallet is not ready yet." }, 409);
  const builderCode = (process.env.POLYMARKET_BUILDER_CODE || "").trim();
  const response = await fetch(`${POLYMARKET_BRIDGE_URL}/deposit`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...(isValidBuilderCode(builderCode) ? { "X-Builder-Code": builderCode } : {}) },
    body: JSON.stringify({ address: session.wallet }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const deposit = response?.ok ? await response.json().catch(() => null) as unknown : null;
  if (!deposit) return privateJson({ error: "Deposit addresses are temporarily unavailable." }, 502);
  return privateJson({ deposit });
}
