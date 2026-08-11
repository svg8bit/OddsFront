export type PreviewTone = "violet" | "red" | "blue" | "orange";

export type PreviewCoordinate = [longitude: number, latitude: number];

export type PreviewDataMode = "live" | "fallback";

export type PreviewDataOrigin = "polymarket" | "fixture";

export type PreviewEvidenceStatus =
  | "exact-place"
  | "country-anchor"
  | "regional-anchor"
  | "illustrative-fixture";

export type PreviewGeographyKind =
  | "place"
  | "country"
  | "regional"
  | "alliance";

export interface ConflictPreviewEvent {
  id: string;
  title: string;
  region: string;
  coordinates: PreviewCoordinate;
  countryCodes: string[];
  countryFeatureIds: string[];
  yesOdds: number;
  noOdds: number;
  volume: number;
  tone: PreviewTone;
  severity: "elevated" | "high" | "critical";
  regionPolygon: PreviewCoordinate[];
  popupOffset: [x: number, y: number];
  locationId: string;
  locationLabel: string;
  minimumZoom: number;
  dataOrigin: PreviewDataOrigin;
  evidenceStatus: PreviewEvidenceStatus;
  geographyKind: PreviewGeographyKind;
  marketUrl: string | null;
  updatedAt: string;
  sourceLabel: string;
  volume24h: number;
  liquidity: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  endDate: string | null;
  marketConditionId: string | null;
}

export type ConflictActivityKind =
  | "odds-rise"
  | "odds-drop"
  | "large-buy"
  | "large-sell";

export interface ConflictTradeActivity {
  id: string;
  kind: "large-buy" | "large-sell";
  title: string;
  outcome: string;
  outcomeOdds: number;
  marketConditionId: string;
  notional: number;
  occurredAt: string;
  marketUrl: string;
}

export interface ConflictActivityFeed {
  dataMode: "live" | "unavailable";
  updatedAt: string;
  expiresAfterSeconds: number;
  sourceLabel: string;
  items: ConflictTradeActivity[];
}

export interface ConflictPreviewFeed {
  dataMode: PreviewDataMode;
  updatedAt: string;
  refreshSeconds: number;
  minimumVolume: number;
  sourceLabel: string;
  sourceUrl: string;
  events: ConflictPreviewEvent[];
  excludedCount: number;
}

export interface PreviewViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface TonePalette {
  hex: string;
  rgb: [number, number, number];
}
