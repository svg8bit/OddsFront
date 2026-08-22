"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  POLYMARKET_LARGE_TRADE_USD,
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
const ACTIVITY_RISE_TONE = "#22DF91";
const ACTIVITY_DROP_TONE = "#FF5368";
const ACTIVITY_REFRESH_MS = 60_000;
const ACTIVITY_REFRESH_JITTER_MS = 15_000;
const ACTIVITY_INITIAL_DELAY_MS = 1_000;
const CONDITION_ID_PATTERN = /^0x[a-f0-9]{64}$/i;

type ActivityWindowLabel = "24h" | "7d";
type ActivityNoticeKind = Exclude<ConflictActivityKind, "large-sell">;
type ActivityNoticeSource = "trade" | "rolling";

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
  liveRefreshEnabled: boolean;
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

function tradeNotice(
  item: ConflictTradeActivity,
  expiresAfterSeconds: number,
  eventsByUrl: ReadonlyMap<string, ConflictPreviewEvent>,
): ActivityNotice | null {
  const occurredAt = Date.parse(item.occurredAt);
  if (
    item.kind !== "large-buy" ||
    !Number.isFinite(occurredAt) ||
    item.notional < POLYMARKET_LARGE_TRADE_USD
  ) {
    return null;
  }
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
  return `Large BUY ${formatMoney(notice.value)}`;
}

function noticeMetricLabel(
  notice: ActivityNotice,
  event: ConflictPreviewEvent | null,
): string | null {
  if (notice.kind === "large-buy") {
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
  const trades = newestFirst.filter((notice) => notice.kind === "large-buy");
  const rollingMovers = newestFirst.filter(
    (notice) =>
      notice.source === "rolling" &&
      (notice.kind === "odds-rise" || notice.kind === "odds-drop"),
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
  for (const notice of rollingMovers) {
    add(notice);
    if (selected.length >= MAX_VISIBLE_NOTICES) return selected;
  }
  for (const notice of trades) {
    add(notice);
    if (selected.length >= MAX_VISIBLE_NOTICES) break;
  }
  return selected;
}

function buildRollingNotices(feed: ConflictPreviewFeed): ActivityNotice[] {
  const eventsById = new Map(feed.events.map((event) => [event.id, event]));
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
}

export function ActivityRail({
  feed,
  fixtureMode,
  liveRefreshEnabled,
}: ActivityRailProps) {
  const [notices, setNotices] = useState<ActivityNotice[]>(() =>
    fixtureMode ? [] : buildRollingNotices(feed),
  );
  const seenNoticeIds = useRef(new Set(notices.map((notice) => notice.id)));
  const previousRollingNoticeIds = useRef(
    new Set(notices.map((notice) => notice.id)),
  );
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
    return fixtureMode ? [] : buildRollingNotices(feed);
  }, [feed, fixtureMode]);
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
    if (
      fixtureMode ||
      !liveRefreshEnabled ||
      feed.dataMode !== "live" ||
      !marketIdQuery
    ) {
      return;
    }
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
      } catch (error) {
        console.warn(
          "Polymarket activity refresh failed; keeping verified alerts.",
          error instanceof Error ? error.message : "Unknown error",
        );
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

    schedule(
      process.env.NODE_ENV === "production" ? ACTIVITY_INITIAL_DELAY_MS : 0,
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
    liveRefreshEnabled,
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
        const event = notice.eventId
          ? feed.events.find((candidate) => candidate.id === notice.eventId) ??
            null
          : null;
        const tone = rising ? ACTIVITY_RISE_TONE : ACTIVITY_DROP_TONE;
        const referralMarketUrl = toPolymarketReferralUrl(notice.marketUrl);
        const trackUrl = event ? buildDropsBotTrackUrl(event.marketUrl) : null;
        const metricLabel = noticeMetricLabel(notice, event);
        const metricAriaLabel =
          notice.kind === "large-buy"
            ? "Trade execution odds"
            : "Current YES probability";

        return (
            <article
              key={notice.id}
              className={styles.activityCard}
              style={{ "--activity-tone": tone } as React.CSSProperties}
              data-activity-kind={notice.kind}
              data-activity-source={notice.source}
              data-activity-window={notice.windowLabel ?? ""}
              data-activity-direction={rising ? "up" : "down"}
              data-notice-id={notice.id}
              data-event-id={notice.eventId ?? ""}
              data-expires-at={new Date(notice.expiresAt).toISOString()}
            >
              <div className={styles.activityMeta}>
                <span className={styles.activitySignal} aria-hidden="true">
                  {rising ? (
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
              <div className={styles.activityFooter} data-activity-footer>
                {event && event.countryCodes.length > 0 ? (
                  <div
                    className={styles.activityFlags}
                    data-activity-flags
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
                  <b data-activity-metric aria-label={metricAriaLabel}>
                    {metricLabel}
                  </b>
                ) : null}
                <div className={styles.activityActions} data-activity-actions>
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
