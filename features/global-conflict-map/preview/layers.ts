import { TONE_PALETTE } from "@/features/global-conflict-map/preview/fixture";
import type { PreviewHotspot } from "@/features/global-conflict-map/preview/marker-visuals";

export const HOTSPOT_SOURCE_ID = "conflict-hotspots";
export const HOTSPOT_PULSE_LAYER_ID = "conflict-hotspot-pulse";

interface HotspotFeatureProperties {
  eventId: string;
  toneColor: string;
  markerScale: number;
  markerStrength: number;
  emphasis: number;
  effectsAlpha: number;
  outerOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  shellOpacity: number;
  orbitInnerOpacity: number;
  orbitOuterOpacity: number;
  coreOpacity: number;
  selected: number;
}

export function createHotspotFeatureCollection(
  hotspots: readonly PreviewHotspot[],
  selectedId: string | null,
  effectsVisible: boolean,
): GeoJSON.FeatureCollection<GeoJSON.Point, HotspotFeatureProperties> {
  const effectsAlpha = effectsVisible ? 1 : 0;

  return {
    type: "FeatureCollection",
    features: hotspots.map((hotspot) => {
      const selected = hotspot.event.id === selectedId;
      const emphasis = selected ? 1.08 : 1;
      const visualEmphasis =
        (0.56 + hotspot.markerStrength * 0.66) * emphasis;

      return {
        type: "Feature",
        id: hotspot.event.id,
        properties: {
          eventId: hotspot.event.id,
          toneColor: TONE_PALETTE[hotspot.event.tone].hex,
          markerScale: hotspot.markerScale,
          markerStrength: hotspot.markerStrength,
          emphasis,
          effectsAlpha,
          outerOpacity: (3 / 255) * visualEmphasis * effectsAlpha,
          innerOpacity: (18 / 255) * visualEmphasis * effectsAlpha,
          bloomOpacity:
            ((22 + hotspot.markerStrength * 30) / 255) * emphasis,
          shellOpacity:
            ((70 + hotspot.markerStrength * 72) / 255) * emphasis,
          orbitInnerOpacity: (38 / 255) * visualEmphasis * effectsAlpha,
          orbitOuterOpacity: (18 / 255) * visualEmphasis * effectsAlpha,
          coreOpacity: Math.min(
            1,
            (176 + hotspot.markerStrength * 72 + (selected ? 7 : 0)) / 255,
          ),
          selected: selected ? 1 : 0,
        },
        geometry: {
          type: "Point",
          coordinates: hotspot.event.coordinates,
        },
      };
    }),
  };
}
