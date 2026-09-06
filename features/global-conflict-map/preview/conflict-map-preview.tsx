"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/components/locale-provider";
import { Minus, Plus } from "lucide-react";
import type { GeoJSONSource } from "maplibre-gl";
import MapLibreMap, {
  type MapRef,
  type ViewState,
} from "react-map-gl/maplibre";

import { ConflictPopup } from "@/features/global-conflict-map/preview/conflict-popup";
import {
  TONE_PALETTE,
} from "@/features/global-conflict-map/preview/fixture";
import {
  createHotspotFeatureCollection,
  HOTSPOT_SOURCE_ID,
} from "@/features/global-conflict-map/preview/layers";
import { MarketStrip } from "@/features/global-conflict-map/preview/market-strip";
import type { MarketStripFeed } from "@/features/global-conflict-map/preview/market-strip-types";
import {
  createMarkerVolumeDomain,
  getHotspotTension,
  getMarkerVisual,
  type PreviewHotspot,
} from "@/features/global-conflict-map/preview/marker-visuals";
import {
  createPreviewMapStyle,
} from "@/features/global-conflict-map/preview/map-style";
import {
  selectMapRenderProfile,
} from "@/features/global-conflict-map/preview/map-render-profile";
import { loadMapLibrary } from "@/features/global-conflict-map/preview/map-library";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import type {
  ConflictPreviewFeed,
  ConflictPreviewEvent,
  PreviewViewState,
} from "@/features/global-conflict-map/preview/types";

const INITIAL_VIEW_STATE: PreviewViewState = {
  longitude: 29,
  latitude: 18,
  zoom: 1.72,
  bearing: 0,
  pitch: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
};

const MIN_ZOOM = 1.6;
const MAX_ZOOM = 7;
const WORLD_BOUNDS: [number, number, number, number] = [
  -179.9, -75, 179.9, 82,
];

interface VisibleLocationGroup {
  id: string;
  events: ConflictPreviewEvent[];
  primary: ConflictPreviewEvent;
  hotspot: PreviewHotspot;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  return reducedMotion;
}

interface PreviewControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function PreviewControls({
  onZoomIn,
  onZoomOut,
}: PreviewControlsProps) {
  const { t } = useLocale();
  return (
    <div className={styles.controls} aria-label={t("marketControls")}>
      <div className={styles.zoomGroup}>
        <button type="button" onClick={onZoomIn} aria-label={t("zoomIn")}>
          <Plus size={21} aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomOut} aria-label={t("zoomOut")}>
          <Minus size={21} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface ConflictMapPreviewProps {
  initialFeed: ConflictPreviewFeed;
  initialMarketStrip: MarketStripFeed;
  fixtureMode: boolean;
}

function WebGlFallback({
  events,
  initialMarketStrip,
  fixtureMode,
}: {
  events: readonly ConflictPreviewEvent[];
  initialMarketStrip: MarketStripFeed;
  fixtureMode: boolean;
}) {
  const { t, translate } = useLocale();
  return (
    <main className={styles.shell} data-map-ready="true">
      <MarketStrip initialFeed={initialMarketStrip} fixtureMode={fixtureMode} />
      <section className={styles.fallback} aria-labelledby="map-fallback-title">
        <span>{t("mapUnavailable")}</span>
        <h1 id="map-fallback-title">{t("mapStartFailed")}</h1>
        <p>{t("fallbackSummary")}</p>
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{translate(event.region)}</strong>
              <span>{translate(event.title)}</span>
              <b>{event.yesOdds}% {t("yes")}</b>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function ConflictMapPreview({
  initialFeed,
  initialMarketStrip,
  fixtureMode,
}: ConflictMapPreviewProps) {
  const { locale } = useLocale();
  const mapRef = useRef<MapRef>(null);
  const popupAnchorRef = useRef<HTMLDivElement>(null);
  const popupSize = useRef({ width: 244, height: 256 });
  const buttonZoomTarget = useRef<number | null>(null);
  const selectedCountryIds = useRef<Set<string>>(new Set());
  const eventCountryIds = useRef<Set<string>>(new Set());
  const markerElements = useRef<globalThis.Map<string, HTMLDivElement>>(
    new globalThis.Map(),
  );
  const shellRef = useRef<HTMLElement>(null);
  const readyScheduled = useRef(false);
  const reduceMotion = usePrefersReducedMotion();
  const [mapLibrary] = useState(loadMapLibrary);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapRenderProfile] = useState(() => {
    const compactOrTouch = window.matchMedia(
      "(max-width: 860px), (pointer: coarse)",
    ).matches;
    const navigatorWithMemory = navigator as Navigator & {
      deviceMemory?: number;
    };
    return selectMapRenderProfile({
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      compactOrTouch,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigatorWithMemory.deviceMemory,
    });
  });
  const feed = initialFeed;
  const previewMapStyle = useMemo(
    () => createPreviewMapStyle(mapRenderProfile.quality, locale),
    [mapRenderProfile.quality, locale],
  );
  const [viewState, setViewState] = useState<ViewState>(
    INITIAL_VIEW_STATE as ViewState,
  );
  const [mapReady, setMapReady] = useState(false);
  const [markerContainer, setMarkerContainer] = useState<HTMLElement | null>(null);
  const [mapError, setMapError] = useState("");
  const [engineCamera, setEngineCamera] = useState("");
  const [compactViewport, setCompactViewport] = useState<boolean | null>(null);
  const [tileHealth, setTileHealth] = useState<"loading" | "ready" | "degraded">(
    "loading",
  );

  const hoveredEventId = useConflictMapPreviewStore(
    (state) => state.hoveredEventId,
  );
  const selectedEventId = useConflictMapPreviewStore(
    (state) => state.selectedEventId,
  );
  const popupOpen = useConflictMapPreviewStore((state) => state.popupOpen);
  const effectsVisible = useConflictMapPreviewStore(
    (state) => state.effectsVisible,
  );
  const setHoveredEvent = useConflictMapPreviewStore(
    (state) => state.setHoveredEvent,
  );
  const selectEventInStore = useConflictMapPreviewStore(
    (state) => state.selectEvent,
  );
  const closePopup = useConflictMapPreviewStore((state) => state.closePopup);
  const setZoom = useConflictMapPreviewStore((state) => state.setZoom);

  const events = feed.events;
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? null;
  const markerVolumeDomain = useMemo(
    () => createMarkerVolumeDomain(events, feed.minimumVolume),
    [events, feed.minimumVolume],
  );
  // Every qualified, geolocated event remains discoverable at the world view.
  // Zoom changes geographic detail only; volume changes marker prominence.
  const eligibleEvents = events;
  const visibleGroups = useMemo(() => {
    const groups = new globalThis.Map<string, ConflictPreviewEvent[]>();
    for (const event of eligibleEvents) {
      const group = groups.get(event.locationId) ?? [];
      group.push(event);
      groups.set(event.locationId, group);
    }

    return Array.from(groups, ([id, groupEvents]) => {
      const sortedEvents = groupEvents.toSorted(
        (left, right) => right.volume - left.volume,
      );
      // Selection must not rebuild the marker source or remount its hit target.
      const primary = sortedEvents[0]!;
      const markerVolume = sortedEvents.reduce(
        (maximum, event) => Math.max(maximum, event.volume),
        markerVolumeDomain.minimum,
      );
      const markerVisual = getMarkerVisual(markerVolume, markerVolumeDomain);

      return {
        id,
        events: sortedEvents,
        primary,
        hotspot: {
          event: primary,
          eventCount: sortedEvents.length,
          pixelOffset: [0, 0] as [number, number],
          isSpecialSignal: false,
          ...markerVisual,
          ...getHotspotTension(sortedEvents, markerVisual.markerStrength),
        },
      };
    })
      .toSorted(
        (left, right) =>
          left.hotspot.markerVolume - right.hotspot.markerVolume ||
          left.id.localeCompare(right.id),
      ) satisfies VisibleLocationGroup[];
  }, [eligibleEvents, markerVolumeDomain]);
  const visibleHotspots = useMemo(
    () => visibleGroups.map((group) => group.hotspot),
    [visibleGroups],
  );
  const selectedVisibleGroup = useMemo(
    () => visibleGroups.find((group) =>
      group.events.some((event) => event.id === selectedEventId)) ?? null,
    [selectedEventId, visibleGroups],
  );
  const selectedMarkerId = selectedVisibleGroup?.primary.id;
  const pulsingEventIds = useMemo(
    () => new Set(visibleHotspots
      .filter((hotspot) => hotspot.markerStrength >= 0.6 || hotspot.event.id === selectedMarkerId)
      .toSorted((left, right) =>
        Number(right.event.id === selectedMarkerId) - Number(left.event.id === selectedMarkerId) ||
        right.markerStrength - left.markerStrength)
      .slice(0, 8)
      .map((hotspot) => hotspot.event.id)),
    [selectedMarkerId, visibleHotspots],
  );
  const hotspotFeatureCollection = useMemo(
    () =>
      createHotspotFeatureCollection(
        visibleHotspots,
        null,
        effectsVisible,
      ),
    [effectsVisible, visibleHotspots],
  );
  const highlightedCountryIds = useMemo(
    () =>
      [...new Set(events.flatMap((event) => event.countryFeatureIds))].sort(),
    [events],
  );
  const allianceEventCount = useMemo(
    () => events.filter((event) => event.geographyKind === "alliance").length,
    [events],
  );
  useEffect(() => {
    if (
      selectedEventId &&
      !events.some((event) => event.id === selectedEventId)
    ) {
      selectEventInStore(null);
    }
  }, [events, selectEventInStore, selectedEventId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 560px)");
    const syncCompactViewport = () => setCompactViewport(mediaQuery.matches);
    syncCompactViewport();
    mediaQuery.addEventListener("change", syncCompactViewport);
    return () => mediaQuery.removeEventListener("change", syncCompactViewport);
  }, []);

  useEffect(() => {
    const syncVisibility = () => {
      if (shellRef.current) shellRef.current.dataset.pageVisible = String(document.visibilityState === "visible");
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  const updateMarkerPositions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    for (const hotspot of visibleHotspots) {
      const element = markerElements.current.get(hotspot.event.id);
      if (!element) continue;
      const point = map.project(hotspot.event.coordinates);
      const x = point.x + hotspot.pixelOffset[0];
      const y = point.y + hotspot.pixelOffset[1];
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [visibleHotspots]);

  const updatePopupAnchorPoint = useCallback(() => {
    const map = mapRef.current?.getMap();
    const anchor = popupAnchorRef.current;
    const popup = anchor?.firstElementChild as HTMLElement | null;
    if (!map || !selectedEvent || !anchor || !popup || compactViewport) return;
    const point = map.project(selectedEvent.coordinates);
    const canvas = map.getCanvas();
    const x = Math.max(12, Math.min(canvas.clientWidth - popupSize.current.width - 12,
      point.x + selectedEvent.popupOffset[0]));
    const y = Math.max(12, Math.min(canvas.clientHeight - popupSize.current.height - 12,
      point.y + selectedEvent.popupOffset[1]));
    const firstPosition = !anchor.dataset.positioned;
    if (firstPosition) anchor.style.transition = "none";
    anchor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (firstPosition) {
      anchor.dataset.positioned = "true";
      window.requestAnimationFrame(() => anchor.style.removeProperty("transition"));
    }
  }, [compactViewport, selectedEvent]);

  const measurePopup = useCallback(() => {
    const popup = popupAnchorRef.current?.firstElementChild as HTMLElement | null;
    if (popup) popupSize.current = { width: popup.offsetWidth, height: popup.offsetHeight };
  }, []);

  const updateHotspotSource = useCallback(() => {
    const map = mapRef.current?.getMap();
    const source = map?.getSource(HOTSPOT_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData(hotspotFeatureCollection);
  }, [hotspotFeatureCollection]);

  useLayoutEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    measurePopup();
    updateMarkerPositions();
    updatePopupAnchorPoint();
  }, [mapReady, measurePopup, updateMarkerPositions, updatePopupAnchorPoint]);

  useEffect(() => {
    if (mapReady) updateHotspotSource();
  }, [mapReady, updateHotspotSource]);

  const applySelectedCountryState = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map?.getSource("countries")) return;

    for (const id of selectedCountryIds.current) {
      map.setFeatureState(
        { source: "countries", id },
        { selected: false, selectedTone: null },
      );
    }
    selectedCountryIds.current.clear();

    if (!selectedEvent) return;
    for (const id of selectedEvent.countryFeatureIds) {
      map.setFeatureState(
        { source: "countries", id },
        { selected: true, selectedTone: selectedEvent.tone },
      );
      selectedCountryIds.current.add(id);
    }
  }, [selectedEvent]);

  const applyEventCountryState = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map?.getSource("countries")) return;

    for (const id of eventCountryIds.current) {
      map.setFeatureState(
        { source: "countries", id },
        { event: false, eventTone: null },
      );
    }
    eventCountryIds.current.clear();

    const eventCountries = new globalThis.Map<string, ConflictPreviewEvent["tone"]>();
    for (const event of events) {
      for (const id of event.countryFeatureIds) {
        if (!eventCountries.has(id)) eventCountries.set(id, event.tone);
      }
    }
    for (const [id, tone] of eventCountries) {
      map.setFeatureState(
        { source: "countries", id },
        { event: true, eventTone: tone },
      );
      eventCountryIds.current.add(id);
    }
  }, [events]);

  useEffect(() => {
    if (mapReady) applySelectedCountryState();
  }, [applySelectedCountryState, mapReady]);

  useEffect(() => {
    if (mapReady) applyEventCountryState();
  }, [applyEventCountryState, mapReady]);

  const selectEvent = useCallback(
    (event: ConflictPreviewEvent, moveCamera = false) => {
      selectEventInStore(event.id);
      if (!moveCamera) return;

      const map = mapRef.current;
      if (!map) return;
      buttonZoomTarget.current = null;
      const camera = { center: event.coordinates };
      if (reduceMotion) map.jumpTo(camera);
      else map.easeTo({ ...camera, duration: 260, essential: false });
    },
    [
      reduceMotion,
      selectEventInStore,
    ],
  );

  const cycleEvent = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = events.findIndex(
        (event) => event.id === selectedEventId,
      );
      const nextIndex =
        (Math.max(0, currentIndex) + direction + events.length) % events.length;
      const nextEvent = events[nextIndex];
      if (nextEvent) selectEvent(nextEvent, true);
    },
    [events, selectEvent, selectedEventId],
  );

  const handleHotspotClick = useCallback(
    (clickEvent: ReactMouseEvent<HTMLButtonElement>) => {
      const eventId = clickEvent.currentTarget.dataset.marketEventId;
      const event = events.find((candidate) => candidate.id === eventId);
      if (event) selectEvent(event);
    },
    [events, selectEvent],
  );

  const updateZoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, (buttonZoomTarget.current ?? map.getZoom()) + delta),
    );
    // Stop the previous animation before recording the next target: stop emits
    // moveend. Consecutive taps then accumulate even before a frame is drawn.
    map.stop();
    buttonZoomTarget.current = nextZoom;
    if (reduceMotion) map.jumpTo({ zoom: nextZoom });
    else map.easeTo({ zoom: nextZoom, duration: 180 });
  };

  const syncCameraFromMap = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const center = map.getCenter();
    const nextViewState = {
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      padding: INITIAL_VIEW_STATE.padding,
    } as ViewState;
    setViewState(nextViewState);
    setEngineCamera(
      `${center.lng.toFixed(4)},${center.lat.toFixed(4)},${nextViewState.zoom.toFixed(3)}`,
    );
  }, []);

  const markMapReady = () => {
    if (mapReady || readyScheduled.current) return;
    readyScheduled.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setTileHealth((health) => (health === "loading" ? "ready" : health));
        syncCameraFromMap();
        setMapReady(true);
        updateMarkerPositions();
        applySelectedCountryState();
      });
    });
  };

  const selectedPopup =
    selectedEvent && selectedVisibleGroup && popupOpen ? (
      <ConflictPopup
        event={selectedEvent}
        popupOffset={[0, 0]}
        onClose={closePopup}
        groupedEventCount={selectedVisibleGroup.events.length}
        groupedEventIndex={Math.max(
          0,
          selectedVisibleGroup.events.findIndex(
            (groupedEvent) => groupedEvent.id === selectedEvent.id,
          ),
        )}
        groupedEventIds={selectedVisibleGroup.events.map(
          (groupedEvent) => groupedEvent.id,
        )}
        onSelectGroupedEvent={selectEventInStore}
      />
    ) : null;

  if (mapUnavailable) {
    return (
      <WebGlFallback
        events={events}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
      />
    );
  }

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-map-ready={mapReady ? "true" : "false"}
      data-tile-health={tileHealth}
      data-map-error={mapError}
      data-engine-camera={engineCamera}
      data-selected-event={selectedEventId ?? ""}
      data-feed-mode={feed.dataMode}
      data-event-count={events.length}
      data-visible-event-count={eligibleEvents.length}
      data-visible-marker-count={visibleHotspots.length}
      data-minimum-volume={feed.minimumVolume}
      data-map-longitude={viewState.longitude.toFixed(4)}
      data-map-latitude={viewState.latitude.toFixed(4)}
      data-map-zoom={viewState.zoom.toFixed(3)}
      data-map-pixel-ratio={mapRenderProfile.pixelRatio}
      data-map-render-quality={mapRenderProfile.quality}
      data-map-pixel-budget={mapRenderProfile.pixelBudget}
      data-map-raster-texture="disabled"
      data-reduced-motion={reduceMotion ? "true" : "false"}
      data-hotspot-rendering="maplibre-native-circles"
      data-marker-glyph="precision-beacons"
      data-effects-visible={effectsVisible ? "true" : "false"}
      data-special-signal-count="0"
      data-pulse-interval="4000"
      data-pulse-renderer="css-compositor"
      data-tense-zone-count={visibleHotspots.filter((hotspot) => hotspot.isTense).length}
      data-weekly-surge-count="0"
      data-highlighted-country-count={highlightedCountryIds.length}
      data-alliance-event-count={allianceEventCount}
      data-highlighted-country-ids={highlightedCountryIds.join(",")}
      data-map-moving="false"
      data-overlay-sync="maplibre-native"
    >
      <MarketStrip
        initialFeed={initialMarketStrip}
        fixtureMode={fixtureMode}
        refreshEnabled={mapReady}
      />
      <section
        className={styles.stage}
        data-popup-open={popupOpen ? "true" : "false"}
        tabIndex={0}
        aria-label="Interactive map of global conflict prediction markets"
        aria-describedby="conflict-map-long-description"
        onPointerDownCapture={(event) => {
          if ((event.target as HTMLElement).closest(".maplibregl-map")) {
            buttonZoomTarget.current = null;
          }
        }}
        onWheelCapture={() => { buttonZoomTarget.current = null; }}
        onKeyDown={(event) => {
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
        }}
      >
        <p id="conflict-map-long-description" className={styles.screenReaderOnly}>
          Active conflict and geopolitics prediction markets from Polymarket with
          at least {feed.minimumVolume.toLocaleString("en-US")} dollars in event
          volume. Every qualified location remains visible at the world view,
          while market volume controls beacon size and brightness. Location
          anchors are accepted only when a country, region, or named place can be
          matched.
        </p>

        <MapLibreMap
          ref={mapRef}
          mapLib={mapLibrary}
          mapStyle={previewMapStyle}
          pixelRatio={mapRenderProfile.pixelRatio}
          refreshExpiredTiles={false}
          canvasContextAttributes={{ antialias: false, alpha: false }}
          validateStyle={false}
          initialViewState={INITIAL_VIEW_STATE}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxPitch={0}
          dragRotate={false}
          touchPitch={false}
          renderWorldCopies={false}
          crossSourceCollisions={false}
          fadeDuration={0}
          maxBounds={WORLD_BOUNDS}
          attributionControl={false}
          onStyleData={updateMarkerPositions}
          onLoad={() => {
            const loadedMap = mapRef.current?.getMap();
            loadedMap?.jumpTo(INITIAL_VIEW_STATE);
            if (loadedMap) {
              setMarkerContainer(loadedMap.getCanvasContainer());
              syncCameraFromMap();
              window.requestAnimationFrame(syncCameraFromMap);
            }
            setTileHealth("ready");
            updateHotspotSource();
            window.requestAnimationFrame(updateMarkerPositions);
            applyEventCountryState();
            applySelectedCountryState();
            markMapReady();
          }}
          onIdle={markMapReady}
          onMoveStart={() => {
            if (shellRef.current) shellRef.current.dataset.mapMoving = "true";
            setHoveredEvent(null);
          }}
          onMove={() => {
            updateMarkerPositions();
            updatePopupAnchorPoint();
          }}
          onMoveEnd={(event) => {
            buttonZoomTarget.current = null;
            setViewState(event.viewState);
            setEngineCamera(`${event.viewState.longitude.toFixed(4)},${event.viewState.latitude.toFixed(4)},${event.viewState.zoom.toFixed(3)}`);
            setZoom(event.viewState.zoom);
            window.requestAnimationFrame(() => {
              updateMarkerPositions();
              updatePopupAnchorPoint();
              if (shellRef.current) shellRef.current.dataset.mapMoving = "false";
            });
          }}
          onResize={() => {
            measurePopup();
            updateMarkerPositions();
            updatePopupAnchorPoint();
          }}
          onClick={() => setHoveredEvent(null)}
          onError={(event) => {
            if (!event.target) setMapUnavailable(true);
            setTileHealth("degraded");
            setMapError(event.error?.message ?? "Unknown map error");
          }}
        />

        {mapReady && markerContainer ? createPortal(<div className={styles.markerOverlay}>
          {mapReady
            ? visibleGroups.map((group, index) => {
                const event = group.primary;
                const hotspot = group.hotspot;
                const selected = group.id === selectedVisibleGroup?.id;
                const hovered = event.id === hoveredEventId;

                return (
                  <div
                    key={group.id}
                    ref={(element) => {
                      if (element) markerElements.current.set(event.id, element);
                      else markerElements.current.delete(event.id);
                    }}
                    className={styles.markerAnchor}
                    style={{
                      transform: "translate3d(-10000px, -10000px, 0)",
                      "--event-tone": TONE_PALETTE[event.tone].hex,
                      "--marker-scale": hotspot.markerScale,
                      "--marker-strength": hotspot.markerStrength,
                      "--pulse-delay": `${-(index % 8) * 0.5}s`,
                    } as React.CSSProperties}
                    data-event-id={event.id}
                    data-selected={selected ? "true" : "false"}
                    data-marker-volume={hotspot.markerVolume}
                    data-marker-strength={hotspot.markerStrength.toFixed(4)}
                    data-marker-scale={hotspot.markerScale.toFixed(4)}
                    data-tension-strength={hotspot.tensionStrength.toFixed(4)}
                    data-tense={hotspot.isTense ? "true" : "false"}
                    data-weekly-change={hotspot.weeklyChange7d ?? ""}
                    data-geography-kind={event.geographyKind}
                    data-location-event-count={hotspot.eventCount}
                    data-clustered={hotspot.eventCount > 1 ? "true" : "false"}
                    data-marker-offset={`${hotspot.pixelOffset[0].toFixed(1)},${hotspot.pixelOffset[1].toFixed(1)}`}
                    data-render-shape={hotspot.isSpecialSignal ? "special" : "circle"}
                    data-pulse-active={pulsingEventIds.has(event.id) ? "true" : "false"}
                  >
                    <span className={styles.beaconPulse} aria-hidden="true" />
                    <button
                      type="button"
                      className={styles.hotspotTarget}
                      aria-label={`${event.region}: ${event.locationLabel}. ${event.title}. ${event.dataOrigin === "polymarket" ? "Current Polymarket" : "Illustrative"} odds ${event.yesOdds} percent yes.`}
                      aria-pressed={selected}
                      data-market-event-id={event.id}
                      onMouseEnter={() => setHoveredEvent(event.id)}
                      onMouseLeave={() => setHoveredEvent(null)}
                      onFocus={() => setHoveredEvent(event.id)}
                      onBlur={() => setHoveredEvent(null)}
                      onClick={handleHotspotClick}
                    >
                      <span className={styles.screenReaderOnly}>Select event</span>
                    </button>

                    <span
                      className={styles.hotspotLabel}
                      data-visible={hovered ? "true" : "false"}
                      aria-hidden="true"
                    >
                      {event.locationLabel}
                    </span>

                  </div>
                );
              })
            : null}
        </div>, markerContainer) : null}

        {compactViewport === false && selectedPopup ? (
          <div ref={popupAnchorRef} className={styles.popupAnchor}>{selectedPopup}</div>
        ) : null}

        {compactViewport === true ? selectedPopup : null}

        <PreviewControls
          onZoomIn={() => updateZoomBy(0.75)}
          onZoomOut={() => updateZoomBy(-0.75)}
        />

        <span className={styles.screenReaderOnly}>
          {feed.sourceLabel}. Updated {feed.updatedAt}. Map data from OpenStreetMap
          contributors, OpenFreeMap, Natural Earth, and NASA EOSDIS GIBS.
        </span>

        <output className={styles.zoomReadout} aria-live="polite">
          Zoom {viewState.zoom.toFixed(1)}
        </output>
      </section>
    </main>
  );
}
