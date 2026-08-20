"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ActivityRail } from "@/features/global-conflict-map/preview/activity-rail";
import { ConflictPopup } from "@/features/global-conflict-map/preview/conflict-popup";
import { TONE_PALETTE } from "@/features/global-conflict-map/preview/fixture";
import { MarketStrip } from "@/features/global-conflict-map/preview/market-strip";
import type { MarketStripFeed } from "@/features/global-conflict-map/preview/market-strip-types";
import {
  createMarkerVolumeDomain,
  getMarkerVisual,
} from "@/features/global-conflict-map/preview/marker-visuals";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import type {
  ConflictPreviewEvent,
  ConflictPreviewFeed,
} from "@/features/global-conflict-map/preview/types";
import { useConflictPreviewFeed } from "@/features/global-conflict-map/preview/use-conflict-preview-feed";

const MIN_LATITUDE = -75;
const MAX_LATITUDE = 82;

function mercator(latitude: number) {
  const bounded = Math.min(85, Math.max(-85, latitude));
  const radians = (bounded * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

const minimumMercator = mercator(MIN_LATITUDE);
const maximumMercator = mercator(MAX_LATITUDE);

function markerPosition(event: ConflictPreviewEvent) {
  const [longitude, latitude] = event.coordinates;
  return {
    x: ((longitude + 180) / 360) * 100,
    y:
      ((maximumMercator - mercator(latitude)) /
        (maximumMercator - minimumMercator)) *
      100,
  };
}

export interface LiteConflictMapProps {
  initialFeed: ConflictPreviewFeed;
  initialMarketStrip: MarketStripFeed;
  fixtureMode: boolean;
  interactiveLoading: boolean;
  onEnableInteractive: () => void;
}

export function LiteConflictMap({
  initialFeed,
  initialMarketStrip,
  fixtureMode,
  interactiveLoading,
  onEnableInteractive,
}: LiteConflictMapProps) {
  const feed = useConflictPreviewFeed(initialFeed, fixtureMode);
  const [compactViewport, setCompactViewport] = useState<boolean | null>(null);
  const selectedEventId = useConflictMapPreviewStore(
    (state) => state.selectedEventId,
  );
  const popupOpen = useConflictMapPreviewStore((state) => state.popupOpen);
  const selectEvent = useConflictMapPreviewStore((state) => state.selectEvent);
  const closePopup = useConflictMapPreviewStore((state) => state.closePopup);
  const markerVolumeDomain = useMemo(
    () => createMarkerVolumeDomain(feed.events, feed.minimumVolume),
    [feed.events, feed.minimumVolume],
  );
  const groups = useMemo(() => {
    const eventsByLocation = new Map<string, ConflictPreviewEvent[]>();
    for (const event of feed.events) {
      const events = eventsByLocation.get(event.locationId) ?? [];
      events.push(event);
      eventsByLocation.set(event.locationId, events);
    }

    return Array.from(eventsByLocation, ([id, events]) => {
      const sortedEvents = events.toSorted(
        (left, right) => right.volume - left.volume,
      );
      const primary =
        sortedEvents.find((event) => event.id === selectedEventId) ??
        sortedEvents[0]!;
      const markerVolume = sortedEvents.reduce(
        (maximum, event) => Math.max(maximum, event.volume),
        markerVolumeDomain.minimum,
      );
      return {
        id,
        events: sortedEvents,
        primary,
        marker: getMarkerVisual(markerVolume, markerVolumeDomain),
        position: markerPosition(primary),
      };
    }).toSorted(
      (left, right) =>
        left.marker.markerVolume - right.marker.markerVolume ||
        left.id.localeCompare(right.id),
    );
  }, [feed.events, markerVolumeDomain, selectedEventId]);
  const selectedEvent =
    feed.events.find((event) => event.id === selectedEventId) ?? null;
  const selectedGroup =
    groups.find((group) =>
      group.events.some((event) => event.id === selectedEventId),
    ) ?? null;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 560px)");
    const syncCompactViewport = () => setCompactViewport(mediaQuery.matches);
    syncCompactViewport();
    mediaQuery.addEventListener("change", syncCompactViewport);
    return () => mediaQuery.removeEventListener("change", syncCompactViewport);
  }, []);

  useEffect(() => {
    if (
      selectedEventId &&
      !feed.events.some((event) => event.id === selectedEventId)
    ) {
      selectEvent(null);
    }
  }, [feed.events, selectEvent, selectedEventId]);

  const cycleEvent = (direction: -1 | 1) => {
    if (feed.events.length === 0) return;
    const currentIndex = feed.events.findIndex(
      (event) => event.id === selectedEventId,
    );
    const startingIndex =
      currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;
    const nextIndex =
      (startingIndex + direction + feed.events.length) %
      feed.events.length;
    const nextEvent = feed.events[nextIndex];
    if (nextEvent) selectEvent(nextEvent.id);
  };
  const handleMapKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, [role='dialog']")) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      cycleEvent(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      cycleEvent(-1);
    } else if (event.key === "Escape" && popupOpen) {
      event.preventDefault();
      closePopup();
    }
  };
  const selectedPopup =
    selectedEvent && selectedGroup && popupOpen ? (
      <ConflictPopup
        key={`lite-popup-${selectedEvent.id}`}
        event={selectedEvent}
        popupOffset={selectedEvent.popupOffset}
        onClose={closePopup}
        groupedEventCount={selectedGroup.events.length}
        groupedEventIndex={Math.max(
          0,
          selectedGroup.events.findIndex(
            (event) => event.id === selectedEvent.id,
          ),
        )}
        groupedEventIds={selectedGroup.events.map((event) => event.id)}
        onSelectGroupedEvent={selectEvent}
      />
    ) : null;

  return (
    <main
      className={`${styles.shell} ${styles.liteShell}`}
      data-map-ready="true"
      data-map-mode="lite"
      data-feed-mode={feed.dataMode}
      data-event-count={feed.events.length}
      data-visible-event-count={feed.events.length}
      data-visible-marker-count={groups.length}
      data-selected-event={selectedEventId ?? ""}
      data-minimum-volume={feed.minimumVolume}
    >
      <MarketStrip initialFeed={initialMarketStrip} fixtureMode={fixtureMode} />
      <section
        className={`${styles.stage} ${styles.liteStage}`}
        data-popup-open={popupOpen ? "true" : "false"}
        tabIndex={0}
        aria-label="Lightweight map of global conflict prediction markets"
        aria-describedby="conflict-lite-map-description"
        onKeyDown={handleMapKeyDown}
      >
        <p id="conflict-lite-map-description" className={styles.screenReaderOnly}>
          A low-bandwidth map showing every qualified conflict and geopolitics
          prediction-market location. Select a marker for current odds or enable
          the detailed interactive map.
        </p>

        <div className={styles.liteWorld} data-lite-world-map="true">
          <div className={styles.liteMarkerLayer}>
            {groups.map((group) => {
              const event = group.primary;
              const selected = group.events.some(
                (candidate) => candidate.id === selectedEventId,
              );
              const markerStyle = {
                "--lite-marker-x": `${group.position.x}%`,
                "--lite-marker-y": `${group.position.y}%`,
                "--event-tone": TONE_PALETTE[event.tone].hex,
                "--marker-scale": group.marker.markerScale,
                "--marker-opacity": 0.46 + group.marker.markerStrength * 0.42,
              } as CSSProperties;

              return (
                <div
                  key={group.id}
                  className={styles.liteMarkerAnchor}
                  style={markerStyle}
                  data-event-id={event.id}
                  data-selected={selected ? "true" : "false"}
                  data-location-event-count={group.events.length}
                  data-marker-volume={group.marker.markerVolume}
                >
                  <button
                    type="button"
                    className={styles.liteHotspotTarget}
                    aria-label={`${event.region}: ${event.locationLabel}. ${event.title}. Current Polymarket odds ${event.yesOdds} percent yes.`}
                    aria-pressed={selected}
                    onClick={() => selectEvent(event.id)}
                  >
                    <span className={styles.liteHotspotVisual} aria-hidden="true" />
                    <span className={styles.liteHotspotLabel} aria-hidden="true">
                      {event.locationLabel}
                    </span>
                  </button>
                  {compactViewport === false && selected
                    ? selectedPopup
                    : null}
                </div>
              );
            })}
          </div>
        </div>

        {compactViewport === true ? selectedPopup : null}

        <ActivityRail feed={feed} fixtureMode={fixtureMode} />

        <button
          type="button"
          className={styles.enableDetailedMap}
          onClick={onEnableInteractive}
          disabled={interactiveLoading}
          aria-label="Enable detailed interactive map"
        >
          <span aria-hidden="true" />
          {interactiveLoading ? "Loading map…" : "Detailed map"}
        </button>
      </section>
    </main>
  );
}
