// Shared memory of the last news feed failure in this worker. A dead feed
// host must not cost every ISR regeneration or API call a connection timeout:
// after one failed request the readers skip the network for FEED_RETRY_SECONDS
// and serve their fallbacks, then try the feed again.
export const FEED_RETRY_SECONDS = 300;
export const FEED_TIMEOUT_MS = 2_000;

let unavailableUntil = 0;

export function feedCoolingDown(now = Date.now()): boolean {
  return now < unavailableUntil;
}

export function rememberFeedFailure(now = Date.now()): void {
  unavailableUntil = now + FEED_RETRY_SECONDS * 1_000;
}

export function rememberFeedSuccess(): void {
  unavailableUntil = 0;
}
