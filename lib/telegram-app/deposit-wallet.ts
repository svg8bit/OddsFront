import { concatHex, encodeAbiParameters, getCreate2Address, keccak256, numberToHex, padHex, type Address } from "viem";
import { POLYMARKET_CONTRACTS, POLYMARKET_RELAYER_URL } from "./contracts.ts";

/**
 * The Polymarket deposit wallet an owner key controls. The address is deterministic (CREATE2 from the
 * official factory), so it is known before the wallet is deployed and deposits can arrive early.
 */

const ERC1967_CONST1 = "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";
const ERC1967_CONST2 = "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076";
const ERC1967_PREFIX = 0x61003d3d8160233d3973n;
const ERC1967_BEACON_CONST1 = "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3";
const ERC1967_BEACON_CONST2 = "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c";
const ERC1967_BEACON_CONST3 = "0x60195155f3363d3d373d3d363d602036600436635c60da";
const ERC1967_BEACON_PREFIX = 0x6100523d8160233d3973n;

function depositWalletArgs(owner: Address) {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [POLYMARKET_CONTRACTS.depositWalletFactory, padHex(owner, { size: 32 })],
  );
}

function prefixedInitCodeHash(prefixBase: bigint, args: `0x${string}`, parts: `0x${string}`[]) {
  const argsByteLength = BigInt((args.length - 2) / 2);
  const prefix = numberToHex(prefixBase + (argsByteLength << 56n), { size: 10 });
  return keccak256(concatHex([prefix, ...parts, args]));
}

/** Legacy UUPS wallet derivation: a wallet already deployed this way keeps its address. */
export function deriveLegacyDepositWalletAddress(owner: Address) {
  const args = depositWalletArgs(owner);
  const bytecodeHash = prefixedInitCodeHash(ERC1967_PREFIX, args, [
    POLYMARKET_CONTRACTS.depositWalletImplementation,
    "0x6009",
    ERC1967_CONST2,
    ERC1967_CONST1,
  ]);
  return getCreate2Address({ from: POLYMARKET_CONTRACTS.depositWalletFactory, salt: keccak256(args), bytecodeHash });
}

/** Current beacon-wallet derivation used by the official Polymarket client for new wallets. */
export function deriveBeaconDepositWalletAddress(owner: Address) {
  const args = depositWalletArgs(owner);
  const bytecodeHash = prefixedInitCodeHash(ERC1967_BEACON_PREFIX, args, [
    POLYMARKET_CONTRACTS.depositWalletBeacon,
    ERC1967_BEACON_CONST3,
    ERC1967_BEACON_CONST2,
    ERC1967_BEACON_CONST1,
  ]);
  return getCreate2Address({ from: POLYMARKET_CONTRACTS.depositWalletFactory, salt: keccak256(args), bytecodeHash });
}

/** Deployed per the official relayer registry. A failed lookup throws: guessing could move a user's wallet. */
export async function depositWalletDeployed(address: Address, fetcher: typeof fetch = fetch) {
  const url = new URL(`${POLYMARKET_RELAYER_URL.replace(/\/$/, "")}/deployed`);
  url.searchParams.set("address", address);
  url.searchParams.set("type", "WALLET");
  const response = await fetcher(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Wallet registry returned ${response.status}.`);
  const body = await response.json() as { deployed?: unknown };
  return body.deployed === true;
}

/** The official SDK's rule: keep a deployed legacy wallet, otherwise use the beacon wallet. */
export async function resolveDepositWallet(owner: Address, fetcher: typeof fetch = fetch) {
  const legacy = deriveLegacyDepositWalletAddress(owner);
  if (await depositWalletDeployed(legacy, fetcher)) return { address: legacy, deployed: true };
  const beacon = deriveBeaconDepositWalletAddress(owner);
  return { address: beacon, deployed: await depositWalletDeployed(beacon, fetcher) };
}
