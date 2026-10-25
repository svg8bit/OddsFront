// Private wire-desk state: daily budgets, usage-limit back-off, the stories the
// editor already judged, the links that already fed an article, and a ledger
// of every story written or rejected, so no story is ever paid for twice.
import type { ConsumedLead, WrittenStory } from "./leads.ts";

export type LedgerEntry = WrittenStory & { key: string; status: "published" | "rejected" | "drafted"; slug?: string; reasons?: string[] };

export type WireDeskState = {
  version: 1;
  budget: { day: string; selectionCalls: number; writerCalls: number; published: number };
  backoff: { until: number; level: number };
  evaluated: { at: string; fingerprint: string[] }[];
  consumed: ConsumedLead[];
  ledger: LedgerEntry[];
};

export const EMPTY_WIRE_STATE: WireDeskState = { version: 1, budget: { day: "", selectionCalls: 0, writerCalls: 0, published: 0 }, backoff: { until: 0, level: 0 }, evaluated: [], consumed: [], ledger: [] };

export type WireDeskPolicy = {
  dailyArticles: number;
  dailyWriterCalls: number;
  dailySelectionCalls: number;
  perRun: number;
  burst: number;
  minCoverage: number;
  minPriority: number;
  reevaluateMinutes: number;
  windowHours: number;
  model: string;
};

function numberEnv(value: string | undefined, fallback: number, minimum = 0) {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function wireDeskPolicy(env: Record<string, string | undefined> = process.env): WireDeskPolicy {
  return {
    dailyArticles: numberEnv(env.ODDSFRONT_WIRE_DESK_DAILY_ARTICLES, 20),
    // Writing plus at most one rewrite per article, with headroom for rejected drafts.
    dailyWriterCalls: numberEnv(env.ODDSFRONT_WIRE_DESK_DAILY_WRITER_CALLS, 36),
    dailySelectionCalls: numberEnv(env.ODDSFRONT_WIRE_DESK_DAILY_SELECTION_CALLS, 48),
    perRun: numberEnv(env.ODDSFRONT_WIRE_DESK_PER_RUN, 3, 1),
    burst: numberEnv(env.ODDSFRONT_WIRE_DESK_BURST, 4),
    minCoverage: numberEnv(env.ODDSFRONT_WIRE_DESK_MIN_COVERAGE, 2, 1),
    minPriority: numberEnv(env.ODDSFRONT_WIRE_DESK_MIN_PRIORITY, 6, 1),
    reevaluateMinutes: numberEnv(env.ODDSFRONT_WIRE_DESK_REEVALUATE_MINUTES, 180),
    windowHours: numberEnv(env.ODDSFRONT_WIRE_DESK_WINDOW_HOURS, 10, 1),
    model: env.ODDSFRONT_WIRE_DESK_MODEL || "sonnet",
  };
}

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Today's counters (reset at 00:00 UTC). */
export function currentBudget(state: WireDeskState, now = Date.now()) {
  return state.budget.day === utcDay(now) ? state.budget : { day: utcDay(now), selectionCalls: 0, writerCalls: 0, published: 0 };
}

/**
 * Articles that may still be written today: the daily cap, paced through the
 * day (a burst allowance plus an even share of the elapsed hours) so a busy
 * morning cannot spend the whole day's budget.
 */
export function articleAllowance(state: WireDeskState, policy: WireDeskPolicy, now = Date.now()) {
  const budget = currentBudget(state, now);
  const elapsed = (now - Date.parse(`${utcDay(now)}T00:00:00Z`)) / 86_400_000;
  const paced = Math.min(policy.dailyArticles, Math.floor(policy.burst + policy.dailyArticles * elapsed));
  const byArticles = paced - budget.published;
  const byCalls = policy.dailyWriterCalls - budget.writerCalls;
  return Math.max(0, Math.min(policy.perRun, byArticles, byCalls));
}

/** Why this run may not call the editor at all, or null. */
export function runBlock(state: WireDeskState, policy: WireDeskPolicy, now = Date.now()): string | null {
  if (state.backoff.until > now) return "usage-limit-backoff";
  const budget = currentBudget(state, now);
  if (budget.selectionCalls >= policy.dailySelectionCalls) return "daily-selection-cap";
  if (articleAllowance(state, policy, now) <= 0) return "daily-article-cap";
  return null;
}

export function countCall(state: WireDeskState, kind: "selectionCalls" | "writerCalls", now = Date.now()): WireDeskState {
  const budget = currentBudget(state, now);
  return { ...state, budget: { ...budget, [kind]: budget[kind] + 1 } };
}

export function countPublished(state: WireDeskState, now = Date.now()): WireDeskState {
  const budget = currentBudget(state, now);
  return { ...state, budget: { ...budget, published: budget.published + 1 } };
}

/** 6, then 12, then at most 24 hours after a subscription usage-limit refusal. */
export function backOff(state: WireDeskState, now = Date.now()): WireDeskState {
  const level = Math.min(3, state.backoff.level + 1);
  return { ...state, backoff: { until: now + [6, 12, 24][level - 1]! * 3_600_000, level } };
}

export function clearBackOff(state: WireDeskState): WireDeskState {
  return state.backoff.level ? { ...state, backoff: { until: 0, level: 0 } } : state;
}

/** State with old entries dropped, so the file stays small. */
export function pruneState(state: WireDeskState, now = Date.now()): WireDeskState {
  const within = (iso: string, hours: number) => now - Date.parse(iso) <= hours * 3_600_000;
  return {
    ...state,
    evaluated: state.evaluated.filter(item => within(item.at, 12)).slice(-400),
    consumed: state.consumed.filter(item => within(item.at, 72)).slice(-3000),
    ledger: state.ledger.filter(item => within(item.at, 24 * 14)).slice(-2000),
  };
}
