"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Minus, Plus } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import MapLibreMap, {
  type MapRef,
  type ViewState,
} from "react-map-gl/maplibre";

import { ActivityRail } from "@/features/global-conflict-map/preview/activity-rail";
import { ConflictPopup } from "@/features/global-conflict-map/preview/conflict-popup";
import {
  TONE_PALETTE,
} from "@/features/global-conflict-map/preview/fixture";
import {
  createHotspotFeatureCollection,
  HOTSPOT_PULSE_LAYER_ID,
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
  COUNTRY_CONTEXT_FILL_ACTIVE,
  COUNTRY_CONTEXT_FILL_IDLE,
  PREVIEW_MAP_STYLE,
  SELECTED_COUNTRY_PULSE_ACTIVE,
  SELECTED_COUNTRY_PULSE_IDLE,
} from "@/features/global-conflict-map/preview/map-style";
import {
  selectMapRenderProfile,
} from "@/features/global-conflict-map/preview/map-render-profile";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import type {
  ConflictPreviewFeed,
  ConflictPreviewEvent,
  PreviewViewState,
} from "@/features/global-conflict-map/preview/types";

// Next.js/Turbopack does not preserve MapLibre's sibling worker URL when the
// library is bundled into a route chunk. Pin the worker to a same-origin copy
// from the installed MapLibre release so vector tiles and GeoJSON sources are
// parsed off the main thread in both development and production builds.
maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

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
const TRACKPAD_ZOOM_RATE = 1 / 55;
const WHEEL_ZOOM_RATE = 1 / 140;
const PULSE_INTERVAL_MS = 3_000;
const FEED_REFRESH_JITTER_MS = 30_000;
const FEED_INITIAL_REFRESH_DELAY_MS = 15_000;
const WORLD_BOUNDS: [number, number, number, number] = [
  -179.9, -75, 179.9, 82,
];

type ProjectedPoint = { x: number; y: number };

interface MarkerCameraSnapshot {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
  width: number;
  height: number;
}

interface VisibleLocationGroup {
  id: string;
  events: ConflictPreviewEvent[];
  primary: ConflictPreviewEvent;
  hotspot: PreviewHotspot;
}

function clampPopupOffset(
  point: ProjectedPoint,
  preferred: [number, number],
): [number, number] {
  if (typeof window === "undefined") return preferred;
  const margin = 12;
  const popupWidth = 244;
  const popupHeight = 256;
  const x = Math.min(
    window.innerWidth - popupWidth - margin - point.x,
    Math.max(margin - point.x, preferred[0]),
  );
  const y = Math.min(
    window.innerHeight - popupHeight - margin - point.y,
    Math.max(margin - point.y, preferred[1]),
  );
  return [x, y];
}

function supportsWebGl2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
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
  return (
    <div className={styles.controls} aria-label="Map controls">
      <div className={styles.zoomGroup}>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          <Plus size={21} aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
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

function isConflictPreviewFeed(value: unknown): value is ConflictPreviewFeed {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConflictPreviewFeed>;
  return (
    (candidate.dataMode === "live" || candidate.dataMode === "fallback") &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.refreshSeconds === "number" &&
    typeof candidate.minimumVolume === "number" &&
    Array.isArray(candidate.events) &&
    candidate.events.every(
      (event) =>
        event &&
        typeof event.id === "string" &&
        typeof event.title === "string" &&
        Array.isArray(event.coordinates) &&
        event.coordinates.length === 2 &&
        ["place", "country", "regional", "alliance"].includes(
          event.geographyKind,
        ) &&
        typeof event.volume === "number" &&
        event.volume >= candidate.minimumVolume!,
    )
  );
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
  return (
    <main className={styles.shell} data-map-ready="true">
      <MarketStrip initialFeed={initialMarketStrip} fixtureMode={fixtureMode} />
      <section className={styles.fallback} aria-labelledby="map-fallback-title">
        <span>Interactive map unavailable</span>
        <h1 id="map-fallback-title">WebGL 2 is required for this map preview.</h1>
        <p>The latest verified event list remains available as a text summary.</p>
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.region}</strong>
              <span>{event.title}</span>
              <b>{event.yesOdds}% YES</b>
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
  const mapRef = useRef<MapRef>(null);
  const selectedCountryIds = useRef<Set<string>>(new Set());
  const eventCountryIds = useRef<Set<string>>(new Set());
  const markerElements = useRef<globalThis.Map<string, HTMLDivElement>>(
    new globalThis.Map(),
  );
  const markerCameraSnapshot = useRef<MarkerCameraSnapshot | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const readyScheduled = useRef(false);
  const countryPulseFadeTimer = useRef<number | null>(null);
  const hotspotPulseFrame = useRef<number | null>(null);
  const pulseEpoch = useRef(0);
  const reduceMotion = usePrefersReducedMotion();
  const [webGlSupported] = useState(supportsWebGl2);
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
  const [feed, setFeed] = useState(initialFeed);
  const [viewState, setViewState] = useState<ViewState>(
    INITIAL_VIEW_STATE as ViewState,
  );
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [engineCamera, setEngineCamera] = useState("");
  const [compactViewport, setCompactViewport] = useState<boolean | null>(null);
  const [popupAnchorPoint, setPopupAnchorPoint] = useState<ProjectedPoint>({
    x: 0,
    y: 0,
  });
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
      const primary =
        sortedEvents.find((event) => event.id === selectedEventId) ??
        sortedEvents[0]!;
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
  }, [eligibleEvents, markerVolumeDomain, selectedEventId]);
  const visibleHotspots = useMemo(
    () => visibleGroups.map((group) => group.hotspot),
    [visibleGroups],
  );
  const hotspotFeatureCollection = useMemo(
    () =>
      createHotspotFeatureCollection(
        visibleHotspots,
        selectedEventId,
        effectsVisible,
      ),
    [effectsVisible, selectedEventId, visibleHotspots],
  );
  const selectedVisibleGroup = useMemo(
    () =>
      visibleGroups.find((group) =>
        group.events.some((event) => event.id === selectedEventId),
      ) ?? null,
    [selectedEventId, visibleGroups],
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
    if (fixtureMode || !mapReady) return;

    let cancelled = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (controller) return;
      controller = new AbortController();
      try {
        const response = await fetch("/api/global-conflict-events", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled && isConflictPreviewFeed(payload)) setFeed(payload);
      } catch {
        // Keep the last verified payload on transient network failures.
      } finally {
        controller = null;
      }
    };

    const refreshMs = Math.max(60, feed.refreshSeconds) * 1_000;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        if (!cancelled) {
          schedule(
            refreshMs + Math.floor(Math.random() * FEED_REFRESH_JITTER_MS),
          );
        }
      }, delay);
    };
    const refreshWhenOnline = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refreshWhenOnline);
    const feedUpdatedAt = Date.parse(feed.updatedAt);
    const feedAge = Number.isFinite(feedUpdatedAt)
      ? Math.max(0, Date.now() - feedUpdatedAt)
      : refreshMs;
    const remainingFreshness = Math.max(0, refreshMs - feedAge);
    // Fresh server payloads wait for the unused part of their refresh window.
    // An expired production payload stays usable while the map completes its
    // first interaction window, then refreshes with per-client jitter.
    const productionDelay =
      process.env.NODE_ENV === "production"
        ? FEED_INITIAL_REFRESH_DELAY_MS +
          Math.floor(Math.random() * FEED_REFRESH_JITTER_MS)
        : 0;
    schedule(Math.max(productionDelay, remainingFreshness));
    return () => {
      cancelled = true;
      window.removeEventListener("online", refreshWhenOnline);
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [feed.refreshSeconds, feed.updatedAt, fixtureMode, mapReady]);

  const updateMarkerPositions = useCallback((force = false) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const center = map.getCenter();
    const canvas = map.getCanvas();
    const nextCamera: MarkerCameraSnapshot = {
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
    const previousCamera = markerCameraSnapshot.current;
    if (
      !force &&
      previousCamera &&
      previousCamera.longitude === nextCamera.longitude &&
      previousCamera.latitude === nextCamera.latitude &&
      previousCamera.zoom === nextCamera.zoom &&
      previousCamera.bearing === nextCamera.bearing &&
      previousCamera.pitch === nextCamera.pitch &&
      previousCamera.width === nextCamera.width &&
      previousCamera.height === nextCamera.height
    ) {
      return;
    }
    markerCameraSnapshot.current = nextCamera;

    for (const hotspot of visibleHotspots) {
      const element = markerElements.current.get(hotspot.event.id);
      if (!element) continue;
      const point = map.project(hotspot.event.coordinates);
      const x = point.x + hotspot.pixelOffset[0];
      const y = point.y + hotspot.pixelOffset[1];
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [visibleHotspots]);

  const handleMapRender = useCallback(() => {
    updateMarkerPositions(false);
  }, [updateMarkerPositions]);

  const updatePopupAnchorPoint = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !selectedEvent) return;
    const point = map.project(selectedEvent.coordinates);
    setPopupAnchorPoint((current) =>
      current.x === point.x && current.y === point.y
        ? current
        : { x: point.x, y: point.y },
    );
  }, [selectedEvent]);

  const updateHotspotSource = useCallback(() => {
    const map = mapRef.current?.getMap();
    const source = map?.getSource(HOTSPOT_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(hotspotFeatureCollection);
  }, [hotspotFeatureCollection]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    updateMarkerPositions(true);
    updatePopupAnchorPoint();
    map.on("render", handleMapRender);
    return () => {
      map.off("render", handleMapRender);
    };
  }, [handleMapRender, mapReady, updateMarkerPositions, updatePopupAnchorPoint]);

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

  const pulseSelectedCountryOutline = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (
      !map?.getLayer("country-selected-pulse") ||
      !map.getLayer("country-selected-fill") ||
      selectedCountryIds.current.size === 0
    ) {
      return;
    }

    if (countryPulseFadeTimer.current !== null) {
      window.clearTimeout(countryPulseFadeTimer.current);
    }
    map.setPaintProperty(
      "country-selected-pulse",
      "line-opacity",
      SELECTED_COUNTRY_PULSE_ACTIVE,
    );
    map.setPaintProperty(
      "country-selected-fill",
      "fill-opacity",
      COUNTRY_CONTEXT_FILL_ACTIVE,
    );
    countryPulseFadeTimer.current = window.setTimeout(() => {
      if (map.getLayer("country-selected-pulse")) {
        map.setPaintProperty(
          "country-selected-pulse",
          "line-opacity",
          SELECTED_COUNTRY_PULSE_IDLE,
        );
      }
      if (map.getLayer("country-selected-fill")) {
        map.setPaintProperty(
          "country-selected-fill",
          "fill-opacity",
          COUNTRY_CONTEXT_FILL_IDLE,
        );
      }
      countryPulseFadeTimer.current = null;
    }, 650);
  }, []);

  const recordPulseEpoch = useCallback((epoch: number) => {
    if (shellRef.current) {
      shellRef.current.dataset.pulseEpoch = String(epoch);
    }
  }, []);

  const pulseHotspotOutline = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!selectedEventId || !map?.getLayer(HOTSPOT_PULSE_LAYER_ID)) return;

    if (hotspotPulseFrame.current !== null) {
      window.cancelAnimationFrame(hotspotPulseFrame.current);
    }
    const scale: maplibregl.ExpressionSpecification = [
      "number",
      ["get", "markerScale"],
      1,
    ];
    const emphasis: maplibregl.ExpressionSpecification = [
      "number",
      ["get", "emphasis"],
      1,
    ];
    map.setPaintProperty(HOTSPOT_PULSE_LAYER_ID, "circle-radius-transition", {
      duration: 0,
      delay: 0,
    });
    map.setPaintProperty(
      HOTSPOT_PULSE_LAYER_ID,
      "circle-stroke-opacity-transition",
      { duration: 0, delay: 0 },
    );
    map.setPaintProperty(
      HOTSPOT_PULSE_LAYER_ID,
      "circle-radius",
      ["*", 9.5, scale, emphasis],
    );
    map.setPaintProperty(
      HOTSPOT_PULSE_LAYER_ID,
      "circle-stroke-opacity",
      0.36,
    );

    hotspotPulseFrame.current = window.requestAnimationFrame(() => {
      if (!map.getLayer(HOTSPOT_PULSE_LAYER_ID)) return;
      map.setPaintProperty(
        HOTSPOT_PULSE_LAYER_ID,
        "circle-radius-transition",
        { duration: 620, delay: 0 },
      );
      map.setPaintProperty(
        HOTSPOT_PULSE_LAYER_ID,
        "circle-stroke-opacity-transition",
        { duration: 620, delay: 0 },
      );
      map.setPaintProperty(
        HOTSPOT_PULSE_LAYER_ID,
        "circle-radius",
        ["*", 31, scale, emphasis],
      );
      map.setPaintProperty(
        HOTSPOT_PULSE_LAYER_ID,
        "circle-stroke-opacity",
        0,
      );
      hotspotPulseFrame.current = null;
    });
  }, [selectedEventId]);

  useEffect(
    () => () => {
      if (countryPulseFadeTimer.current !== null) {
        window.clearTimeout(countryPulseFadeTimer.current);
      }
      if (hotspotPulseFrame.current !== null) {
        window.cancelAnimationFrame(hotspotPulseFrame.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!mapReady || reduceMotion || !effectsVisible) return;

    let stopped = false;
    let timer = 0;
    const pulse = () => {
      if (stopped) return;
      pulseEpoch.current += 1;
      recordPulseEpoch(pulseEpoch.current);
      pulseHotspotOutline();
      pulseSelectedCountryOutline();
      timer = window.setTimeout(pulse, PULSE_INTERVAL_MS);
    };

    timer = window.setTimeout(pulse, 900);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [
    effectsVisible,
    mapReady,
    pulseHotspotOutline,
    pulseSelectedCountryOutline,
    recordPulseEpoch,
    reduceMotion,
  ]);

  const selectEvent = useCallback(
    (event: ConflictPreviewEvent, moveCamera = true) => {
      selectEventInStore(event.id);
      if (!reduceMotion && effectsVisible) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(pulseHotspotOutline);
        });
      }
      if (!moveCamera) return;

      const map = mapRef.current;
      if (!map) return;
      const nextZoom = Math.max(viewState.zoom, event.minimumZoom, 3.1);
      const camera = { center: event.coordinates, zoom: nextZoom };
      if (reduceMotion) map.jumpTo(camera);
      else {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            map.easeTo({ ...camera, duration: 360, essential: false });
          });
        });
      }
    },
    [
      effectsVisible,
      pulseHotspotOutline,
      reduceMotion,
      selectEventInStore,
      viewState.zoom,
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
      if (event) selectEvent(event, true);
    },
    [events, selectEvent],
  );

  const updateZoomBy = (delta: number) => {
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, viewState.zoom + delta),
    );
    const map = mapRef.current;
    if (!map) return;
    if (reduceMotion) map.jumpTo({ zoom: nextZoom });
    else map.easeTo({ zoom: nextZoom, duration: 240 });
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
        key={`popup-${selectedEvent.id}`}
        event={selectedEvent}
        popupOffset={clampPopupOffset(
          popupAnchorPoint,
          selectedEvent.popupOffset,
        )}
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

  if (!webGlSupported) {
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
      data-reduced-motion={reduceMotion ? "true" : "false"}
      data-hotspot-rendering="maplibre-native-circles"
      data-marker-glyph="volume-circles"
      data-special-signal-count="0"
      data-pulse-interval={PULSE_INTERVAL_MS}
      data-pulse-epoch="0"
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
          mapLib={maplibregl}
          mapStyle={PREVIEW_MAP_STYLE}
          pixelRatio={mapRenderProfile.pixelRatio}
          refreshExpiredTiles={false}
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
          onStyleData={() => updateMarkerPositions(true)}
          onLoad={() => {
            const loadedMap = mapRef.current?.getMap();
            loadedMap?.jumpTo(INITIAL_VIEW_STATE);
            if (loadedMap) {
              loadedMap.scrollZoom.setZoomRate(TRACKPAD_ZOOM_RATE);
              loadedMap.scrollZoom.setWheelZoomRate(WHEEL_ZOOM_RATE);
              syncCameraFromMap();
              window.requestAnimationFrame(syncCameraFromMap);
            }
            setTileHealth("ready");
            updateHotspotSource();
            window.requestAnimationFrame(() => updateMarkerPositions(true));
            applyEventCountryState();
            applySelectedCountryState();
            markMapReady();
          }}
          onIdle={markMapReady}
          onMoveStart={() => {
            if (shellRef.current) shellRef.current.dataset.mapMoving = "true";
          }}
          onMoveEnd={(event) => {
            setViewState(event.viewState);
            if (shellRef.current) shellRef.current.dataset.mapMoving = "false";
            setZoom(event.viewState.zoom);
            window.requestAnimationFrame(() => updateMarkerPositions(true));
            window.requestAnimationFrame(updatePopupAnchorPoint);
          }}
          onResize={() => {
            updateMarkerPositions(true);
            updatePopupAnchorPoint();
          }}
          onClick={() => setHoveredEvent(null)}
          onError={(event) => {
            setTileHealth("degraded");
            setMapError(event.error?.message ?? "Unknown map error");
          }}
        />

        <div className={styles.markerOverlay}>
          {mapReady
            ? visibleGroups.map((group) => {
                const event = group.primary;
                const hotspot = group.hotspot;
                const selected = event.id === selectedEventId;
                const hovered = event.id === hoveredEventId;

                return (
                  <div
                    key={event.id}
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
                  >
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

                    {compactViewport === false && selected
                      ? selectedPopup
                      : null}
                  </div>
                );
              })
            : null}
        </div>

        {compactViewport === true ? selectedPopup : null}

        <ActivityRail
          feed={feed}
          fixtureMode={fixtureMode}
          liveRefreshEnabled={mapReady}
        />

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
