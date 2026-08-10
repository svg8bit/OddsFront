import type { ConflictPreviewEvent } from "@/features/global-conflict-map/preview/types";

export interface MarkerVolumeDomain {
  minimum: number;
  maximum: number;
  logSpan: number;
}

export interface MarkerVisual {
  markerVolume: number;
  markerStrength: number;
  markerScale: number;
}

export interface PreviewHotspot extends MarkerVisual {
  event: ConflictPreviewEvent;
  eventCount: number;
  weeklyChange7d: number | null;
  tensionStrength: number;
  isTense: boolean;
  pixelOffset: [x: number, y: number];
  isSpecialSignal: boolean;
}

export const WEEKLY_SURGE_THRESHOLD = 0.08;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createMarkerVolumeDomain(
  events: readonly ConflictPreviewEvent[],
  minimumVolume: number,
): MarkerVolumeDomain {
  const qualifiedVolumes = events
    .map((event) => event.volume)
    .filter((volume) => Number.isFinite(volume) && volume >= minimumVolume);
  if (qualifiedVolumes.length === 0) {
    const minimum = Math.max(1, minimumVolume);
    const maximum = minimum * 2;
    return {
      minimum,
      maximum,
      logSpan: Math.log(maximum) - Math.log(minimum),
    };
  }

  const observedMinimum = Math.max(1, Math.min(...qualifiedVolumes));
  const observedMaximum = Math.max(observedMinimum + 1, ...qualifiedVolumes);

  return {
    minimum: observedMinimum,
    maximum: observedMaximum,
    logSpan: Math.max(0.0001, Math.log(observedMaximum) - Math.log(observedMinimum)),
  };
}

export function getMarkerVisual(
  volume: number,
  domain: MarkerVolumeDomain,
): MarkerVisual {
  const markerVolume = Math.max(domain.minimum, volume);
  const linearStrength = clamp(
    (Math.log(markerVolume) - Math.log(domain.minimum)) / domain.logSpan,
    0,
    1,
  );
  const markerStrength = Math.pow(linearStrength, 0.8);

  return {
    markerVolume,
    markerStrength,
    markerScale: 0.88 + markerStrength * 0.77,
  };
}

export function getHotspotTension(
  events: readonly ConflictPreviewEvent[],
  markerStrength: number,
): Pick<PreviewHotspot, "weeklyChange7d" | "tensionStrength" | "isTense"> {
  const weeklyChanges = events
    .map((event) => event.priceChange7d)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const weeklyChange7d = weeklyChanges.length > 0 ? Math.max(...weeklyChanges) : null;
  const severityStrength = events.reduce((maximum, event) => {
    const next = event.severity === "critical" ? 0.82 : event.severity === "high" ? 0.58 : 0.34;
    return Math.max(maximum, next);
  }, 0);
  const oddsStrength = events.reduce(
    (maximum, event) => Math.max(maximum, clamp((event.yesOdds - 22) / 58, 0, 1)),
    0,
  );
  const weeklyStrength =
    weeklyChange7d !== null && weeklyChange7d > 0
      ? clamp(weeklyChange7d / 0.25, 0, 1)
      : 0;
  const tensionStrength = clamp(
    Math.max(
      severityStrength,
      markerStrength * 0.88,
      oddsStrength * 0.78,
      weeklyStrength,
    ),
    0,
    1,
  );
  const isTense =
    (weeklyChange7d !== null && weeklyChange7d >= WEEKLY_SURGE_THRESHOLD) ||
    tensionStrength >= 0.79 ||
    markerStrength >= 0.9;

  return { weeklyChange7d, tensionStrength, isTense };
}
