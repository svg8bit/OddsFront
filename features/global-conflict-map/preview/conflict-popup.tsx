"use client";

import type { CSSProperties } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { TONE_PALETTE } from "@/features/global-conflict-map/preview/fixture";
import { CountryFlag } from "@/features/global-conflict-map/preview/country-flag";
import { DropsBotTrackIcon } from "@/features/global-conflict-map/preview/dropsbot-track-icon";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";
import { formatMarketTitle } from "@/lib/market-title";
import {
  buildDropsBotTrackUrl,
  toPolymarketReferralUrl,
} from "@/lib/polymarket-links";

interface ConflictPopupProps {
  event: ConflictPreviewEvent;
  popupOffset: [number, number];
  groupedEventCount: number;
  groupedEventIndex: number;
  groupedEventIds: string[];
  onClose: () => void;
  onSelectGroupedEvent: (eventId: string) => void;
}

const MAX_VISIBLE_PARTICIPANTS = 3;

function formatVolume(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWeeklyChange(value: number): string {
  const percentage = value * 100;
  const digits = Math.abs(percentage - Math.round(percentage)) < 0.05 ? 0 : 1;
  return `${percentage >= 0 ? "+" : ""}${percentage.toFixed(digits)}%`;
}

export function ConflictPopup({
  event,
  popupOffset,
  groupedEventCount,
  groupedEventIndex,
  groupedEventIds,
  onClose,
  onSelectGroupedEvent,
}: ConflictPopupProps) {
  const marketUrl = toPolymarketReferralUrl(event.marketUrl);
  const trackUrl = buildDropsBotTrackUrl(event.marketUrl);
  const participantCodes = [...new Set(event.countryCodes)];
  const visibleParticipantCodes = participantCodes.slice(
    0,
    MAX_VISIBLE_PARTICIPANTS,
  );
  const hiddenParticipantCount =
    participantCodes.length - visibleParticipantCodes.length;
  const positionStyle = {
    "--popup-x": `${popupOffset[0]}px`,
    "--popup-y": `${popupOffset[1]}px`,
    "--event-tone": TONE_PALETTE[event.tone].hex,
  } as CSSProperties;

  return (
    <article
      className={styles.popup}
      style={positionStyle}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`preview-market-${event.id}`}
      data-testid="conflict-popup"
    >
      <div className={styles.popupKicker}>
        <span className={styles.toneDot} aria-hidden="true" />
        <span className={styles.popupLocation}>{event.locationLabel}</span>
        {visibleParticipantCodes.length > 0 ? (
          <span
            className={styles.participantFlags}
            role="img"
            aria-label={`Event participants: ${participantCodes.join(", ")}`}
            data-testid="participant-flags"
          >
            {visibleParticipantCodes.map((code) => (
              <span key={code} title={code} aria-hidden="true">
                <CountryFlag code={code} className={styles.countryFlag} />
              </span>
            ))}
            {hiddenParticipantCount > 0 ? (
              <small aria-hidden="true">+{hiddenParticipantCount}</small>
            ) : null}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.popupClose}
          onClick={onClose}
          aria-label={`Close ${event.region} market popup`}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <h2 id={`preview-market-${event.id}`} className={styles.popupTitle}>
        {formatMarketTitle(event.title)}
      </h2>

      {event.priceChange7d !== null && Math.abs(event.priceChange7d) >= 0.005 ? (
        <div
          className={styles.weeklySignal}
          data-direction={event.priceChange7d >= 0 ? "up" : "down"}
          data-testid="popup-weekly-change"
        >
          {event.priceChange7d >= 0 ? (
            <TrendingUp size={13} aria-hidden="true" />
          ) : (
            <TrendingDown size={13} aria-hidden="true" />
          )}
          <strong>{formatWeeklyChange(event.priceChange7d)}</strong>
          <span>Odds change · 7D</span>
        </div>
      ) : null}

      {groupedEventCount > 1 ? (
        <div className={styles.marketPager} aria-label="Markets at this location">
          <span>
            Market {groupedEventIndex + 1} of {groupedEventCount}
          </span>
          <div>
            <button
              type="button"
              onClick={() => {
                const previousIndex =
                  (groupedEventIndex - 1 + groupedEventCount) % groupedEventCount;
                const previousId = groupedEventIds[previousIndex];
                if (previousId) onSelectGroupedEvent(previousId);
              }}
              aria-label="Previous market at this location"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                const nextIndex = (groupedEventIndex + 1) % groupedEventCount;
                const nextId = groupedEventIds[nextIndex];
                if (nextId) onSelectGroupedEvent(nextId);
              }}
              aria-label="Next market at this location"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={styles.oddsGrid}
        aria-label={`${event.dataOrigin === "polymarket" ? "Current Polymarket" : "Illustrative"} odds: yes ${event.yesOdds} percent, no ${event.noOdds} percent`}
      >
        <div>
          <span>YES</span>
          <strong>{event.yesOdds}%</strong>
        </div>
        <div>
          <span>NO</span>
          <strong>{event.noOdds}%</strong>
        </div>
      </div>

      <div className={styles.volumeRow}>
        <span>{formatVolume(event.volume)} Vol</span>
        {marketUrl ? (
          <a
            href={marketUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View this event on Polymarket"
          >
            Polymarket
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        ) : (
          <em>Fixture</em>
        )}
      </div>

      {trackUrl ? (
        <div className={styles.popupActions} aria-label="Market preview actions">
          <a
            className={styles.trackButton}
            href={trackUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Track this market in DropsBot"
          >
            <DropsBotTrackIcon className={styles.trackIcon} />
            Track in DropsBot
          </a>
        </div>
      ) : null}
    </article>
  );
}
