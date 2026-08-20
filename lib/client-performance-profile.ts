export type MapExperience = "full" | "lite";

export interface ClientPerformanceCapabilities {
  viewportWidth: number;
  coarsePointer: boolean;
  saveData: boolean;
  effectiveType: string | null;
  deviceMemory: number | null;
  hardwareConcurrency: number | null;
  forcedExperience: MapExperience | null;
}

const CONSTRAINED_CONNECTION_TYPES = new Set(["slow-2g", "2g", "3g"]);

export function selectMapExperience({
  viewportWidth,
  coarsePointer,
  saveData,
  effectiveType,
  deviceMemory,
  hardwareConcurrency,
  forcedExperience,
}: ClientPerformanceCapabilities): MapExperience {
  if (forcedExperience) return forcedExperience;

  if (
    viewportWidth <= 720 ||
    coarsePointer ||
    saveData ||
    (effectiveType !== null &&
      CONSTRAINED_CONNECTION_TYPES.has(effectiveType)) ||
    (deviceMemory !== null && deviceMemory <= 2) ||
    (hardwareConcurrency !== null && hardwareConcurrency <= 2) ||
    (deviceMemory !== null &&
      deviceMemory <= 4 &&
      hardwareConcurrency !== null &&
      hardwareConcurrency <= 4)
  ) {
    return "lite";
  }

  return "full";
}
