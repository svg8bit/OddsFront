import { polygonRpcUrls } from "@/lib/telegram-app/polygon";
import { isSameOriginBrowserRequest } from "@/lib/telegram-app/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 6_000;
/** Reads only: writes go through the gasless relayer, never this proxy. */
const READ_METHODS = new Set([
  "eth_blockNumber", "eth_call", "eth_chainId", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice", "eth_getBalance",
  "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_getStorageAt", "eth_getTransactionByHash",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_maxPriorityFeePerGas", "net_version",
]);

const readCall = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && READ_METHODS.has(String((value as { method?: unknown }).method)));

/** Rate-limit and capacity errors inside a 200 answer mean "ask another node"; a revert (code 3) is a real answer. */
function retryable(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(retryable);
  if (!body || typeof body !== "object") return true;
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  if (!error) return false;
  const code = Number(error.code);
  if (code === 3) return false;
  return code === -32005 || code === 429 || /rate limit|too many requests|over capacity|overloaded|quota/i.test(String(error.message || ""));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Read-only Polygon JSON-RPC for the app's own browser code, walking public nodes until one answers. */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return json({ error: "Cross-origin RPC is not allowed." }, 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "RPC payload is too large." }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const allowed = Array.isArray(payload) ? payload.length > 0 && payload.length <= MAX_BATCH && payload.every(readCall) : readCall(payload);
  if (!allowed) return json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Only read methods are served." } }, 400);
  for (const upstream of polygonRpcUrls(process.env.POLYGON_RPC_URL)) {
    try {
      const response = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: raw, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), cache: "no-store" });
      if (!response.ok) continue;
      const body = await response.json().catch(() => null);
      if (body === null || retryable(body)) continue;
      return json(body);
    } catch {
      // Timeout or network error: try the next node.
    }
  }
  return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "All Polygon RPC nodes failed." } }, 502);
}
