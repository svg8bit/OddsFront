export type ConflictTone = "red" | "blue" | "violet" | "orange";

export type DataMode = "live" | "mixed" | "fallback";

export type DataOrigin = "polymarket" | "fixture";

export type EvidenceStatus = "regional-anchor" | "schematic";

export type Coordinate = [longitude: number, latitude: number];

export interface ConflictMarket {
  id: string;
  eventId: string;
  eventTitle: string;
  regionId: string;
  region: string;
  tone: ConflictTone;
  anchor: Coordinate;
  polygon: Coordinate[];
  cardOffset: [x: number, y: number];
  question: string;
  yes: number;
  no: number;
  volume24h: number;
  totalVolume: number;
  liquidity: number;
  endDate: string | null;
  updatedAt: string;
  dataOrigin: DataOrigin;
  evidenceStatus: EvidenceStatus;
  marketUrl: string | null;
  sourceLabel: string;
  sourceUrl: string;
}
export interface ConflictFeed {
  dataMode: DataMode;
  updatedAt: string;
  refreshSeconds: number;
  markets: ConflictMarket[];
}

export interface RegionDefinition {
  id: string;
  name: string;
  tone: ConflictTone;
  anchor: Coordinate;
  polygon: Coordinate[];
  cardOffset: [x: number, y: number];
  searchQuery: string;
}
