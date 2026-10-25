"use client";

import {
  createSecureClient,
  erc1155ApprovalForAllCall,
  erc20ApprovalCall,
  forkEnvironmentConfig,
  remoteBuilderSigning,
  type SecureClient,
  type Signer,
  type TradingApprovalsState,
} from "@polymarket/client";
import { prepareGaslessTransaction, type GaslessWorkflow } from "@polymarket/client/actions";
import { signerFrom } from "@polymarket/client/viem";
import type { WalletClient } from "viem";
import { POLYMARKET_RELAYER_URL } from "../contracts.ts";

/**
 * The official Polymarket client for the phone's owner key. Builder authentication is signed by
 * OddsFront's server (/api/tg/sign), so the builder secret never reaches the phone.
 */

export type ClobCredentials = { key: string; secret: string; passphrase: string };
type SdkCredentials = Exclude<Parameters<typeof createSecureClient>[0]["credentials"], undefined>;

export function polymarketEnvironment(rpcUrl?: string) {
  return forkEnvironmentConfig({
    name: "oddsfront-polygon",
    chainId: 137,
    ...(rpcUrl ? { rpc: rpcUrl } : {}),
    relayer: { rest: POLYMARKET_RELAYER_URL.replace(/\/$/, "") },
  });
}

export function parseClobCredentials(value: unknown): ClobCredentials | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ClobCredentials>;
  if (typeof candidate.key !== "string" || !candidate.key.trim()
    || typeof candidate.secret !== "string" || !candidate.secret.trim()
    || typeof candidate.passphrase !== "string" || !candidate.passphrase.trim()) return null;
  return { key: candidate.key, secret: candidate.secret, passphrase: candidate.passphrase };
}

export async function createOddsFrontSecureClient(input: {
  walletClient: WalletClient;
  wallet: string;
  credentials?: ClobCredentials | null;
  rpcUrl?: string;
}): Promise<SecureClient> {
  const options = {
    signer: signerFrom(input.walletClient),
    wallet: input.wallet,
    environment: polymarketEnvironment(input.rpcUrl),
    apiKey: remoteBuilderSigning({ url: "/api/tg/sign", credentials: "same-origin" }),
  };
  return input.credentials
    ? createSecureClient({ ...options, credentials: input.credentials as SdkCredentials })
    : createSecureClient(options);
}

async function completeGaslessWorkflow(workflow: GaslessWorkflow, signer: Signer) {
  let result = await workflow.next();
  while (!result.done) {
    try {
      const request = result.value;
      if (request.kind === "requestAddress") result = await workflow.next(await signer.getAddress());
      else if (request.kind === "signGaslessTypedData") result = await workflow.next(await signer.signTypedData(request.payload));
      else if (request.kind === "signGaslessMessage") result = await workflow.next(await signer.signMessage(request.payload));
      else throw new Error(`Unsupported Polymarket workflow request: ${String((request as { kind?: unknown }).kind)}`);
    } catch (error) {
      result = await workflow.throw(error);
    }
  }
  return result.value;
}

/** Spot approvals only: the Perps deposit contract is never used here. */
function spotOnly(client: SecureClient, state: TradingApprovalsState): TradingApprovalsState {
  const perps = ((client as unknown as { environment: { contracts: { perpsDepositContract?: string } } })
    .environment.contracts.perpsDepositContract || "").toLowerCase();
  const missing = {
    erc20: state.missing.erc20.filter((approval) => approval.spenderAddress.toLowerCase() !== perps),
    erc1155: state.missing.erc1155,
  };
  return { isFullyApproved: missing.erc20.length === 0 && missing.erc1155.length === 0, missing };
}

export async function fetchSpotTradingApprovals(client: SecureClient) {
  return spotOnly(client, await client.fetchTradingApprovalsState());
}

/** All missing trading approvals in one gasless deposit-wallet batch. */
export async function setupSpotTradingApprovals(client: SecureClient, walletClient: WalletClient) {
  const state = await fetchSpotTradingApprovals(client);
  if (state.isFullyApproved) return;
  const calls = [
    ...state.missing.erc20.map((approval) => erc20ApprovalCall(approval.tokenAddress, approval.spenderAddress, approval.amount)),
    ...state.missing.erc1155.map((approval) => erc1155ApprovalForAllCall(approval.tokenAddress, approval.operatorAddress, true)),
  ];
  const workflow = await prepareGaslessTransaction(client, { calls, metadata: "OddsFront trading approvals" });
  const handle = await completeGaslessWorkflow(workflow, signerFrom(walletClient));
  await handle.wait();
}
