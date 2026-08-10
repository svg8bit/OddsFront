import { REGION_DEFINITIONS } from "@/features/global-conflict-map/data/regions";
import type {
  ConflictFeed,
  ConflictMarket,
} from "@/features/global-conflict-map/types";

const FIXTURE_UPDATED_AT = "2026-08-05T18:33:00.000Z";

const fixtureValues: Record<
  string,
  Pick<
    ConflictMarket,
    "question" | "yes" | "no" | "volume24h" | "totalVolume" | "liquidity"
  >
> = {
  "eastern-europe": {
    question: "Ceasefire by Sep?",
    yes: 38,
    no: 62,
    volume24h: 7_420_000,
    totalVolume: 74_200_000,
    liquidity: 5_840_000,
  },
  "middle-east": {
    question: "Escalation this month?",
    yes: 57,
    no: 43,
    volume24h: 11_260_000,
    totalVolume: 112_600_000,
    liquidity: 8_920_000,
  },
  "south-asia": {
    question: "Border clash expands?",
    yes: 45,
    no: 55,
    volume24h: 6_130_000,
    totalVolume: 61_300_000,
    liquidity: 4_680_000,
  },
  "east-asia": {
    question: "US strike before EOY?",
    yes: 28,
    no: 72,
    volume24h: 8_910_000,
    totalVolume: 89_100_000,
    liquidity: 6_460_000,
  },
  "horn-of-africa": {
    question: "Peace deal in 2026?",
    yes: 46,
    no: 54,
    volume24h: 4_870_000,
    totalVolume: 48_700_000,
    liquidity: 3_240_000,
  },
};

export const CONFLICT_FIXTURE: ConflictMarket[] = REGION_DEFINITIONS.map(
  (region, index) => {
    const values = fixtureValues[region.id];

    return {
      id: `fixture-${region.id}`,
      eventId: `fixture-event-${index + 1}`,
      eventTitle: values.question,
      regionId: region.id,
      region: region.name,
      tone: region.tone,
      anchor: region.anchor,
      polygon: region.polygon,
      cardOffset: region.cardOffset,
      ...values,
      endDate: null,
      updatedAt: FIXTURE_UPDATED_AT,
      dataOrigin: "fixture",
      evidenceStatus: "schematic",
      marketUrl: null,
      sourceLabel: "Deterministic visual fixture",
      sourceUrl: "/global-conflict-map?fixture=1",
    } satisfies ConflictMarket;
  },
);

export function getFixtureFeed(): ConflictFeed {
  return {
    dataMode: "fallback",
    updatedAt: FIXTURE_UPDATED_AT,
    refreshSeconds: 60,
    markets: CONFLICT_FIXTURE,
  };
}
