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
import { formatMarketTitle } from "@/lib/market-title";
import {
  buildDropsBotTrackUrl,
  isOfficialPolymarketEventUrl,
  POLYMARKET_REFERRAL_CODE,
  toPolymarketReferralUrl,
} from "@/lib/polymarket-links";

const ACTIVITY_TTL_MS = 15 * 60 * 1_000;
const MAX_VISIBLE_NOTICES = 3;
const MIN_ACTIVITY_EVENT_VOLUME = 1_000_000;
const ODDS_CHANGE_THRESHOLD = 0.2;
const ACTIVITY_RISE_TONE = "#22DF91";
const ACTIVITY_DROP_TONE = "#FF5368";
const ACTIVITY_REFRESH_MS = 60_000;
const ACTIVITY_REFRESH_JITTER_MS = 15_000;
const ACTIVITY_INITIAL_JITTER_MS = 60_000;

type ActivityWindowLabel = "1h" | "24h" | "7d";

interface QualifyingMove {
  change: number;
  windowLabel: ActivityWindowLabel;
}

interface ActivityNotice {
  id: string;
  kind: ConflictActivityKind;
  eventId: string | null;
  title: string;
  locationLabel: string;
  value: number;
  windowLabel: ActivityWindowLabel | null;
  outcome: string | null;
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
        typeof item.notional === "number" &&
        typeof item.occurredAt === "string" &&
        isOfficialPolymarketEventUrl(item.marketUrl),
    )
  );
}

function qualifyingMove(event: ConflictPreviewEvent): QualifyingMove | null {
  if (event.volume < MIN_ACTIVITY_EVENT_VOLUME) return null;

  const candidates: QualifyingMove[] = [];
  if (
    event.priceChange1h !== null &&
    Math.abs(event.priceChange1h) > ODDS_CHANGE_THRESHOLD
  ) {
    candidates.push({ change: event.priceChange1h, windowLabel: "1h" });
  }
  if (
    event.priceChange24h !== null &&
    Math.abs(event.priceChange24h) > ODDS_CHANGE_THRESHOLD
  ) {
    candidates.push({ change: event.priceChange24h, windowLabel: "24h" });
  }
  if (
    event.priceChange7d !== null &&
    Math.abs(event.priceChange7d) > ODDS_CHANGE_THRESHOLD
  ) {
    candidates.push({ change: event.priceChange7d, windowLabel: "7d" });
  }

  return (
    candidates.toSorted(
      (left, right) => Math.abs(right.change) - Math.abs(left.change),
    )[0] ?? null
  );
}

function moverNotices(feed: ConflictPreviewFeed): ActivityNotice[] {
  if (feed.dataMode !== "live") return [];
  const now = Date.now();
  const notices: ActivityNotice[] = [];

  for (const event of feed.events) {
    const move = qualifyingMove(event);
    if (!move) continue;
    const { change, windowLabel } = move;

    notices.push({
      id: `odds-${event.id}-${windowLabel}`,
      kind: change > 0 ? "odds-rise" : "odds-drop",
      eventId: event.id,
      title: event.title,
      locationLabel: event.locationLabel,
      value: Math.abs(change * 100),
      windowLabel,
      outcome: null,
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
  if (!event || !qualifyingMove(event)) return null;

  return {
    id: `trade-${item.id}`,
    kind: item.kind,
    eventId: event.id,
    title: item.title,
    locationLabel: event.locationLabel,
    value: item.notional,
    windowLabel: null,
    outcome: item.outcome,
    occurredAt,
    expiresAt,
    marketUrl,
  };
}

function noticeLabel(notice: ActivityNotice): string {
  if (notice.kind === "odds-rise") return `Odds +${notice.value.toFixed(1)}%`;
  if (notice.kind === "odds-drop") return `Odds -${notice.value.toFixed(1)}%`;
  if (notice.kind === "large-buy") return `Large BUY · ${notice.outcome}`;
  return `Large SELL · ${notice.outcome}`;
}

function selectVisibleNotices(notices: ActivityNotice[]): ActivityNotice[] {
  const newestFirst = notices.toSorted(
    (left, right) => right.occurredAt - left.occurredAt,
  );
  const trades = newestFirst.filter(
    (notice) => notice.kind === "large-buy" || notice.kind === "large-sell",
  );
  const movers = newestFirst.filter(
    (notice) => notice.kind === "odds-rise" || notice.kind === "odds-drop",
  );
  const reservedTradeCount = Math.min(2, trades.length);

  return [
    ...trades.slice(0, reservedTradeCount),
    ...movers.slice(0, MAX_VISIBLE_NOTICES - reservedTradeCount),
  ]
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, MAX_VISIBLE_NOTICES);
}

export function ActivityRail({
  feed,
  fixtureMode,
}: ActivityRailProps) {
  const seenNoticeIds = useRef(new Set<string>());
  const [notices, setNotices] = useState<ActivityNotice[]>([]);
  const [clock, setClock] = useState(() => Date.now());

  const addNotices = useCallback(
    (
      incoming: ActivityNotice[],
      validEventIds?: ReadonlySet<string>,
    ) => {
      const now = Date.now();
      const previouslySeen = new Set(seenNoticeIds.current);
      for (const notice of incoming) {
        if (notice.expiresAt > now) seenNoticeIds.current.add(notice.id);
      }
      setNotices((current) => {
        const active = current.filter(
          (notice) =>
            notice.expiresAt > now &&
            (!validEventIds ||
              notice.eventId === null ||
              validEventIds.has(notice.eventId)),
        );
        const merged = new Map(active.map((notice) => [notice.id, notice]));
        let changed = active.length !== current.length;

        for (const notice of incoming) {
          if (notice.expiresAt <= now) continue;
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

        return changed ? selectVisibleNotices([...merged.values()]) : current;
      });
    },
    [],
  );

  useEffect(() => {
    if (fixtureMode) return;
    addNotices(
      moverNotices(feed),
      new Set(feed.events.map((event) => event.id)),
    );
  }, [addNotices, feed, fixtureMode]);

  const eventsByUrl = useMemo(
    () =>
      new Map(
        feed.events
          .filter(
            (event): event is ConflictPreviewEvent & { marketUrl: string } =>
              isOfficialPolymarketEventUrl(event.marketUrl),
          )
          .map((event) => [toPolymarketReferralUrl(event.marketUrl)!, event]),
      ),
    [feed.events],
  );
  const eventIdQuery = useMemo(
    () =>
      [...feed.events]
        .filter((event) => qualifyingMove(event) !== null)
        .sort((left, right) => right.volume - left.volume)
        .map((event) => event.id.match(/^polymarket-(\d+)$/)?.[1] ?? null)
        .filter((id): id is string => Boolean(id))
        .slice(0, 60)
        .toSorted((left, right) => Number(left) - Number(right))
        .join(","),
    [feed.events],
  );

  useEffect(() => {
    if (fixtureMode || feed.dataMode !== "live" || !eventIdQuery) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/global-conflict-activity?eventIds=${encodeURIComponent(eventIdQuery)}`,
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
        addNotices(tradeNotices);
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
    eventIdQuery,
    eventsByUrl,
    feed.dataMode,
    fixtureMode,
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

  if (notices.length === 0) return null;

  return (
    <aside
      className={styles.activityRail}
      aria-label="Live market activity"
      aria-live="polite"
      data-activity-count={notices.length}
    >
      {notices.map((notice) => {
          const rising =
            notice.kind === "odds-rise" || notice.kind === "large-buy";
          const event = notice.eventId
            ? feed.events.find((candidate) => candidate.id === notice.eventId)
            : null;
          const tone = rising ? ACTIVITY_RISE_TONE : ACTIVITY_DROP_TONE;
          const referralMarketUrl = toPolymarketReferralUrl(notice.marketUrl);
          const trackUrl = event ? buildDropsBotTrackUrl(event.marketUrl) : null;

          return (
            <article
              key={notice.id}
              className={styles.activityCard}
              style={{ "--activity-tone": tone } as React.CSSProperties}
              data-activity-kind={notice.kind}
              data-activity-direction={rising ? "up" : "down"}
              data-event-id={notice.eventId ?? ""}
              data-expires-at={new Date(notice.expiresAt).toISOString()}
            >
              <div className={styles.activityMeta}>
                <span className={styles.activitySignal} aria-hidden="true">
                  {rising ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
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
                  onClick={() =>
                    setNotices((current) =>
                      current.filter((candidate) => candidate.id !== notice.id),
                    )
                  }
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              <p>{formatMarketTitle(notice.title)}</p>
              <div className={styles.activityFooter}>
                {event && event.countryCodes.length > 0 ? (
                  <div
                    className={styles.activityFlags}
                    aria-label={`Event participants: ${event.countryCodes.join(", ")}`}
                  >
                    {[...new Set(event.countryCodes)].slice(0, 3).map((code) => (
                      <CountryFlag
                        key={code}
                        code={code}
                        className={styles.activityCountryFlag}
                      />
                    ))}
                  </div>
                ) : null}
                <span>{notice.locationLabel}</span>
                {notice.kind === "large-buy" || notice.kind === "large-sell" ? (
                  <b>{formatMoney(notice.value)}</b>
                ) : null}
                <div className={styles.activityActions}>
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
