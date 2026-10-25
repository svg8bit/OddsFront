/**
 * The message the phone's owner key signs to bind itself to the Telegram user's session. Naming the
 * Telegram user means a signature can never open somebody else's session.
 */
export const WALLET_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

export function walletProofMessage(input: { telegramUser: string; owner: string; issuedAt: string }) {
  return [
    "OddsFront Telegram wallet",
    `Telegram user: ${input.telegramUser}`,
    `Owner: ${input.owner.toLowerCase()}`,
    `Issued: ${input.issuedAt}`,
  ].join("\n");
}
