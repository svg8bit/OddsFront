import { headlineTokens, sameStory, similarTokens } from "./headlines.ts";

export type HotDeskPost = {
  at: string;
  storyTitle: string;
  storyFingerprint: string[];
  marketId: string;
  dayChange: number | null;
  messages: { en: number | null; ru: number | null };
  /** What the channel actually read (a --topic run can merge clusters whose first title is another story). */
  titleEn?: string;
  titleRu?: string;
  contextEn?: string;
  marketQuestion?: string;
  eventTitle?: string;
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
  /** Hours before another market of the same theme ("US–Iran ceasefire", any deadline) may be posted. */
  themeRepeatHours: number;
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
    themeRepeatHours: positive(env.ODDSFRONT_HOT_DESK_THEME_REPEAT_HOURS, 12),
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

// Deadline words do not change what a market is about: "ceasefire through October 31" and "ceasefire
// through the midterms" are one theme.
const DEADLINE_WORDS = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "end", "through", "continue", "continues", "midterm", "midterms", "election", "year", "month", "week", "announce", "announces", "will"]);

/** The stems that say what a market is about, without its deadline. */
export function marketTheme(question: string) {
  return headlineTokens(question).filter(token => !DEADLINE_WORDS.has(token) && !/^\d/.test(token));
}

/** Two market questions on one theme once their deadlines are ignored. */
export function sameMarketTheme(left: string, right: string) {
  return sameTheme(marketTheme(left), marketTheme(right));
}

function sameTheme(left: readonly string[], right: readonly string[]) {
  const shared = left.filter(token => right.some(other => similarTokens(token, other))).length;
  return shared >= 2 && shared / Math.max(1, Math.min(left.length, right.length)) >= 0.75;
}

function sameCopy(left: string, right: string) {
  const a = headlineTokens(left);
  const b = headlineTokens(right);
  const shared = a.filter(token => b.some(other => similarTokens(token, other))).length;
  return shared >= 4 && shared / Math.max(1, Math.min(a.length, b.length)) >= 0.45;
}

export type PostCandidate = { marketId: string; marketQuestion: string; eventTitle?: string | null; titleEn: string; contextEn: string; storyFingerprint: readonly string[]; dayChange: number | null };

/**
 * Why this post would repeat one the channels already carry, or null. Checked after the editor wrote
 * the copy, against what was actually posted: the same market (unless it moved sharply), another
 * market of the same theme within `themeRepeatHours`, or copy telling the same story.
 */
export function repeatReason(state: HotDeskState, candidate: PostCandidate, policy: HotDeskPolicy, now = Date.now()): string | null {
  if (marketResting(state, candidate.marketId, candidate.dayChange, policy, now)) return `market ${candidate.marketId} was posted in the last ${policy.marketRepeatHours} h`;
  const theme = marketTheme(candidate.marketQuestion);
  const eventTheme = candidate.eventTitle ? marketTheme(candidate.eventTitle) : [];
  for (const post of state.posts.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const age = now - Date.parse(post.at);
    const when = new Date(post.at).toISOString().slice(11, 16);
    if (age <= policy.themeRepeatHours * 3_600_000 && post.marketQuestion) {
      const previous = marketTheme(post.marketQuestion);
      const previousEvent = post.eventTitle ? marketTheme(post.eventTitle) : [];
      if (sameTheme(theme, previous) || (eventTheme.length >= 2 && previousEvent.length >= 2 && sameTheme(eventTheme, previousEvent))) return `same market theme as the ${when} UTC post ("${post.marketQuestion}")`;
    }
    if (age > policy.storyMemoryHours * 3_600_000) continue;
    if (sameStory(post.storyFingerprint, [...candidate.storyFingerprint])) return `same story as the ${when} UTC post`;
    if (post.titleEn && (sameCopy(post.titleEn, candidate.titleEn) || sameCopy(`${post.titleEn} ${post.contextEn ?? ""}`, `${candidate.titleEn} ${candidate.contextEn}`))) return `same copy as the ${when} UTC post ("${post.titleEn}")`;
  }
  return null;
}

/** The channels' recent posts as the editor should see them: headline and market. */
export function recentPostLines(state: HotDeskState, policy: HotDeskPolicy, now = Date.now()) {
  return state.posts
    .filter(post => now - Date.parse(post.at) <= policy.storyMemoryHours * 3_600_000)
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map(post => `${post.titleEn ?? post.storyTitle}${post.marketQuestion ? ` — market: ${post.marketQuestion}` : ""} (${Math.round((now - Date.parse(post.at)) / 36e5)} h ago)`);
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
