"use client";

import { AssetType, OrderSide, OrderType, type SecureClient } from "@polymarket/client";
import { updateBalanceAllowance } from "@polymarket/client/actions";
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MiniAppConfig } from "../config.ts";
import { POLYMARKET_CONTRACTS } from "../contracts.ts";
import { browserPolygonRpcUrl, polygon, polygonRpcUrls, polygonTransport } from "../polygon.ts";
import type { DeviceKey } from "./device-key.ts";
import { walletActionFailure } from "./errors.ts";
import { createOddsFrontSecureClient, fetchSpotTradingApprovals, parseClobCredentials, setupSpotTradingApprovals } from "./polymarket.ts";

/**
 * Trading for the Telegram account. The owner key sits on the phone, so every signature (wallet
 * deployment, approvals, market login, orders) happens locally without a wallet pop-up; the gas is
 * sponsored by the Polymarket relayer and every order carries the builder code.
 */

const balanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const CLIENT_TTL_MS = 5 * 60_000;
export const MIN_BET_USD = 1;

export type SetupStep = "wallet" | "approvals" | "ready";

export type PlacedBet = {
  orderId: string | null;
  status: string;
  spentUsd: number | null;
  shares: number | null;
};

export type RedeemTarget = { conditionId: string };

function storageKey(kind: string, wallet: string) {
  return `oddsfront:tg:${kind}:${wallet.toLowerCase()}`;
}

function readStored(key: string) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") as unknown;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the official client re-derives what it needs.
  }
}

function orderFailure(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const value = response as { ok?: unknown; message?: unknown; errorMsg?: unknown };
  if (value.ok !== false) return null;
  const text = typeof value.message === "string" ? value.message : typeof value.errorMsg === "string" ? value.errorMsg : "";
  if (/no orders found to match|not enough liquidity|FAK|fully filled/i.test(text)) return "Not enough offers at this price right now. Try a smaller amount.";
  if (/balance|allowance/i.test(text)) return "Not enough money on your Telegram balance.";
  return text || "The bet was not accepted. Try again.";
}

export class TelegramTrader {
  readonly depositWallet: string;
  private readonly key: DeviceKey;
  private readonly config: MiniAppConfig;
  private client: { value: SecureClient; at: number } | null = null;
  private readonly rpcUrl = browserPolygonRpcUrl();

  constructor(key: DeviceKey, depositWallet: string, config: MiniAppConfig) {
    this.key = key;
    this.depositWallet = depositWallet;
    this.config = config;
  }

  private walletClient() {
    return createWalletClient({ account: privateKeyToAccount(this.key.privateKey), chain: polygon, transport: polygonTransport(this.rpcUrl) });
  }

  /** The authenticated official client; creating it deploys the deposit wallet on first use. */
  async secureClient(fresh = false) {
    if (!fresh && this.client && Date.now() - this.client.at < CLIENT_TTL_MS) return this.client.value;
    const value = await createOddsFrontSecureClient({
      walletClient: this.walletClient(),
      wallet: this.depositWallet,
      credentials: parseClobCredentials(readStored(storageKey("clob", this.depositWallet))),
      rpcUrl: this.rpcUrl,
    });
    if (value.account.wallet.toLowerCase() !== this.depositWallet.toLowerCase()) {
      throw new Error("The trading service authenticated a different wallet.");
    }
    const credentials = parseClobCredentials(value.credentials);
    if (credentials) writeStored(storageKey("clob", this.depositWallet), credentials);
    this.client = { value, at: Date.now() };
    return value;
  }

  /** Deploy the deposit wallet and approve trading once (both gasless), then sync the balance. */
  async ensureReady(onStep?: (step: SetupStep) => void) {
    try {
      onStep?.("wallet");
      const client = await this.secureClient();
      if (readStored(storageKey("approvals", this.depositWallet)) !== true) {
        onStep?.("approvals");
        const state = await fetchSpotTradingApprovals(client);
        if (!state.isFullyApproved) await setupSpotTradingApprovals(client, this.walletClient());
        const confirmed = await fetchSpotTradingApprovals(client);
        if (!confirmed.isFullyApproved) throw new Error("Trading approvals were not confirmed yet. Try again in a moment.");
        writeStored(storageKey("approvals", this.depositWallet), true);
      }
      await updateBalanceAllowance(client, { assetType: AssetType.COLLATERAL }).catch(() => undefined);
      onStep?.("ready");
    } catch (error) {
      throw walletActionFailure(error, "Telegram wallet setup failed. Try again.");
    }
  }

  async balance() {
    const read = (url: string) => createPublicClient({ chain: polygon, transport: http(url, { timeout: 2_500, retryCount: 0 }) })
      .readContract({ address: POLYMARKET_CONTRACTS.collateral, abi: balanceAbi, functionName: "balanceOf", args: [this.depositWallet as `0x${string}`] });
    try {
      return Number(formatUnits(await Promise.any(polygonRpcUrls(this.rpcUrl).map(read)), 6));
    } catch {
      return null;
    }
  }

  /** Market buy of `amountUsd` on one outcome (fill-and-kill), with the builder code. */
  async buy(assetId: string, amountUsd: number): Promise<PlacedBet> {
    if (!this.config.tradingEnabled || !this.config.builderCode) throw new Error("Betting is not available right now.");
    if (this.config.restrictedRegion) throw new Error("Betting is not available right now.");
    if (!(amountUsd >= MIN_BET_USD)) throw new Error(`The smallest bet is $${MIN_BET_USD}.`);
    const client = await this.secureClient();
    let response: unknown;
    try {
      response = await client.placeMarketOrder({
        assetId,
        side: OrderSide.BUY,
        amount: amountUsd,
        builderCode: this.config.builderCode,
        orderType: OrderType.FAK,
      });
    } catch (error) {
      this.client = null;
      throw error;
    }
    const failure = orderFailure(response);
    if (failure) throw new Error(failure);
    const accepted = response as { orderId?: string; status?: string; makingAmount?: string; takingAmount?: string };
    const spent = Number(accepted.makingAmount);
    const shares = Number(accepted.takingAmount);
    return {
      orderId: typeof accepted.orderId === "string" ? accepted.orderId : null,
      status: typeof accepted.status === "string" ? accepted.status : "",
      spentUsd: Number.isFinite(spent) && spent > 0 ? spent : null,
      shares: Number.isFinite(shares) && shares > 0 ? shares : null,
    };
  }

  /** Redeem settled winners to pUSD on the Telegram balance (gasless, one relayer batch per market). */
  async redeem(targets: RedeemTarget[]) {
    try {
      const client = await this.secureClient();
      for (const target of targets) {
        const handle = await client.redeemPositions({ conditionId: target.conditionId });
        await handle.wait();
      }
    } catch (error) {
      throw walletActionFailure(error, "Winnings were not collected. Try again.");
    }
  }

  /** Gasless pUSD transfer out of the Telegram deposit wallet (withdrawals). */
  async sendPusd(recipient: string, amountUsd: number) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Withdrawal address is invalid.");
    try {
      const client = await this.secureClient();
      const handle = await client.transferErc20({
        tokenAddress: POLYMARKET_CONTRACTS.collateral,
        recipientAddress: recipient,
        amount: parseUnits(amountUsd.toFixed(6), 6),
      });
      return await handle.wait();
    } catch (error) {
      throw walletActionFailure(error, "The withdrawal was not sent. Try again.");
    }
  }
}
