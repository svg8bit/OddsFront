
import { POLYMARKET_CONTRACTS } from "./contracts.ts";

/**
 * Telegram Wallet ↔ Telegram betting balance through Relay (relay.link). Polymarket's own bridge does
 * not take TON, so Relay swaps the TON coin (GRAM) into pUSD on the player's Telegram deposit wallet,
 * and back. Relay's fee comes out of the player's amount.
 *
 * - Top-up: Relay returns the exact TON message; the player confirms it in their wallet (TON Connect).
 * - Withdrawal: Relay returns a Polygon deposit address; the deposit wallet sends pUSD there and Relay
 *   pays GRAM to the player's TON address.
 */

const RELAY_API = "https://api.relay.link";
export const TON_CHAIN_ID = 224235520;
export const TON_NATIVE_CURRENCY = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const POLYGON_CHAIN_ID = 137;
const PUSD = POLYMARKET_CONTRACTS.collateral.toLowerCase();
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A top-up lands on the betting balance, so it starts at $3 (Relay fees come out of it); withdrawals at $2. */
export const MIN_TON_TOP_UP_USD = 3;
export const MIN_TON_WITHDRAW_USD = 2;
export const MAX_TON_TRANSFER_USD = 5_000;

export class TonRouteError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "TonRouteError";
    this.status = status;
  }
}

/** User-friendly TON address (bounceable EQ… / non-bounceable UQ…, base64url) or raw `0:<hex>`. */
export function isTonAddress(value: unknown): value is string {
  return typeof value === "string" && (/^[EUk0][Qf][A-Za-z0-9_-]{46}$/.test(value) || /^-?[01]:[0-9a-fA-F]{64}$/.test(value));
}

function relayHeaders(): Record<string, string> {
  const key = (process.env.RELAY_API_KEY || "").trim();
  return { accept: "application/json", "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) };
}

type RelayItem = { data?: { messages?: Array<{ to?: unknown; value?: unknown; body?: unknown }> } };
type RelayQuote = {
  steps?: Array<{ id?: unknown; requestId?: unknown; depositAddress?: unknown; items?: RelayItem[] }>;
  details?: {
    recipient?: unknown;
    timeEstimate?: unknown;
    currencyIn?: { amount?: unknown; amountFormatted?: unknown; amountUsd?: unknown; currency?: { chainId?: unknown; address?: unknown } };
    currencyOut?: { amountFormatted?: unknown; amountUsd?: unknown; currency?: { chainId?: unknown; address?: unknown } };
  };
  message?: unknown;
};

async function requestQuote(body: Record<string, unknown>) {
  const response = await fetch(`${RELAY_API}/quote/v2`, {
    method: "POST",
    cache: "no-store",
    headers: relayHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) throw new TonRouteError("The TON transfer service is not responding. Try again.", 503);
  const quote = await response.json().catch(() => ({})) as RelayQuote;
  if (response.status === 429) throw new TonRouteError("The TON transfer service is busy. Try again in a minute.", 503);
  if (!response.ok) {
    const reason = typeof quote.message === "string" ? quote.message : "";
    if (/insufficient|balance/i.test(reason)) throw new TonRouteError("Not enough TON in this wallet for that amount.", 400);
    if (/too (small|low)|minimum/i.test(reason)) throw new TonRouteError("This amount is too small. Try a larger amount.", 400);
    throw new TonRouteError("TON transfers are temporarily unavailable. Try again later.", 503);
  }
  return quote;
}

function sameCurrency(currency: { chainId?: unknown; address?: unknown } | undefined, chainId: number, address: string) {
  return Number(currency?.chainId) === chainId && typeof currency?.address === "string" && currency.address.toLowerCase() === address.toLowerCase();
}

const asNumber = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);

function checkAmount(amountUsd: number, minimumUsd: number) {
  if (!Number.isFinite(amountUsd) || amountUsd < minimumUsd || amountUsd > MAX_TON_TRANSFER_USD) {
    throw new TonRouteError(`Enter an amount from $${minimumUsd} to $${MAX_TON_TRANSFER_USD}.`, 400);
  }
}

/** The TON message that turns the player's GRAM into `amountUsd` pUSD on their Telegram deposit wallet. */
export async function tonTopUpQuote(input: { tonAddress: string; depositWallet: string; amountUsd: number }) {
  if (!isTonAddress(input.tonAddress)) throw new TonRouteError("Connect a TON wallet first.", 400);
  if (!EVM_ADDRESS.test(input.depositWallet)) throw new TonRouteError("Telegram wallet is not ready yet.", 409);
  checkAmount(input.amountUsd, MIN_TON_TOP_UP_USD);
  const quote = await requestQuote({
    user: input.tonAddress,
    originChainId: TON_CHAIN_ID,
    originCurrency: TON_NATIVE_CURRENCY,
    destinationChainId: POLYGON_CHAIN_ID,
    destinationCurrency: PUSD,
    recipient: input.depositWallet,
    tradeType: "EXPECTED_OUTPUT",
    amount: String(Math.round(input.amountUsd * 1_000_000)),
    refundTo: input.tonAddress,
  });
  const details = quote.details;
  if (
    typeof details?.recipient !== "string" || details.recipient.toLowerCase() !== input.depositWallet.toLowerCase()
    || !sameCurrency(details.currencyOut?.currency, POLYGON_CHAIN_ID, PUSD)
    || !sameCurrency(details.currencyIn?.currency, TON_CHAIN_ID, TON_NATIVE_CURRENCY)
  ) {
    throw new TonRouteError("The TON route could not be verified. Try again later.");
  }
  const step = quote.steps?.find((entry) => entry.items?.some((item) => item.data?.messages?.length));
  const messages = (step?.items || []).flatMap((item) => item.data?.messages || []).map((message) => ({
    address: typeof message.to === "string" ? message.to : "",
    amount: typeof message.value === "string" && /^\d+$/.test(message.value) ? message.value : "",
    payload: typeof message.body === "string" ? message.body : undefined,
  }));
  if (!messages.length || messages.some((message) => !isTonAddress(message.address) || !message.amount)) {
    throw new TonRouteError("The TON route could not be verified. Try again later.");
  }
  return {
    requestId: typeof step?.requestId === "string" ? step.requestId : null,
    messages,
    tonAmount: typeof details.currencyIn?.amountFormatted === "string" ? details.currencyIn.amountFormatted : null,
    payUsd: asNumber(details.currencyIn?.amountUsd),
    receiveUsd: asNumber(details.currencyOut?.amountUsd),
    seconds: asNumber(details.timeEstimate),
  };
}

/** A Polygon address that pays `amountUsd` worth of pUSD out as GRAM to the player's TON address. */
export async function tonWithdrawalQuote(input: { tonAddress: string; depositWallet: string; amountUsd: number }) {
  if (!isTonAddress(input.tonAddress)) throw new TonRouteError("Connect a TON wallet first.", 400);
  if (!EVM_ADDRESS.test(input.depositWallet)) throw new TonRouteError("Telegram wallet is not ready yet.", 409);
  checkAmount(input.amountUsd, MIN_TON_WITHDRAW_USD);
  const quote = await requestQuote({
    user: input.depositWallet,
    useDepositAddress: true,
    originChainId: POLYGON_CHAIN_ID,
    originCurrency: PUSD,
    destinationChainId: TON_CHAIN_ID,
    destinationCurrency: TON_NATIVE_CURRENCY,
    recipient: input.tonAddress,
    tradeType: "EXACT_INPUT",
    amount: String(Math.round(input.amountUsd * 1_000_000)),
    refundTo: input.depositWallet,
  });
  const details = quote.details;
  const depositAddress = quote.steps?.map((step) => step.depositAddress).find((value): value is string => typeof value === "string" && EVM_ADDRESS.test(value));
  if (
    !depositAddress
    || typeof details?.recipient !== "string" || details.recipient !== input.tonAddress
    || !sameCurrency(details.currencyIn?.currency, POLYGON_CHAIN_ID, PUSD)
    || !sameCurrency(details.currencyOut?.currency, TON_CHAIN_ID, TON_NATIVE_CURRENCY)
  ) {
    throw new TonRouteError("The TON route could not be verified. Try again later.");
  }
  return {
    depositAddress,
    tonAmount: typeof details.currencyOut?.amountFormatted === "string" ? details.currencyOut.amountFormatted : null,
    receiveUsd: asNumber(details.currencyOut?.amountUsd),
    seconds: asNumber(details.timeEstimate),
  };
}
