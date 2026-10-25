/** Polymarket contracts on Polygon used by the Telegram app (deposit wallets and pUSD collateral). */
export const POLYMARKET_CONTRACTS = {
  depositWalletFactory: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07",
  depositWalletBeacon: "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a",
  depositWalletImplementation: "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB",
  collateral: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
} as const;

export const POLYMARKET_RELAYER_URL = "https://relayer-v2.polymarket.com/";
export const POLYMARKET_CLOB_URL = "https://clob.polymarket.com";
export const POLYMARKET_GAMMA_URL = "https://gamma-api.polymarket.com";
export const POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com";
export const POLYMARKET_BRIDGE_URL = "https://bridge.polymarket.com";
