import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { depositWalletDeployed, resolveDepositWallet } from "@/lib/telegram-app/deposit-wallet";
import { isSameOriginBrowserRequest, privateJson } from "@/lib/telegram-app/request";
import { sessionCookieHeader, sessionFromRequest, sessionSecret } from "@/lib/telegram-app/session";
import { WALLET_PROOF_MAX_AGE_MS, walletProofMessage } from "@/lib/telegram-app/wallet-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The session's wallet with its current deployment state (the phone's key proved it earlier). */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);
  if (!session.owner || !session.wallet) return privateJson({ wallet: null });
  const deployed = await depositWalletDeployed(session.wallet as Address).catch(() => true);
  return privateJson({ wallet: { owner: getAddress(session.owner), depositWallet: getAddress(session.wallet), deployed } });
}

/**
 * The phone proves it holds the owner key (a signature naming this Telegram user), and the session
 * remembers that owner and the deposit wallet it controls. No database: the key is the account.
 */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return privateJson({ error: "Same-origin request required." }, 403);
  const session = sessionFromRequest(request);
  const secret = sessionSecret();
  if (!session || !secret) return privateJson({ error: "Telegram sign-in expired. Reopen the app." }, 401);

  const body = await request.json().catch(() => null) as { owner?: unknown; issuedAt?: unknown; signature?: unknown } | null;
  const owner = typeof body?.owner === "string" ? body.owner.trim().toLowerCase() : "";
  const issuedAt = typeof body?.issuedAt === "string" ? body.issuedAt : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const issuedMs = Date.parse(issuedAt);
  if (!/^0x[0-9a-f]{40}$/.test(owner) || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !Number.isFinite(issuedMs)) {
    return privateJson({ error: "Telegram wallet proof is invalid." }, 400);
  }
  if (Math.abs(Date.now() - issuedMs) > WALLET_PROOF_MAX_AGE_MS) return privateJson({ error: "Telegram wallet proof expired. Try again." }, 400);
  const message = walletProofMessage({ telegramUser: session.user, owner, issuedAt });
  const valid = await verifyMessage({ address: owner as Address, message, signature: signature as Hex }).catch(() => false);
  if (!valid) return privateJson({ error: "Telegram wallet proof does not match the key." }, 400);

  let resolved: { address: Address; deployed: boolean };
  try {
    resolved = await resolveDepositWallet(owner as Address);
  } catch {
    return privateJson({ error: "Telegram wallet is temporarily unavailable." }, 502);
  }
  const next = { ...session, owner, wallet: resolved.address.toLowerCase() };
  return privateJson(
    { wallet: { owner: getAddress(owner), depositWallet: getAddress(resolved.address), deployed: resolved.deployed } },
    200,
    { "Set-Cookie": sessionCookieHeader(next, secret) },
  );
}
