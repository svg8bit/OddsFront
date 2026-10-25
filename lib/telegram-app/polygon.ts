import { defineChain, fallback, http, type Transport } from "viem";

export const polygon = defineChain({
  id: 137,
  name: "Polygon",
  blockTime: 2_000,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon.drpc.org"] } },
  blockExplorers: { default: { name: "PolygonScan", url: "https://polygonscan.com" } },
  contracts: { multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11", blockCreated: 25_770_160 } },
});

/**
 * Free public Polygon RPCs, tried in order. One overloaded public node ("upstream overloaded", 429)
 * must never break wallet setup, balances or payouts.
 */
export const POLYGON_PUBLIC_RPCS = [
  "https://polygon.drpc.org",
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.gateway.tenderly.co",
  "https://1rpc.io/matic",
] as const;

/** Browser code reads Polygon through the app's own read-only failover proxy (`/api/tg/rpc`). */
export function browserPolygonRpcUrl() {
  if (typeof window !== "undefined" && window.location?.origin) return `${window.location.origin}/api/tg/rpc`;
  return POLYGON_PUBLIC_RPCS[0];
}

export function polygonRpcUrls(primary?: string | null) {
  return Array.from(new Set([primary?.trim() || "", ...POLYGON_PUBLIC_RPCS].filter(Boolean)));
}

export function polygonTransport(primary?: string | null): Transport {
  return fallback(polygonRpcUrls(primary).map((url) => http(url, { timeout: 10_000, retryCount: 1 })), { retryCount: 1 });
}
