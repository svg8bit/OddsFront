import { sameStory } from "./headlines.ts";

export type HotDeskPost = {
  at: string;
  storyTitle: string;
  storyFingerprint: string[];
  marketId: string;
  dayChange: number | null;
  messages: { en: number | null; ru: number | null };
};

export type HotDeskState = {
  lastSentAt: number;
  posts: HotDeskPost[];
  /** Clusters the editor already judged, so an unchanged news cycle costs no model call. */
  evaluated?: { at: string; fingerprints: string[][] };
  pending?: { marketId: string; storyTitle: string; attemptedAt: string; sent: { en: number | null; ru: number | null } };
};

export type HotDeskPolicy = {
  minIntervalMinutes: number;
  maxPerDay: number;
  marketRepeatHours: number;
  marketRepeatMovePp: number;
  storyMemoryHours: number;
  reevaluateMinutes: number;
};

export const EMPTY_STATE: HotDeskState = { lastSentAt: 0, posts: [] };

function positive(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function hotDeskPolicy(env: Record<string, string | undefined> = process.env): HotDeskPolicy {
  return {
    minIntervalMinutes: positive(env.ODDSFRONT_HOT_DESK_MIN_INTERVAL_MINUTES, 90),
    maxPerDay: positive(env.ODDSFRONT_HOT_DESK_MAX_PER_DAY, 8),
    marketRepeatHours: positive(env.ODDSFRONT_HOT_DESK_MARKET_REPEAT_HOURS, 24),
    marketRepeatMovePp: positive(env.ODDSFRONT_HOT_DESK_MARKET_REPEAT_MOVE_PP, 10),
    storyMemoryHours: positive(env.ODDSFRONT_HOT_DESK_STORY_MEMORY_HOURS, 48),
    reevaluateMinutes: positive(env.ODDSFRONT_HOT_DESK_REEVALUATE_MINUTES, 120),
  };
}

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Why the next post may not go out now, or null when it is due. */
export function publicationBlock(state: HotDeskState, policy: HotDeskPolicy, now = Date.now()): string | null {
  if (state.pending) return "pending-outcome";
  if (state.lastSentAt > now) return "clock-skew";
  if (state.lastSentAt && now - state.lastSentAt < policy.minIntervalMinutes * 60_000) return "interval-not-due";
  if (state.posts.filter(post => utcDay(Date.parse(post.at)) === utcDay(now)).length >= policy.maxPerDay) return "daily-limit";
  return null;
}

export function storyAlreadyPosted(state: HotDeskState, fingerprint: readonly string[], policy: HotDeskPolicy, now = Date.now()) {
  return state.posts.some(post => now - Date.parse(post.at) <= policy.storyMemoryHours * 60 * 60_000 && sameStory(post.storyFingerprint, fingerprint));
}

/** A market rests for a day after a post unless it has moved sharply since. */
export function marketResting(state: HotDeskState, marketId: string, dayChange: number | null, policy: HotDeskPolicy, now = Date.now()) {
  const last = state.posts.filter(post => post.marketId === marketId).map(post => Date.parse(post.at)).toSorted().at(-1);
  if (last === undefined || now - last >= policy.marketRepeatHours * 60 * 60_000) return false;
  return !(dayChange !== null && Math.abs(dayChange * 100) >= policy.marketRepeatMovePp);
}

/** True when the news cycle holds a development the editor has not judged recently. */
export function needsEvaluation(state: HotDeskState, clusters: readonly { fingerprint: string[]; coverage: number }[], policy: HotDeskPolicy, now = Date.now(), minCoverage = 2) {
  const evaluated = state.evaluated;
  if (!evaluated || now - Date.parse(evaluated.at) >= policy.reevaluateMinutes * 60_000) return true;
  return clusters.some(cluster => cluster.coverage >= minCoverage && !evaluated.fingerprints.some(seen => sameStory(seen, cluster.fingerprint)));
}

export function recordPost(state: HotDeskState, post: HotDeskPost, now = Date.now()): HotDeskState {
  const { pending: _pending, ...rest } = state;
  void _pending;
  return { ...rest, lastSentAt: now, posts: [...state.posts, post].filter(item => now - Date.parse(item.at) <= 14 * 24 * 60 * 60_000).slice(-500) };
}
