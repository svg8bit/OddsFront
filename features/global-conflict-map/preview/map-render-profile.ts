const STANDARD_CANVAS_PIXEL_BUDGET = 1_050_000;
const CONSTRAINED_CANVAS_PIXEL_BUDGET = 800_000;
const MINIMUM_PIXEL_RATIO = 0.75;
const STANDARD_PIXEL_RATIO_CAP = 1.15;
const COMPACT_PIXEL_RATIO_CAP = 1;

interface MapRenderProfileInput {
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  compactOrTouch: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface MapRenderProfile {
  pixelRatio: number;
  quality: "balanced" | "constrained";
  pixelBudget: number;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isConstrainedHardware(
  hardwareConcurrency: number | undefined,
  deviceMemory: number | undefined,
): boolean {
  const lowCoreCount =
    isPositiveFinite(hardwareConcurrency) && hardwareConcurrency <= 4;
  const lowMemory = isPositiveFinite(deviceMemory) && deviceMemory <= 4;
  const severelyLowCoreCount =
    isPositiveFinite(hardwareConcurrency) && hardwareConcurrency <= 2;
  const severelyLowMemory =
    isPositiveFinite(deviceMemory) && deviceMemory <= 2;

  return (
    severelyLowCoreCount ||
    severelyLowMemory ||
    (lowCoreCount && lowMemory)
  );
}

export function selectMapRenderProfile({
  devicePixelRatio,
  viewportWidth,
  viewportHeight,
  compactOrTouch,
  hardwareConcurrency,
  deviceMemory,
}: MapRenderProfileInput): MapRenderProfile {
  const constrained = isConstrainedHardware(
    hardwareConcurrency,
    deviceMemory,
  );
  const pixelBudget = constrained
    ? CONSTRAINED_CANVAS_PIXEL_BUDGET
    : STANDARD_CANVAS_PIXEL_BUDGET;
  const cssPixelArea = Math.max(1, viewportWidth * viewportHeight);
  // The CSS canvas always fills the viewport. Only its WebGL backing store is
  // bounded, preventing large and high-DPI screens from multiplying the
  // fragment workload without a meaningful visual benefit for this dark map.
  const budgetRatio = Math.sqrt(pixelBudget / cssPixelArea);
  const normalizedDevicePixelRatio = isPositiveFinite(devicePixelRatio)
    ? devicePixelRatio
    : 1;
  const qualityCap = compactOrTouch
    ? COMPACT_PIXEL_RATIO_CAP
    : STANDARD_PIXEL_RATIO_CAP;
  const pixelRatio = Math.max(
    MINIMUM_PIXEL_RATIO,
    Math.min(normalizedDevicePixelRatio, qualityCap, budgetRatio),
  );

  return {
    pixelRatio: Math.round(pixelRatio * 100) / 100,
    quality: constrained ? "constrained" : "balanced",
    pixelBudget,
  };
}
