import type {
  ConflictTone,
  RegionDefinition,
} from "@/features/global-conflict-map/types";

export const REGION_DEFINITIONS: RegionDefinition[] = [
  {
    id: "eastern-europe",
    name: "Eastern Europe",
    tone: "violet",
    anchor: [31.25, 48.35],
    polygon: [
      [21.5, 44.1],
      [25.2, 47.3],
      [23.9, 51.1],
      [31.3, 54.4],
      [38.4, 51.5],
      [37.2, 45.8],
      [30.6, 43.6],
      [21.5, 44.1],
    ],
    cardOffset: [-220, -126],
    searchQuery: "Ukraine ceasefire",
  },
  {
    id: "middle-east",
    name: "Middle East",
    tone: "red",
    anchor: [51.2, 31.4],
    polygon: [
      [35.0, 36.4],
      [43.4, 37.4],
      [53.0, 34.5],
      [59.2, 27.4],
      [51.9, 21.0],
      [41.1, 23.1],
      [35.0, 30.2],
      [35.0, 36.4],
    ],
    cardOffset: [-300, -54],
    searchQuery: "Iran ceasefire",
  },
  {
    id: "south-asia",
    name: "South Asia",
    tone: "blue",
    anchor: [74.7, 32.3],
    polygon: [
      [66.4, 37.2],
      [77.0, 37.1],
      [82.5, 31.4],
      [78.8, 23.3],
      [69.0, 23.8],
      [66.4, 37.2],
    ],
    cardOffset: [52, -62],
    searchQuery: "India Pakistan strike",
  },
  {
    id: "east-asia",
    name: "East Asia",
    tone: "violet",
    anchor: [121.1, 23.8],
    polygon: [
      [116.0, 19.0],
      [123.5, 19.0],
      [127.0, 26.7],
      [121.1, 31.3],
      [116.0, 27.0],
      [116.0, 19.0],
    ],
    cardOffset: [28, -184],
    searchQuery: "Taiwan military",
  },
  {
    id: "horn-of-africa",
    name: "Horn of Africa",
    tone: "orange",
    anchor: [35.2, 12.9],
    polygon: [
      [22.0, 22.1],
      [35.0, 22.1],
      [42.4, 15.5],
      [40.2, 7.0],
      [29.0, 8.0],
      [22.0, 22.1],
    ],
    cardOffset: [36, 34],
    searchQuery: "Sudan ceasefire",
  },
];

export const TONE_RGB: Record<ConflictTone, [number, number, number]> = {
  red: [255, 73, 86],
  blue: [69, 139, 255],
  violet: [165, 79, 255],
  orange: [255, 139, 54],
};

export const TONE_HEX: Record<ConflictTone, string> = {
  red: "#ff4956",
  blue: "#458bff",
  violet: "#a54fff",
  orange: "#ff8b36",
};

export function getRegion(regionId: string): RegionDefinition | undefined {
  return REGION_DEFINITIONS.find((region) => region.id === regionId);
}
