import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SESSION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function reply(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug.length > 100 || !SLUG.test(slug)) return reply(400);
  try {
    // Next normalizes the loopback hostname; compare the browser's host to
    // the actual HTTP Host header rather than that internal server URL.
    const origin = new URL(request.headers.get("origin") ?? "");
    if (origin.host !== request.headers.get("host") || origin.protocol !== request.nextUrl.protocol ||
        request.headers.get("sec-fetch-site") === "cross-site") return reply(403);
  } catch { return reply(403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415);
  if (Number(request.headers.get("content-length") ?? 0) > 512) return reply(413);
  const agent = request.headers.get("user-agent") ?? "";
  if (!agent || /bot|crawl|spider|preview|headless/i.test(agent)) return reply(204);
  let sessionId: string;
  try {
    const text = await request.text();
    if (text.length > 512) return reply(413);
    const body = JSON.parse(text) as { sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !SESSION.test(body.sessionId)) return reply(400);
    sessionId = body.sessionId;
  } catch { return reply(400); }
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (!rawUrl || !token) return reply(503);
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return reply(503);
    url.pathname = `/v1/news/articles/${slug}/view`; url.search = ""; url.hash = "";
    const digest = (value: string) => createHmac("sha256", token).update(value).digest("hex");
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reader: digest(`news-reader:${sessionId}`), network: digest(`news-network:${Math.floor(Date.now()/86_400_000)}:${address}`) }),
      cache: "no-store", signal: AbortSignal.timeout(4_000),
    });
    return reply(response.ok ? 204 : response.status === 404 ? 404 : response.status === 429 ? 429 : 503);
  } catch { return reply(503); }
}
