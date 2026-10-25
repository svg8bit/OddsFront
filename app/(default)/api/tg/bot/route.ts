import { timingSafeEqual } from "node:crypto";
import { botReply } from "@/lib/telegram-app/bot-replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(received: string | null, expected: string) {
  if (!received || expected.length < 32) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * @OddsFrontBot's webhook. Telegram signs every call with the secret set in setWebhook; the reply
 * goes back in the webhook response itself, so no outgoing call (and no bot token) is needed here.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), (process.env.ODDSFRONT_TG_WEBHOOK_SECRET || "").trim())) {
    return new Response(null, { status: 401 });
  }
  const reply = botReply(await request.json().catch(() => null));
  return reply ? Response.json(reply) : new Response(null, { status: 200 });
}
