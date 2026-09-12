// Temporary owner-approved cadence: exactly ten verified stories per edition.
export const NEWS_EDITION_SIZE = 10;
export const NEWS_MINIMUM_EDITION_SIZE = 10;
export const NEWS_EDITION_INTERVAL_MS = 2 * 60 * 60_000;
export const NEWS_RESEARCH_BATCH_SIZE = 5;
export const NEWS_RESEARCH_TIMEOUT_MS = 11 * 60_000;
export const NEWS_RESEARCH_RETRY_MS = 30 * 60_000;

export function isPublishableEditionSize(count: number) {
  return Number.isInteger(count) && count >= NEWS_MINIMUM_EDITION_SIZE && count <= NEWS_EDITION_SIZE;
}

export function shouldResearchEdition({ prepared, dueAt, now, retryAfter = 0 }: {
  prepared: number; dueAt: number; now: number; retryAfter?: number;
}) {
  if (prepared >= NEWS_EDITION_SIZE || retryAfter > now) return false;
  // Optional top-ups must fit before the deadline. Below the minimum, retain
  // the private edition and keep gathering verified stories, even if overdue.
  return prepared < NEWS_MINIMUM_EDITION_SIZE || dueAt - now >= NEWS_RESEARCH_TIMEOUT_MS;
}
