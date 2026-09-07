const HOUR_MS = 60 * 60_000;

export function hourlyPublicationDue(lastSentAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(lastSentAt) || lastSentAt < 0 || !Number.isFinite(now) || now < lastSentAt) return false;
  return lastSentAt === 0 || Math.floor(now / HOUR_MS) > Math.floor(lastSentAt / HOUR_MS);
}
