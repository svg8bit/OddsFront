export const SOCIAL_PUBLICATION_INTERVAL_MS = 5 * 60 * 60_000;

export function socialPublicationDue(lastSentAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(lastSentAt) || lastSentAt < 0 || !Number.isFinite(now) || now < lastSentAt) return false;
  return lastSentAt === 0 || now - lastSentAt >= SOCIAL_PUBLICATION_INTERVAL_MS;
}
