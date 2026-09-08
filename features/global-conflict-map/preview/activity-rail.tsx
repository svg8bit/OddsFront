"use client";
import Link from "next/link";
import { marketLabel } from "@/lib/news/market-labels";
import { useLocale } from "@/components/locale-provider";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Newspaper,
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
import {
  ACTIVITY_DISMISSAL_STORAGE_KEY,
  activeActivityDismissals,
  getInitialActivityClock,
} from "@/lib/activity-notice-lifecycle";
import { ACTIVITY_DISPLAY_TTL_MS, buildRollingActivitySignals } from "@/lib/conflict-activity-signals";
import { formatMarketTitle } from "@/lib/market-title";
import { articleText } from "@/lib/news/locale";
import type { NewsActivityAlert } from "@/lib/news/alert-matching";
import { availableNewsArticlePath } from "@/lib/news/routing";
import type { NewsArticle } from "@/lib/news/types";
import {
  batchPolymarketActivityMarketIds,
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

const MAX_VISIBLE_NOTICES = 3;
const MAX_STORED_NOTICES = 12;
const ACTIVITY_RISE_TONE = "#22DF91";
const ACTIVITY_DROP_TONE = "#FF5368";
const NEWS_ALERT_TONE = "#5A8DFF";
const ACTIVITY_REFRESH_MS = 60_000;
const ACTIVITY_REFRESH_JITTER_MS = 15_000;
const ACTIVITY_INITIAL_DELAY_MS = 1_000;
const CONDITION_ID_PATTERN = /^0x[a-f0-9]{64}$/i;

type ActivityWindowLabel = "24H" | "7D";
type ActivityNoticeKind = Exclude<ConflictActivityKind, "large-sell"> | "news";
type ActivityNoticeSource = "trade" | "rolling" | "news";

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
  article: NewsArticle | null;
  articleUrl: string | null;
}

interface ActivityRailProps {
  feed: ConflictPreviewFeed;
  fixtureMode: boolean;
  liveRefreshEnabled: boolean;
  newsRefreshEnabled: boolean;
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
  const now = Date.now();
  if (
    item.kind !== "large-buy" ||
    !Number.isFinite(occurredAt) ||
    occurredAt > now + 60_000 ||
    !Number.isFinite(item.notional) ||
    !Number.isFinite(expiresAfterSeconds) ||
    expiresAfterSeconds <= 0 ||
    item.notional < POLYMARKET_LARGE_TRADE_USD
  ) {
    return null;
  }
  const expiresAt = occurredAt + Math.min(expiresAfterSeconds * 1_000, ACTIVITY_DISPLAY_TTL_MS);
  if (expiresAt <= now) return null;
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
    article: null,
    articleUrl: null,
  };
}

function noticeLabel(notice: ActivityNotice): string {
  if (notice.kind === "news") return "News";
  if (notice.kind === "odds-rise") return `+${notice.value.toFixed(1)}%`;
  if (notice.kind === "odds-drop") return `-${notice.value.toFixed(1)}%`;
  return `Large BUY ${formatMoney(notice.value)}`;
}

function noticeMetricLabel(
  notice: ActivityNotice,
  event: ConflictPreviewEvent | null,
): string | null {
  if (notice.kind === "news") return null;
  if (notice.kind === "large-buy") {
    const outcome = notice.outcome?.toUpperCase();
    if (!outcome) return null;
    return notice.outcomeOdds === null
      ? outcome
      : `${outcome} ${notice.outcomeOdds}%`;
  }
  return event ? `YES ${event.yesOdds}%` : null;
}

function selectVisibleNotices(notices: ActivityNotice[], reserveRolling = false): ActivityNotice[] {
  const newestFirst = notices.toSorted(
    (left, right) =>
      right.occurredAt - left.occurredAt || right.value - left.value,
  );
  const news = newestFirst.filter((notice) => notice.kind === "news");
  const trades = newestFirst.filter((notice) => notice.kind === "large-buy");
  // Preserve the day/week selection order; these are rolling comparisons.
  const rollingMovers = notices.filter(
    (notice) =>
      notice.source === "rolling" &&
      (notice.kind === "odds-rise" || notice.kind === "odds-drop"),
  );
  const selected: ActivityNotice[] = [];
  const selectedIds = new Set<string>();
  const selectedEventIds = new Set<string>();
  const add = (notice: ActivityNotice) => {
    if (
      selected.length >= MAX_VISIBLE_NOTICES ||
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

  for (const notice of news.slice(0, 2)) {
    add(notice);
  }
  if (selected.length >= MAX_VISIBLE_NOTICES) return selected;

  let tradeCount = 0;
  for (const notice of trades) {
    if (selected.length >= MAX_VISIBLE_NOTICES - 1) break;
    if (add(notice)) tradeCount += 1;
    if (tradeCount >= 2) break;
  }
  for (const notice of rollingMovers) {
    add(notice);
    if (selected.length >= MAX_VISIBLE_NOTICES) return selected;
  }
  if (reserveRolling) return selected;
  for (const notice of trades) {
    add(notice);
    if (selected.length >= MAX_VISIBLE_NOTICES) break;
  }
  return selected;
}

function buildRollingNotices(
  feed: ConflictPreviewFeed,
  now = Date.now(),
  cycleStartedAt = 0,
  options: Parameters<typeof buildRollingActivitySignals>[3] = {},
): ActivityNotice[] {
  const eventsById = new Map(feed.events.map((event) => [event.id, event]));
  return buildRollingActivitySignals(feed, now, cycleStartedAt, options)
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
        expiresAt: signal.expiresAt,
        marketUrl: toPolymarketReferralUrl(event.marketUrl),
        article: null,
        articleUrl: null,
      };
    })
    .filter((notice): notice is ActivityNotice => Boolean(notice));
}

function isNewsIndex(value: unknown): value is { updatedAt: string; articles: NewsArticle[] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { updatedAt?: unknown; articles?: unknown };
  return typeof candidate.updatedAt === "string" &&
    Number.isFinite(Date.parse(candidate.updatedAt)) &&
    Array.isArray(candidate.articles) &&
    candidate.articles.every(article =>
      article &&
      typeof article.id === "string" &&
      typeof article.slug === "string" &&
      typeof article.title === "string" &&
      typeof article.publishedAt === "string" &&
      Array.isArray(article.countries) &&
      (article.alert === null || article.alert === undefined ||
        ((article.alert.kind === "strike" || article.alert.kind === "ceasefire") &&
          Array.isArray(article.alert.actorCountries) &&
          Array.isArray(article.alert.targetCountries))),
    );
}

function newsNotice(alert: NewsActivityAlert): ActivityNotice {
  return {
    id: `news-${alert.article.id}`,
    kind: "news",
    source: "news",
    eventId: alert.event?.id ?? null,
    marketConditionId: alert.event?.marketConditionId ?? null,
    title: alert.article.title,
    locationLabel: alert.event?.locationLabel ?? "",
    value: alert.event ? alert.event.marketVolume ?? alert.event.volume : 0,
    windowLabel: null,
    outcome: null,
    outcomeOdds: null,
    occurredAt: alert.publishedAt,
    expiresAt: alert.expiresAt,
    marketUrl: alert.event ? toPolymarketReferralUrl(alert.event.marketUrl) : null,
    article: alert.article,
    articleUrl: `/news/${(alert.article.countries[0] || "world").toLowerCase()}/${alert.article.slug}`,
  };
}

export function ActivityRail({
  feed,
  fixtureMode,
  liveRefreshEnabled,
  newsRefreshEnabled,
}: ActivityRailProps) {
  const { locale, t, translate } = useLocale();
  const feedClock = getInitialActivityClock(feed.updatedAt);
  const [notices, setNotices] = useState<ActivityNotice[]>([]);
  const seenNoticeIds = useRef(new Set(notices.map((notice) => notice.id)));
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(
    () => {
      try {
        return new Set(Object.keys(activeActivityDismissals(
          JSON.parse(sessionStorage.getItem(ACTIVITY_DISMISSAL_STORAGE_KEY) || "{}"), Date.now(),
        )));
      } catch {
        return new Set();
      }
    },
  );
  // This rail mounts after hydration: use wall time, never an old ISR timestamp
  // as "now", which made expired server-rendered cards flash and disappear.
  const [clock, setClock] = useState(() => Date.now());
  const [newsIndex, setNewsIndex] = useState<{
    articles: NewsArticle[];
    receivedAt: number;
    updatedAt: string;
  }>({ articles: [], receivedAt: 0, updatedAt: "" });
  const [newsNotices, setNewsNotices] = useState<ActivityNotice[]>([]);
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
        isPolymarketActivityEventCurrent(event, feedClock),
      ),
    [feed.events, feedClock],
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
  useEffect(() => {
    if (fixtureMode || newsIndex.receivedAt === 0) return;
    let cancelled = false;
    void import("@/lib/news/alert-matching")
      .then(({ buildNewsActivityAlerts }) => {
        const next = buildNewsActivityAlerts(
          newsIndex.articles,
          feed.dataMode === "live" && Date.parse(feed.updatedAt) <= clock + 60_000 && clock - Date.parse(feed.updatedAt) < 10 * 60_000 ? feed.events : [],
          Math.max(clock, newsIndex.receivedAt),
        ).map(newsNotice);
        if (!cancelled) setNewsNotices(next);
      })
      .catch(() => {
        // Market activity stays available when the additive News matcher fails.
      });
    return () => { cancelled = true; };
  }, [clock, feed.events, feed.dataMode, feed.updatedAt, fixtureMode, newsIndex]);
  const marketIdQueries = useMemo(
    () =>
      batchPolymarketActivityMarketIds(
        selectPolymarketActivityMarketIds(feed.events),
      ).map((marketIds) => marketIds.join(",")),
    [feed.events],
  );

  useEffect(() => {
    if (fixtureMode || !newsRefreshEnabled) return;
    let cancelled = false;
    let inFlight = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8_000);
      try {
        const response = await fetch("/api/news", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          priority: "low",
          signal: controller.signal,
        });
        const payload: unknown = response.ok ? await response.json() : null;
        if (!cancelled && isNewsIndex(payload)) {
          setNewsIndex(current => Date.parse(current.updatedAt) >= Date.parse(payload.updatedAt)
            ? current
            : {
                articles: payload.articles.slice(0, 24),
                receivedAt: Date.now(),
                updatedAt: payload.updatedAt,
              });
        }
      } catch {
        // News alerts are additive; a failed refresh does not affect market alerts.
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        inFlight = false;
      }
    };
    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refresh();
        if (!cancelled) schedule(60_000);
      }, delay);
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    schedule(0);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [fixtureMode, newsRefreshEnabled]);

  useEffect(() => {
    if (
      fixtureMode ||
      !liveRefreshEnabled ||
      feed.dataMode !== "live" ||
      marketIdQueries.length === 0
    ) {
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const results = await Promise.allSettled(
        marketIdQueries.map(async (marketIdQuery) => {
          const response = await fetch(
            `/api/global-conflict-activity?marketIds=${encodeURIComponent(marketIdQuery)}`,
            { headers: { Accept: "application/json" }, cache: "no-store", priority: "low", signal: AbortSignal.timeout(10_000) },
          );
          if (!response.ok) {
            throw new Error(`Activity batch returned ${response.status}`);
          }
          const payload: unknown = await response.json();
          return isActivityFeed(payload) && payload.dataMode === "live"
            ? payload
            : null;
        }),
      );
      inFlight = false;
      if (cancelled) return;
      const failedBatchCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failedBatchCount > 0) {
        console.warn(
          `Polymarket activity refresh kept partial coverage; ${failedBatchCount}/${marketIdQueries.length} batches unavailable.`,
        );
      }
      const payloads = results
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<ConflictActivityFeed | null> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value)
        .filter((payload): payload is ConflictActivityFeed => payload !== null);
      const tradeNotices = payloads.flatMap((payload) =>
        payload.items
          .map((item) =>
            tradeNotice(item, payload.expiresAfterSeconds, eventsByUrl),
          )
          .filter((notice): notice is ActivityNotice => Boolean(notice)),
      );
      addNotices(
        tradeNotices,
        currentActivityEventIds,
        currentActivityMarketConditionIds,
      );
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

    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    schedule(
      process.env.NODE_ENV === "production" ? ACTIVITY_INITIAL_DELAY_MS : 0,
    );
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
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
    marketIdQueries,
  ]);

  useEffect(() => {
    const pruneExpiredNotices = () => {
      const now = Date.now();
      setClock(now);
      setNotices((current) =>
        current.filter((notice) => notice.expiresAt > now),
      );
    };
    pruneExpiredNotices();
    const interval = window.setInterval(pruneExpiredNotices, 5_000);
    window.addEventListener("focus", pruneExpiredNotices);
    window.addEventListener("pageshow", pruneExpiredNotices);
    document.addEventListener("visibilitychange", pruneExpiredNotices);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", pruneExpiredNotices);
      window.removeEventListener("pageshow", pruneExpiredNotices);
      document.removeEventListener("visibilitychange", pruneExpiredNotices);
    };
  }, []);

  const isVisible = (notice: ActivityNotice) => {
    if (notice.expiresAt <= clock || dismissedNoticeIds.has(notice.id)) return false;
    if (notice.eventId === null) return true;
    const event = eventsById.get(notice.eventId);
    return Boolean(
      event && isPolymarketActivityEventCurrent(event, clock) &&
      notice.marketConditionId !== null && notice.marketConditionId === event.marketConditionId,
    );
  };
  const available = [...newsNotices, ...notices].filter(isVisible);
  const leading = selectVisibleNotices(available, true);
  // Rotate over the slots actually available after news/trades. Preselecting
  // three movers and then truncating them permanently hid each third market.
  const rollingNotices = fixtureMode ? [] : buildRollingNotices(feed, clock, 0, {
    limit: MAX_VISIBLE_NOTICES - leading.length,
    excludedEventIds: new Set(leading.flatMap(notice => notice.eventId ? [notice.eventId] : [])),
  });
  const visibleNotices = selectVisibleNotices([...available, ...rollingNotices.filter(isVisible)]);

  if (visibleNotices.length === 0) return null;

  return (
    <aside
      className={styles.activityRail}
      aria-label={t("marketActivity")}
      aria-live="polite"
      data-activity-count={visibleNotices.length}
      data-feed-updated-at={feed.updatedAt}
    >
      {visibleNotices.map((notice) => {
        const news = notice.kind === "news";
        const rising =
          notice.kind === "odds-rise" || notice.kind === "large-buy";
        const event = notice.eventId
          ? feed.events.find((candidate) => candidate.id === notice.eventId) ??
            null
          : null;
        const tone = news
          ? NEWS_ALERT_TONE
          : rising ? ACTIVITY_RISE_TONE : ACTIVITY_DROP_TONE;
        const referralMarketUrl = toPolymarketReferralUrl(notice.marketUrl);
        const trackUrl = event ? buildDropsBotTrackUrl(event.marketUrl) : null;
        const metricLabel = noticeMetricLabel(notice, event);
        const countries = news ? notice.article?.countries ?? [] : event?.countryCodes ?? [];
        const previousOdds = notice.source === "rolling" && event
          ? event.yesOdds + (notice.kind === "odds-drop" ? notice.value : -notice.value) : null;
        const probabilityRange = previousOdds !== null && previousOdds >= 0 && previousOdds <= 100 && event
          ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(previousOdds)}% → ${event.yesOdds}%` : undefined;
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
                  {news ? (
                    <Newspaper size={14} />
                  ) : rising ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <ArrowDownRight size={15} />
                  )}
                </span>
                <strong title={probabilityRange}>{news ? t("news") : noticeLabel(notice).replace("Large BUY",marketLabel(locale,"Large BUY"))}</strong>
                {notice.windowLabel ? <span>{notice.windowLabel}</span> : null}
                {notice.source !== "rolling" ? <time dateTime={new Date(notice.occurredAt).toISOString()} data-time-kind="occurred">
                  {locale === "en" ? relativeTime(notice.occurredAt, clock) : new Intl.RelativeTimeFormat(locale,{numeric:"auto",style:"narrow"}).format(-Math.max(0,Math.floor((clock-notice.occurredAt)/60_000)),"minute")}
                </time> : null}
                <button
                  type="button"
                  className={styles.activityDismiss}
                  style={notice.source === "rolling" ? { marginInlineStart: "auto" } : undefined}
                  aria-label={t("dismiss")}
                  onClick={() => {
                    try {
                      const saved = activeActivityDismissals(JSON.parse(sessionStorage.getItem(ACTIVITY_DISMISSAL_STORAGE_KEY) || "{}"), Date.now());
                      saved[notice.id] = notice.expiresAt;
                      sessionStorage.setItem(ACTIVITY_DISMISSAL_STORAGE_KEY, JSON.stringify(activeActivityDismissals(saved, Date.now())));
                    } catch { /* In-memory dismissals still work when storage is unavailable. */ }
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
              {news && notice.article && notice.articleUrl ? (
                <Link className={styles.activityNewsLink} href={availableNewsArticlePath(notice.article, locale)} prefetch={false}>
                  {articleText(notice.article, locale).title}
                </Link>
              ) : (
                <p>{locale === "en" ? formatMarketTitle(notice.title) : translate(notice.title)}</p>
              )}
              <div className={styles.activityFooter} data-activity-footer>
                {countries.length > 0 ? (
                  <div
                    className={styles.activityFlags}
                    data-activity-flags
                    aria-label={`Event participants: ${countries.join(", ")}`}
                  >
                    {[...new Set(countries)]
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
                    {metricLabel.replace(/^YES/,t("yes")).replace(/^NO/,t("no"))}
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
                      {locale === "en" ? "Track" : "DropsBot"}
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
