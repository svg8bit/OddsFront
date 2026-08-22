export function getInitialActivityClock(feedUpdatedAt: string): number {
  const timestamp = Date.parse(feedUpdatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
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
