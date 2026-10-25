/**
 * Polymarket's relayer pays the gas for wallet operations (creating the wallet, approvals, claiming
 * winnings, withdrawals) and caps them per builder per day. Bets are never counted. The official
 * client hides that refusal behind generic errors, so the cause chain is searched for it.
 */

export const WALLET_ACTION_LIMIT_MESSAGE =
  "Today's limit of free wallet operations is reached. Bets still work; wallet setup and claiming winnings will be available again tomorrow.";

const LIMIT_MESSAGE = /(?:status|HTTP)\s*429|rate.?limit|too many requests|daily (?:wallet action|relayer) limit/i;

export function isWalletActionLimitError(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { name?: unknown; status?: unknown; message?: unknown; cause?: unknown };
    if (candidate.name === "RateLimitError" || candidate.status === 429) return true;
    if (typeof candidate.message === "string" && LIMIT_MESSAGE.test(candidate.message)) return true;
    current = candidate.cause;
  }
  return false;
}

export function walletActionFailure(error: unknown, fallback: string): Error {
  if (isWalletActionLimitError(error)) return new Error(WALLET_ACTION_LIMIT_MESSAGE, { cause: error });
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}
