export function getInitialActivityClock(feedUpdatedAt: string): number {
  const timestamp = Date.parse(feedUpdatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export const ACTIVITY_DISMISSAL_STORAGE_KEY = "oddsfront.activity-dismissals.v1";

/** Keep dismissals through a reload, only until the original notice expires. */
export function activeActivityDismissals(value: unknown, now: number): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  // Trade receipts tolerate a one-minute clock skew; preserve their original
  // expiry rather than forgetting a dismissal during that accepted margin.
  return Object.fromEntries(Object.entries(value)
    .filter(([id, expiresAt]) => id.length <= 300 && typeof expiresAt === "number" &&
      Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + 16 * 60_000)
    .slice(-96));
}

export function releaseAbsentActivityNoticeIds(
  seenNoticeIds: Set<string>,
  previousNoticeIds: ReadonlySet<string>,
  currentNoticeIds: ReadonlySet<string>,
): void {
  for (const noticeId of previousNoticeIds) {
    if (!currentNoticeIds.has(noticeId)) seenNoticeIds.delete(noticeId);
  }
}
