import { isSameOriginBrowserRequest, privateJson } from "@/lib/telegram-app/request";
import { tonTopUpQuote, TonRouteError, tonWithdrawalQuote } from "@/lib/telegram-app/relay-ton";
import { sessionFromRequest } from "@/lib/telegram-app/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quotes for moving money between the player's TON wallet and their Telegram betting balance. */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return privateJson({ error: "Same-origin request required." }, 403);
  const session = sessionFromRequest(request);
  if (!session) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  // Money only ever lands on (or leaves from) the session's own deposit wallet.
  if (!session.wallet) return privateJson({ error: "Telegram wallet is not ready yet." }, 409);
  const body = await request.json().catch(() => null) as { action?: unknown; tonAddress?: unknown; amountUsd?: unknown } | null;
  const input = {
    tonAddress: typeof body?.tonAddress === "string" ? body.tonAddress.trim() : "",
    depositWallet: session.wallet,
    amountUsd: Number(body?.amountUsd),
  };
  try {
    if (body?.action === "topup") return privateJson({ quote: await tonTopUpQuote(input) });
    if (body?.action === "withdraw") return privateJson({ quote: await tonWithdrawalQuote(input) });
    return privateJson({ error: "Unknown TON action." }, 400);
  } catch (error) {
    if (error instanceof TonRouteError) return privateJson({ error: error.message }, error.status);
    return privateJson({ error: "TON transfers are temporarily unavailable." }, 503);
  }
}
