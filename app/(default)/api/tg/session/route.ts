import { initDataConfig, verifyInitData } from "@/lib/telegram-app/init-data";
import { isSameOriginBrowserRequest, privateJson } from "@/lib/telegram-app/request";
import { SESSION_MAX_AGE_SECONDS, sessionCookieHeader, sessionFromRequest, sessionSecret } from "@/lib/telegram-app/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mini App sign-in: the phone posts Telegram's initData and gets the signed session cookie back. */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return privateJson({ error: "Cross-origin request blocked." }, 403);
  const config = initDataConfig();
  const secret = sessionSecret();
  if (!config || !secret) return privateJson({ error: "Telegram sign-in is not available." }, 503);
  const body = await request.json().catch(() => null) as { initData?: unknown } | null;
  const login = verifyInitData(body?.initData, config);
  if (!login) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  // The same Telegram user keeps the wallet their phone already proved in this browser.
  const previous = sessionFromRequest(request);
  const kept = previous?.user === login.userId ? { owner: previous.owner, wallet: previous.wallet } : {};
  const session = { user: login.userId, ...kept, expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS };
  return privateJson(
    { ok: true, user: { id: login.userId, firstName: login.firstName, languageCode: login.languageCode }, startParam: login.startParam },
    200,
    { "Set-Cookie": sessionCookieHeader(session, secret) },
  );
}
