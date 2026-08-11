export function releaseAbsentActivityNoticeIds(
  seenNoticeIds: Set<string>,
  previousNoticeIds: ReadonlySet<string>,
  currentNoticeIds: ReadonlySet<string>,
): void {
  for (const noticeId of previousNoticeIds) {
    if (!currentNoticeIds.has(noticeId)) seenNoticeIds.delete(noticeId);
  }
}
