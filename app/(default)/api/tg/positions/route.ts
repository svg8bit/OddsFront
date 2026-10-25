import { POLYMARKET_DATA_API_URL } from "@/lib/telegram-app/contracts";
import { betsFromPositions, rowsOf } from "@/lib/telegram-app/positions";
import { privateJson } from "@/lib/telegram-app/request";
import { sessionFromRequest } from "@/lib/telegram-app/session";
import { localizeBet, marketTranslations } from "@/lib/telegram-app/translations";

export const dynamic = "force-dynamic";

async function rows(url: string) {
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) throw new Error("Data API unavailable");
  return rowsOf(await response.json().catch(() => null));
}

/** The player's bets: the session wallet's open, settled and recently closed Polymarket positions. */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  if (!session.wallet) return privateJson({ bets: [] });
  const user = encodeURIComponent(session.wallet);
  try {
    const [open, closed, ru] = await Promise.all([
      rows(`${POLYMARKET_DATA_API_URL}/v2/positions?user=${user}&status=OPEN&limit=100&sort_by=CURRENT_VALUE&sort_direction=DESC&filter_type=TOKENS&filter_amount=0`),
      rows(`${POLYMARKET_DATA_API_URL}/v2/positions?user=${user}&status=CLOSED&limit=50&sort_by=TIMESTAMP&sort_direction=DESC`),
      marketTranslations(),
    ]);
    return privateJson({ bets: betsFromPositions(open, closed).map((bet) => localizeBet(bet, ru)) });
  } catch {
    return privateJson({ error: "Your bets are temporarily unavailable." }, 503);
  }
}
