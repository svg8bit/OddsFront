"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  X,
} from "lucide-react";

import { CountryFlag } from "@/features/global-conflict-map/preview/country-flag";
import { DropsBotTrackIcon } from "@/features/global-conflict-map/preview/dropsbot-track-icon";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import type {
  ConflictActivityFeed,
  ConflictActivityKind,
  ConflictPreviewEvent,
  ConflictPreviewFeed,
  ConflictTradeActivity,
} from "@/features/global-conflict-map/preview/types";
import { releaseAbsentActivityNoticeIds } from "@/lib/activity-notice-lifecycle";
import { buildRollingActivitySignals } from "@/lib/conflict-activity-signals";
import { formatMarketTitle } from "@/lib/market-title";
import {
  isPolymarketActivityEventCurrent,
  selectPolymarketActivityMarketIds,
} from "@/lib/polymarket-activity-query";
import {
  buildDropsBotTrackUrl,
  isOfficialPolymarketEventUrl,
  POLYMARKET_REFERRAL_CODE,
  toPolymarketReferralUrl,
} from "@/lib/polymarket-links";

const ACTIVITY_TTL_MS = 10 * 60 * 1_000;
const MAX_VISIBLE_NOTICES = 3;
const MAX_STORED_NOTICES = 12;
const ODDS_SNAPSHOT_CHANGE_THRESHOLD_POINTS = 2;
const ACTIVITY_RISE_TONE = "#22DF91";
const ACTIVITY_DROP_TONE = "#FF5368";
const ACTIVITY_VOLUME_TONE = "#FFB454";
const ACTIVITY_REFRESH_MS = 60_000;
const ACTIVITY_REFRESH_JITTER_MS = 15_000;
const ACTIVITY_INITIAL_JITTER_MS = 5_000;
const CONDITION_ID_PATTERN = /^0x[a-f0-9]{64}$/i;

type ActivityWindowLabel = "live" | "1h" | "24h";
type ActivityNoticeKind = ConflictActivityKind | "high-volume";
type ActivityNoticeSource = "trade" | "snapshot" | "rolling";

interface ActivityNotice {
  id: string;
  kind: ActivityNoticeKind;
  source: ActivityNoticeSource;
  eventId: string | null;
  marketConditionId: string | null;
  title: string;
  locationLabel: string;
  value: number;
  windowLabel: ActivityWindowLabel | null;
  outcome: string | null;
  outcomeOdds: number | null;
  occurredAt: number;
  expiresAt: number;
  marketUrl: string | null;
}

interface ActivityRailProps {
  feed: ConflictPreviewFeed;
  fixtureMode: boolean;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "now";
  return `${minutes}m`;
}

function isActivityFeed(value: unknown): value is ConflictActivityFeed {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConflictActivityFeed>;
  return (
    (candidate.dataMode === "live" || candidate.dataMode === "unavailable") &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.expiresAfterSeconds === "number" &&
    Array.isArray(candidate.items) &&
    candidate.items.every(
      (item) =>
        item &&
        (item.kind === "large-buy" || item.kind === "large-sell") &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.outcome === "string" &&
        typeof item.outcomeOdds === "number" &&
        Number.isFinite(item.outcomeOdds) &&
        item.outcomeOdds >= 0 &&
        item.outcomeOdds <= 100 &&
        typeof item.marketConditionId === "string" &&
        CONDITION_ID_PATTERN.test(item.marketConditionId) &&
        typeof item.notional === "number" &&
        typeof item.occurredAt === "string" &&
        isOfficialPolymarketEventUrl(item.marketUrl),
    )
  );
}

function snapshotMoverNotices(
  previousFeed: ConflictPreviewFeed,
  feed: ConflictPreviewFeed,
): ActivityNotice[] {
  if (previousFeed.dataMode !== "live" || feed.dataMode !== "live") return [];
  const now = Date.now();
  const previousUpdatedAt = Date.parse(previousFeed.updatedAt);
  const currentUpdatedAt = Date.parse(feed.updatedAt);
  const maximumBaselineAge = Math.max(
    previousFeed.refreshSeconds * 2 * 1_000,
    ACTIVITY_TTL_MS,
  );
  if (
    !Number.isFinite(previousUpdatedAt) ||
    !Number.isFinite(currentUpdatedAt) ||
    currentUpdatedAt <= previousUpdatedAt ||
    now - previousUpdatedAt > maximumBaselineAge
  ) {
    return [];
  }

  const previousEvents = new Map(
    previousFeed.events.map((event) => [event.id, event]),
  );
  const notices: ActivityNotice[] = [];

  for (const event of feed.events) {
    if (!isPolymarketActivityEventCurrent(event, now)) continue;
    const previousEvent = previousEvents.get(event.id);
    if (
      !previousEvent ||
      previousEvent.marketConditionId !== event.marketConditionId
    ) {
      continue;
    }
    const change = event.yesOdds - previousEvent.yesOdds;
    if (Math.abs(change) < ODDS_SNAPSHOT_CHANGE_THRESHOLD_POINTS) continue;

    notices.push({
      id: `odds-${event.id}-${feed.updatedAt}-${event.yesOdds}`,
      kind: change > 0 ? "odds-rise" : "odds-drop",
      source: "snapshot",
      eventId: event.id,
      marketConditionId: event.marketConditionId,
      title: event.title,
      locationLabel: event.locationLabel,
      value: Math.abs(change),
      windowLabel: "live",
      outcome: null,
      outcomeOdds: null,
      occurredAt: now,
      expiresAt: now + ACTIVITY_TTL_MS,
      marketUrl: toPolymarketReferralUrl(event.marketUrl),
    });
  }

  return notices.sort((left, right) => right.value - left.value).slice(0, 2);
}

function tradeNotice(
  item: ConflictTradeActivity,
  expiresAfterSeconds: number,
  eventsByUrl: ReadonlyMap<string, ConflictPreviewEvent>,
): ActivityNotice | null {
  const occurredAt = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAt)) return null;
  const expiresAt = occurredAt + expiresAfterSeconds * 1_000;
  if (expiresAt <= Date.now()) return null;
  const marketUrl = toPolymarketReferralUrl(item.marketUrl);
  if (!marketUrl) return null;
  const event = eventsByUrl.get(marketUrl) ?? null;
  if (
    !event ||
    !isPolymarketActivityEventCurrent(event) ||
    item.marketConditionId !== event.marketConditionId
  ) {
    return null;
  }

  return {
    id: `trade-${item.id}`,
    kind: item.kind,
    source: "trade",
    eventId: event.id,
    marketConditionId: item.marketConditionId,
    title: item.title,
    locationLabel: event.locationLabel,
    value: item.notional,
    windowLabel: null,
    outcome: item.outcome,
    outcomeOdds: item.outcomeOdds,
    occurredAt,
    expiresAt,
    marketUrl,
  };
}

function noticeLabel(notice: ActivityNotice): string {
  if (notice.kind === "odds-rise") return `Odds +${notice.value.toFixed(1)}%`;
  if (notice.kind === "odds-drop") return `Odds -${notice.value.toFixed(1)}%`;
  if (notice.kind === "high-volume") return `Volume ${formatMoney(notice.value)}`;
  if (notice.kind === "large-buy") {
    return `Large BUY ${formatMoney(notice.value)}`;
  }
  return `Large SELL ${formatMoney(notice.value)}`;
}

function noticeMetricLabel(
  notice: ActivityNotice,
  event: ConflictPreviewEvent | null,
): string | null {
  if (notice.kind === "large-buy" || notice.kind === "large-sell") {
    const outcome = notice.outcome?.toUpperCase();
    if (!outcome) return null;
    return notice.outcomeOdds === null
      ? outcome
      : `${outcome} ${notice.outcomeOdds}%`;
  }
  return event ? `YES ${event.yesOdds}%` : null;
}

function selectVisibleNotices(notices: ActivityNotice[]): ActivityNotice[] {
  const newestFirst = notices.toSorted(
    (left, right) =>
      right.occurredAt - left.occurredAt || right.value - left.value,
  );
  const trades = newestFirst.filter(
    (notice) => notice.kind === "large-buy" || notice.kind === "large-sell",
  );
  const liveMovers = newestFirst.filter(
    (notice) =>
      notice.source === "snapshot" &&
      (notice.kind === "odds-rise" || notice.kind === "odds-drop"),
  );
  const rollingMovers = newestFirst.filter(
    (notice) =>
      notice.source === "rolling" &&
      (notice.kind === "odds-rise" || notice.kind === "odds-drop"),
  );
  const volumeSignals = newestFirst.filter(
    (notice) => notice.kind === "high-volume",
  );
  const selected: ActivityNotice[] = [];
  const selectedIds = new Set<string>();
  const selectedEventIds = new Set<string>();
  const add = (notice: ActivityNotice) => {
    if (
      selectedIds.has(notice.id) ||
      (notice.eventId !== null && selectedEventIds.has(notice.eventId))
    ) {
      return false;
    }
    selected.push(notice);
    selectedIds.add(notice.id);
    if (notice.eventId !== null) selectedEventIds.add(notice.eventId);
    return true;
  };

  let tradeCount = 0;
  for (const notice of trades) {
    if (add(notice)) tradeCount += 1;
    if (tradeCount >= 2) break;
  }
  for (const group of [liveMovers, rollingMovers, volumeSignals]) {
    for (const notice of group) {
      add(notice);
      if (selected.length >= MAX_VISIBLE_NOTICES) return selected;
    }
  }
  for (const notice of trades) {
    add(notice);
    if (selected.length >= MAX_VISIBLE_NOTICES) break;
  }
  return selected;
}

export function ActivityRail({
  feed,
  fixtureMode,
}: ActivityRailProps) {
  const seenNoticeIds = useRef(new Set<string>());
  const previousRollingNoticeIds = useRef(new Set<string>());
  const previousFeed = useRef<ConflictPreviewFeed | null>(null);
  const [notices, setNotices] = useState<ActivityNotice[]>([]);
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [clock, setClock] = useState(() => Date.now());

  const addNotices = useCallback(
    (
      incoming: ActivityNotice[],
      validEventIds?: ReadonlySet<string>,
      validMarketConditionIds?: ReadonlySet<string>,
    ) => {
      const now = Date.now();
      const isValidNotice = (notice: ActivityNotice) => {
        if (notice.eventId === null) return true;
        return (
          (!validEventIds || validEventIds.has(notice.eventId)) &&
          notice.marketConditionId !== null &&
          (!validMarketConditionIds ||
            validMarketConditionIds.has(notice.marketConditionId))
        );
      };
      const previouslySeen = new Set(seenNoticeIds.current);
      for (const notice of incoming) {
        if (notice.expiresAt > now && isValidNotice(notice)) {
          seenNoticeIds.current.add(notice.id);
        }
      }
      setNotices((current) => {
        const active = current.filter(
          (notice) =>
            notice.expiresAt > now &&
            isValidNotice(notice),
        );
        const merged = new Map(active.map((notice) => [notice.id, notice]));
        let changed = active.length !== current.length;

        for (const notice of incoming) {
          if (notice.expiresAt <= now || !isValidNotice(notice)) continue;
          const existing = merged.get(notice.id);
          if (existing) {
            merged.set(notice.id, {
              ...notice,
              occurredAt: existing.occurredAt,
              expiresAt: existing.expiresAt,
            });
            changed = true;
            continue;
          }
          if (previouslySeen.has(notice.id)) continue;
          merged.set(notice.id, notice);
          changed = true;
        }

        return changed
          ? [...merged.values()]
              .toSorted((left, right) => right.occurredAt - left.occurredAt)
              .slice(0, MAX_STORED_NOTICES)
          : current;
      });
    },
    [],
  );

  const currentActivityEvents = useMemo(
    () =>
      feed.events.filter((event) =>
        isPolymarketActivityEventCurrent(event),
      ),
    [feed.events],
  );
  const currentActivityEventIds = useMemo(
    () => new Set(currentActivityEvents.map((event) => event.id)),
    [currentActivityEvents],
  );
  const currentActivityMarketConditionIds = useMemo(
    () =>
      new Set(
        currentActivityEvents
          .map((event) => event.marketConditionId)
          .filter((marketId): marketId is string => Boolean(marketId)),
      ),
    [currentActivityEvents],
  );

  useEffect(() => {
    if (fixtureMode) return;
    const baseline = previousFeed.current;
    previousFeed.current = feed;
    if (!baseline) return;
    addNotices(
      snapshotMoverNotices(baseline, feed),
      currentActivityEventIds,
      currentActivityMarketConditionIds,
    );
  }, [
    addNotices,
    currentActivityEventIds,
    currentActivityMarketConditionIds,
    feed,
    fixtureMode,
  ]);

  const eventsByUrl = useMemo(
    () =>
      new Map(
        currentActivityEvents
          .filter(
            (event): event is ConflictPreviewEvent & { marketUrl: string } =>
              isOfficialPolymarketEventUrl(event.marketUrl),
          )
          .map((event) => [toPolymarketReferralUrl(event.marketUrl)!, event]),
      ),
    [currentActivityEvents],
  );
  const eventsById = useMemo(
    () => new Map(feed.events.map((event) => [event.id, event])),
    [feed.events],
  );
  const rollingNotices = useMemo(() => {
    return buildRollingActivitySignals(feed)
      .map((signal): ActivityNotice | null => {
        const event = eventsById.get(signal.eventId);
        if (!event) return null;
        return {
          id: `${signal.id}-${event.marketConditionId}`,
          kind: signal.kind,
          source: "rolling",
          eventId: signal.eventId,
          marketConditionId: event.marketConditionId,
          title: event.title,
          locationLabel: event.locationLabel,
          value: signal.value,
          windowLabel: signal.windowLabel,
          outcome: null,
          outcomeOdds: null,
          occurredAt: signal.observedAt,
          expiresAt: signal.observedAt + ACTIVITY_TTL_MS,
          marketUrl: toPolymarketReferralUrl(event.marketUrl),
        };
      })
      .filter((notice): notice is ActivityNotice => Boolean(notice));
  }, [eventsById, feed]);
  useEffect(() => {
    const currentRollingNoticeIds = new Set(
      rollingNotices.map((notice) => notice.id),
    );
    releaseAbsentActivityNoticeIds(
      seenNoticeIds.current,
      previousRollingNoticeIds.current,
      currentRollingNoticeIds,
    );
    previousRollingNoticeIds.current = currentRollingNoticeIds;
    addNotices(
      rollingNotices,
      currentActivityEventIds,
      currentActivityMarketConditionIds,
    );
  }, [
    addNotices,
    currentActivityEventIds,
    currentActivityMarketConditionIds,
    rollingNotices,
  ]);
  const marketIdQuery = useMemo(
    () => selectPolymarketActivityMarketIds(feed.events).join(","),
    [feed.events],
  );

  useEffect(() => {
    if (fixtureMode || feed.dataMode !== "live" || !marketIdQuery) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/global-conflict-activity?marketIds=${encodeURIComponent(marketIdQuery)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (cancelled || !isActivityFeed(payload) || payload.dataMode !== "live") {
          return;
        }
        const tradeNotices = payload.items
          .map((item) =>
            tradeNotice(item, payload.expiresAfterSeconds, eventsByUrl),
          )
          .filter((notice): notice is ActivityNotice => Boolean(notice));
        addNotices(
          tradeNotices,
          currentActivityEventIds,
          currentActivityMarketConditionIds,
        );
      } catch {
        // The map remains usable when the optional activity stream is unavailable.
      }
    };

    let timer: number | null = null;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        if (!cancelled) {
          schedule(
            ACTIVITY_REFRESH_MS +
              Math.floor(Math.random() * ACTIVITY_REFRESH_JITTER_MS),
          );
        }
      }, delay);
    };

    // Small per-client jitter prevents a traffic spike from turning into a
    // synchronized polling spike while keeping the rail effectively live.
    schedule(
      process.env.NODE_ENV === "production"
        ? Math.floor(Math.random() * ACTIVITY_INITIAL_JITTER_MS)
        : 0,
    );
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    addNotices,
    currentActivityEventIds,
    currentActivityMarketConditionIds,
    eventsByUrl,
    feed.dataMode,
    fixtureMode,
    marketIdQuery,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setNotices((current) =>
        current.filter((notice) => notice.expiresAt > now),
      );
    }, 5_000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleNotices = selectVisibleNotices(
    notices.filter(
      (notice) => {
        if (
          notice.expiresAt <= clock ||
          dismissedNoticeIds.has(notice.id)
        ) {
          return false;
        }
        if (notice.eventId === null) return true;
        const event = eventsById.get(notice.eventId);
        return Boolean(
          event &&
            isPolymarketActivityEventCurrent(event, clock) &&
            notice.marketConditionId !== null &&
            notice.marketConditionId === event.marketConditionId,
        );
      },
    ),
  );

  if (visibleNotices.length === 0) return null;

  return (
    <aside
      className={styles.activityRail}
      aria-label="Live market activity"
      aria-live="polite"
      data-activity-count={visibleNotices.length}
      data-feed-updated-at={feed.updatedAt}
    >
      {visibleNotices.map((notice) => {
          const rising =
            notice.kind === "odds-rise" || notice.kind === "large-buy";
          const neutral = notice.kind === "high-volume";
          const event = notice.eventId
            ? feed.events.find((candidate) => candidate.id === notice.eventId) ??
              null
            : null;
          const tone = neutral
            ? ACTIVITY_VOLUME_TONE
            : rising
              ? ACTIVITY_RISE_TONE
              : ACTIVITY_DROP_TONE;
          const referralMarketUrl = toPolymarketReferralUrl(notice.marketUrl);
          const trackUrl = event ? buildDropsBotTrackUrl(event.marketUrl) : null;
          const metricLabel = noticeMetricLabel(notice, event);
          const metricAriaLabel =
            notice.kind === "large-buy" || notice.kind === "large-sell"
              ? "Trade execution odds"
              : "Current YES probability";

          return (
            <article
              key={notice.id}
              className={styles.activityCard}
              style={{ "--activity-tone": tone } as React.CSSProperties}
              data-activity-kind={notice.kind}
              data-activity-source={notice.source}
              data-activity-direction={
                neutral ? "neutral" : rising ? "up" : "down"
              }
              data-notice-id={notice.id}
              data-event-id={notice.eventId ?? ""}
              data-expires-at={new Date(notice.expiresAt).toISOString()}
            >
              <div className={styles.activityMeta}>
                <span className={styles.activitySignal} aria-hidden="true">
                  {neutral ? (
                    <ActivityIcon size={15} />
                  ) : rising ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <ArrowDownRight size={15} />
                  )}
                </span>
                <strong>{noticeLabel(notice)}</strong>
                {notice.windowLabel ? <span>{notice.windowLabel}</span> : null}
                <time dateTime={new Date(notice.occurredAt).toISOString()}>
                  {relativeTime(notice.occurredAt, clock)}
                </time>
                <button
                  type="button"
                  className={styles.activityDismiss}
                  aria-label="Dismiss activity notification"
                  onClick={() => {
                    setDismissedNoticeIds((current) => {
                      const next = new Set(current);
                      next.add(notice.id);
                      return next;
                    });
                    setNotices((current) =>
                      current.filter((candidate) => candidate.id !== notice.id),
                    );
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              <p>{formatMarketTitle(notice.title)}</p>
              <div
                className={styles.activityFooter}
                data-activity-footer
              >
                {event && event.countryCodes.length > 0 ? (
                  <div
                    className={styles.activityFlags}
                    data-activity-flags
                    role="img"
                    aria-label={`Event participants: ${event.countryCodes.join(", ")}`}
                  >
                    {[...new Set(event.countryCodes)]
                      .slice(0, 3)
                      .map((code) => (
                        <CountryFlag
                          key={code}
                          code={code}
                          className={styles.activityCountryFlag}
                        />
                      ))}
                  </div>
                ) : null}
                {metricLabel ? (
                  <b
                    data-activity-metric
                    aria-label={metricAriaLabel}
                  >
                    {metricLabel}
                  </b>
                ) : null}
                <div
                  className={styles.activityActions}
                  data-activity-actions
                >
                  {trackUrl ? (
                    <a
                      className={styles.activityTrackLink}
                      href={trackUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Track this market in DropsBot"
                    >
                      <DropsBotTrackIcon className={styles.trackIcon} />
                      Track
                    </a>
                  ) : null}
                  {referralMarketUrl ? (
                    <a
                      href={referralMarketUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open activity market on Polymarket via DropsBot"
                      data-referral-code={POLYMARKET_REFERRAL_CODE}
                      title="Polymarket · DropsBot referral"
                    >
                      Market <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
    </aside>
  );
}
