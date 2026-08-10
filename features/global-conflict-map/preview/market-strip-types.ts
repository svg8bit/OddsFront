export type MarketStripDataMode = "live" | "partial" | "unavailable";

export interface MarketStripAsset {
  id: string;
  displaySymbol: string;
  name: string;
  sourceSymbol: string;
  slug: string;
  price: number | null;
  priceChange24h: number | null;
  dropsBotUrl: string;
  dropstabUrl: string;
}

export interface MarketStripFeed {
  dataMode: MarketStripDataMode;
  updatedAt: string;
  refreshSeconds: number;
  sourceLabel: string;
  assets: MarketStripAsset[];
}
