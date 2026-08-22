import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

import {
  HOTSPOT_PULSE_LAYER_ID,
  HOTSPOT_SOURCE_ID,
} from "@/features/global-conflict-map/preview/layers";

const OPEN_FREE_MAP_TILES =
  "https://tiles.openfreemap.org/planet/20260802_080001_pt/{z}/{x}/{y}.pbf";
const LOCAL_MAP_GLYPHS = "/maps/fonts/{fontstack}/{range}.pbf";
const DETAIL_TILE_MIN_ZOOM = 3;

const placeName: ExpressionSpecification = [
  "coalesce",
  ["get", "name:en"],
  ["get", "name_en"],
  ["get", "name:latin"],
  ["get", "name"],
];

const toneColor: ExpressionSpecification = [
  "match",
  [
    "coalesce",
    ["feature-state", "selectedTone"],
    ["feature-state", "eventTone"],
  ],
  "violet",
  "#C05CFF",
  "red",
  "#FF5368",
  "blue",
  "#4F86FF",
  "orange",
  "#FF9A42",
  "#8CA6CE",
];

const hotspotToneColor: ExpressionSpecification = [
  "to-color",
  ["get", "toneColor"],
];

const hotspotScale: ExpressionSpecification = [
  "number",
  ["get", "markerScale"],
  1,
];

const hotspotEmphasis: ExpressionSpecification = [
  "number",
  ["get", "emphasis"],
  1,
];

function hotspotRadius(radius: number): ExpressionSpecification {
  return ["*", radius, hotspotScale, hotspotEmphasis];
}

function hotspotOpacity(property: string): ExpressionSpecification {
  return ["number", ["get", property], 0];
}

const hotspotLayers: LayerSpecification[] = [
  {
    id: "conflict-hotspot-haze-outer",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": hotspotToneColor,
      "circle-radius": hotspotRadius(34),
      "circle-opacity": hotspotOpacity("outerOpacity"),
      "circle-blur": 0,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-haze-inner",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": hotspotToneColor,
      "circle-radius": hotspotRadius(14),
      "circle-opacity": hotspotOpacity("innerOpacity"),
      "circle-blur": 0,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-core-bloom",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": hotspotToneColor,
      "circle-radius": hotspotRadius(9.2),
      "circle-opacity": hotspotOpacity("bloomOpacity"),
      "circle-blur": 0,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-core-shell",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": hotspotToneColor,
      "circle-radius": hotspotRadius(6.2),
      "circle-opacity": hotspotOpacity("shellOpacity"),
      "circle-blur": 0,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-orbit-inner",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-opacity": 0,
      "circle-radius": hotspotRadius(8.8),
      "circle-stroke-color": hotspotToneColor,
      "circle-stroke-opacity": hotspotOpacity("orbitInnerOpacity"),
      "circle-stroke-width": 1.15,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-orbit-outer",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-opacity": 0,
      "circle-radius": hotspotRadius(13.2),
      "circle-stroke-color": hotspotToneColor,
      "circle-stroke-opacity": hotspotOpacity("orbitOuterOpacity"),
      "circle-stroke-width": 0.9,
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: HOTSPOT_PULSE_LAYER_ID,
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    filter: ["==", ["get", "selected"], 1],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-opacity": 0,
      "circle-radius": hotspotRadius(31),
      "circle-radius-transition": { duration: 620, delay: 0 },
      "circle-stroke-color": hotspotToneColor,
      "circle-stroke-opacity": 0,
      "circle-stroke-opacity-transition": { duration: 620, delay: 0 },
      "circle-stroke-width": [
        "+",
        0.8,
        ["*", 0.85, ["number", ["get", "markerStrength"], 0]],
      ],
      "circle-pitch-alignment": "viewport",
    },
  },
  {
    id: "conflict-hotspot-core",
    type: "circle",
    source: HOTSPOT_SOURCE_ID,
    paint: {
      "circle-color": hotspotToneColor,
      "circle-radius": hotspotRadius(3.35),
      "circle-opacity": hotspotOpacity("coreOpacity"),
      "circle-blur": 0,
      "circle-pitch-alignment": "viewport",
    },
  },
];

export const SELECTED_COUNTRY_PULSE_ACTIVE: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0.34,
  ["boolean", ["feature-state", "event"], false],
  0.085,
  0,
];

export const SELECTED_COUNTRY_PULSE_IDLE: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0,
  0,
];

export const COUNTRY_CONTEXT_FILL_ACTIVE: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0.095,
  ["boolean", ["feature-state", "hovered"], false],
  0.045,
  ["boolean", ["feature-state", "event"], false],
  0.028,
  0,
];

export const COUNTRY_CONTEXT_FILL_IDLE: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0.055,
  ["boolean", ["feature-state", "hovered"], false],
  0.032,
  ["boolean", ["feature-state", "event"], false],
  0.016,
  0,
];

const oceanLabels = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { name: "N o r t h  A t l a n t i c\nO c e a n" },
      geometry: { type: "Point" as const, coordinates: [-35, 24] },
    },
    {
      type: "Feature" as const,
      properties: { name: "S o u t h  A t l a n t i c\nO c e a n" },
      geometry: { type: "Point" as const, coordinates: [-25, -27] },
    },
    {
      type: "Feature" as const,
      properties: { name: "I n d i a n\nO c e a n" },
      geometry: { type: "Point" as const, coordinates: [78, -24] },
    },
    {
      type: "Feature" as const,
      properties: { name: "N o r t h  P a c i f i c\nO c e a n" },
      geometry: { type: "Point" as const, coordinates: [158, 14] },
    },
  ],
};

export const PREVIEW_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "DropsBot Midnight Conflict Preview",
  glyphs: LOCAL_MAP_GLYPHS,
  sources: {
    openmaptiles: {
      type: "vector",
      tiles: [OPEN_FREE_MAP_TILES],
      minzoom: DETAIL_TILE_MIN_ZOOM,
      maxzoom: 14,
      attribution:
        "© OpenStreetMap contributors · OpenFreeMap",
    },
    countries: {
      type: "geojson",
      data: "/maps/ne_110m_admin_0_countries.render.geojson",
      promoteId: "ADM0_A3",
      attribution: "Natural Earth",
    },
    "country-labels": {
      type: "geojson",
      data: "/maps/ne_110m_admin_0_country_labels.geojson",
    },
    "night-earth": {
      type: "raster",
      tiles: ["/maps/night-earth/{z}/{x}/{y}.jpg"],
      // Rendering the 256px source tiles as 512px deliberately chooses one
      // lower source zoom. The texture stays soft and the first frame needs
      // 4x fewer image requests.
      tileSize: 512,
      minzoom: 0,
      maxzoom: 3,
      attribution: "NASA EOSDIS GIBS / Suomi NPP VIIRS",
    },
    oceans: {
      type: "geojson",
      data: oceanLabels,
    },
    [HOTSPOT_SOURCE_ID]: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    },
  },
  layers: [
    {
      id: "land-background",
      type: "background",
      paint: {
        // At low zoom the world can be narrower than the viewport. Matching the
        // fallback canvas to the ocean prevents visible antimeridian/world-copy
        // strips; the real land fill below restores the continent geometry.
        "background-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          "#061322",
          2.4,
          "#061322",
          3.2,
          "#0A192C",
        ],
      },
    },
    {
      id: "country-land-base",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          "#081729",
          3,
          "#0A1A2E",
          7,
          "#0C2037",
        ],
        "fill-opacity": 1,
        "fill-antialias": false,
      },
    },
    {
      id: "continent-tonal-depth",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "match",
          ["get", "MAPCOLOR7"],
          1,
          "#122B47",
          2,
          "#102943",
          3,
          "#142D49",
          4,
          "#102740",
          5,
          "#132B45",
          6,
          "#102B48",
          7,
          "#142A43",
          "#10263E",
        ],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.19,
          4,
          0.11,
          7,
          0.06,
        ],
        "fill-antialias": false,
      },
    },
    {
      id: "night-earth-texture",
      type: "raster",
      source: "night-earth",
      paint: {
        "raster-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.25,
          2.2,
          0.17,
          3,
          0.09,
          5,
          0.035,
          7,
          0.015,
        ],
        "raster-contrast": -0.08,
        "raster-saturation": -0.9,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.46,
        "raster-fade-duration": 0,
        "raster-resampling": "linear",
      },
    },
    {
      id: "natural-landcover-depth",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "wood",
          "#123150",
          "grass",
          "#112B46",
          "scrub",
          "#122941",
          "crop",
          "#132A42",
          "farmland",
          "#132A42",
          "sand",
          "#172C43",
          "ice",
          "#1A3653",
          "snow",
          "#1A3653",
          "wetland",
          "#0E2D49",
          "#10253E",
        ],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.055,
          3,
          0.09,
          7,
          0.15,
        ],
        "fill-antialias": false,
      },
    },
    {
      id: "residential-land-texture",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      minzoom: 3.2,
      filter: ["==", ["get", "class"], "residential"],
      paint: {
        "fill-color": "#183451",
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3.2,
          0.035,
          5,
          0.07,
          7,
          0.11,
        ],
        "fill-antialias": false,
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": "#061322", "fill-opacity": 1 },
    },
    {
      id: "water-edge",
      type: "line",
      source: "openmaptiles",
      "source-layer": "water",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: {
        "line-color": "rgba(47,91,143,.28)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 7, 0.85],
      },
    },
    {
      id: "country-boundaries-local",
      type: "line",
      source: "countries",
      maxzoom: DETAIL_TILE_MIN_ZOOM,
      paint: {
        "line-color": "#53769F",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.28,
          DETAIL_TILE_MIN_ZOOM,
          0.42,
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.42,
          DETAIL_TILE_MIN_ZOOM,
          0.62,
        ],
      },
    },
    {
      id: "country-selected-fill",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": toneColor,
        "fill-opacity": COUNTRY_CONTEXT_FILL_IDLE,
        "fill-opacity-transition": { duration: 760, delay: 0 },
      },
    },
    {
      id: "country-selected-glow",
      type: "line",
      source: "countries",
      paint: {
        "line-color": toneColor,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.14,
          ["boolean", ["feature-state", "event"], false],
          0.045,
          0,
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3.4,
          ["boolean", ["feature-state", "event"], false],
          1.8,
          0.8,
        ],
        "line-blur": 2.2,
      },
    },
    {
      id: "country-selected-line",
      type: "line",
      source: "countries",
      paint: {
        "line-color": toneColor,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.5,
          ["boolean", ["feature-state", "hovered"], false],
          0.24,
          ["boolean", ["feature-state", "event"], false],
          0.12,
          0,
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1.15,
          ["boolean", ["feature-state", "event"], false],
          0.68,
          0.6,
        ],
        "line-blur": 0.2,
      },
    },
    {
      id: "country-selected-pulse",
      type: "line",
      source: "countries",
      paint: {
        "line-color": toneColor,
        "line-opacity": SELECTED_COUNTRY_PULSE_IDLE,
        "line-opacity-transition": { duration: 620, delay: 0 },
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          4.8,
          0.8,
        ],
        "line-blur": 2.8,
      },
    },
    {
      id: "country-boundaries",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      filter: [
        "all",
        ["==", ["get", "admin_level"], 2],
        ["!=", ["get", "maritime"], 1],
        ["!=", ["get", "disputed"], 1],
        ["!", ["has", "claimed_by"]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#53769F",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.34, 4, 0.46, 7, 0.62],
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.48, 4, 0.66, 7, 0.86],
      },
    },
    {
      id: "country-boundaries-disputed",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      filter: [
        "all",
        ["!=", ["get", "maritime"], 1],
        ["==", ["get", "disputed"], 1],
      ],
      paint: {
        "line-color": "rgba(112,145,196,.26)",
        "line-width": 0.7,
        "line-dasharray": [1.2, 2.2],
      },
    },
    {
      id: "regional-boundaries",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: 3.4,
      filter: [
        "all",
        [">=", ["get", "admin_level"], 3],
        ["<=", ["get", "admin_level"], 6],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: {
        "line-color": "#41658D",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3.4, 0.28, 7, 0.62],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.4, 0.1, 5, 0.22, 7, 0.36],
      },
    },
    ...hotspotLayers,
    {
      id: "city-light-points",
      type: "circle",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      filter: ["==", ["get", "class"], "city"],
      paint: {
        "circle-color": "#B6C9E8",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1.4, 0.45, 4, 0.75, 7, 1.2],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1.4, 0.08, 4, 0.18, 7, 0.28],
        "circle-blur": 0.7,
      },
    },
    {
      id: "country-label-major-local",
      type: "symbol",
      source: "country-labels",
      minzoom: 0.8,
      maxzoom: DETAIL_TILE_MIN_ZOOM,
      filter: ["<=", ["coalesce", ["get", "LABELRANK"], 9], 3],
      layout: {
        "text-field": [
          "coalesce",
          ["get", "NAME_LONG"],
          ["get", "NAME"],
        ],
        "text-font": ["Open Sans Semibold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          9.3,
          DETAIL_TILE_MIN_ZOOM,
          11.4,
        ],
        "text-letter-spacing": 0.012,
        "text-max-width": 7,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": "#92A4BC",
        "text-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.64,
          DETAIL_TILE_MIN_ZOOM,
          0.8,
        ],
        "text-halo-color": "rgba(5,13,24,.94)",
        "text-halo-width": 1.15,
        "text-halo-blur": 0.35,
      },
    },
    {
      id: "country-label-secondary-local",
      type: "symbol",
      source: "country-labels",
      minzoom: 2.1,
      maxzoom: DETAIL_TILE_MIN_ZOOM,
      filter: [
        "all",
        [">", ["coalesce", ["get", "LABELRANK"], 9], 3],
        ["<=", ["coalesce", ["get", "LABELRANK"], 9], 5],
      ],
      layout: {
        "text-field": [
          "coalesce",
          ["get", "NAME_LONG"],
          ["get", "NAME"],
        ],
        "text-font": ["Open Sans Semibold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2.1,
          8.5,
          DETAIL_TILE_MIN_ZOOM,
          10,
        ],
        "text-max-width": 7,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#73869F",
        "text-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2.1,
          0.4,
          DETAIL_TILE_MIN_ZOOM,
          0.65,
        ],
        "text-halo-color": "rgba(5,13,24,.92)",
        "text-halo-width": 1.05,
      },
    },
    {
      id: "country-label-major",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      maxzoom: 7,
      filter: [
        "all",
        ["==", ["get", "class"], "country"],
        ["<=", ["coalesce", ["get", "rank"], 9], 3],
      ],
      layout: {
        "text-field": placeName,
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9.5, 4, 12, 7, 13.5],
        "text-letter-spacing": 0.015,
        "text-max-width": 7,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": "#9AAAC0",
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 3, 0.86, 7, 0.94],
        "text-halo-color": "rgba(5,13,24,.94)",
        "text-halo-width": 1.25,
        "text-halo-blur": 0.35,
      },
    },
    {
      id: "country-label-secondary",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: DETAIL_TILE_MIN_ZOOM,
      maxzoom: 7,
      filter: [
        "all",
        ["==", ["get", "class"], "country"],
        [">", ["coalesce", ["get", "rank"], 9], 3],
        ["<=", ["coalesce", ["get", "rank"], 9], 6],
      ],
      layout: {
        "text-field": placeName,
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2.2, 9, 5, 11.5, 7, 12.5],
        "text-max-width": 7,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#7689A2",
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 2.2, 0.44, 4, 0.72, 7, 0.84],
        "text-halo-color": "rgba(5,13,24,.92)",
        "text-halo-width": 1.1,
      },
    },
    {
      id: "capital-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 3,
      filter: [
        "all",
        ["==", ["get", "class"], "city"],
        ["==", ["get", "capital"], 2],
      ],
      layout: {
        "text-field": placeName,
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9.5, 7, 12],
        "text-offset": [0, 0.8],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#91A1B7",
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.46, 5, 0.76, 7, 0.9],
        "text-halo-color": "rgba(5,13,24,.94)",
        "text-halo-width": 1.2,
      },
    },
    {
      id: "major-city-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 5.25,
      filter: [
        "all",
        ["==", ["get", "class"], "city"],
        ["!=", ["get", "capital"], 2],
        ["<=", ["coalesce", ["get", "rank"], 99], 8],
      ],
      layout: {
        "text-field": placeName,
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5.25, 9, 7, 11.5],
        "text-offset": [0, 0.7],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#71859F",
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 5.25, 0.34, 7, 0.72],
        "text-halo-color": "rgba(5,13,24,.94)",
        "text-halo-width": 1.05,
      },
    },
    {
      id: "ocean-labels",
      type: "symbol",
      source: "oceans",
      maxzoom: 3.5,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 3, 12],
        "text-line-height": 1.45,
        "text-letter-spacing": 0.08,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#2F6FB5",
        "text-opacity": 0.58,
        "text-halo-color": "rgba(6,19,34,.9)",
        "text-halo-width": 1,
      },
    },
  ],
};

const EFFICIENT_OMITTED_LAYER_IDS = new Set([
  "night-earth-texture",
  "country-selected-glow",
  "conflict-hotspot-haze-outer",
  "conflict-hotspot-haze-inner",
  "conflict-hotspot-orbit-outer",
]);

const CONSTRAINED_OMITTED_LAYER_IDS = new Set([
  ...EFFICIENT_OMITTED_LAYER_IDS,
  "continent-tonal-depth",
  "natural-landcover-depth",
  "residential-land-texture",
  "country-selected-fill",
  "country-selected-pulse",
  "conflict-hotspot-orbit-inner",
  HOTSPOT_PULSE_LAYER_ID,
  "city-light-points",
  "country-label-secondary-local",
]);

export function createPreviewMapStyle(
  quality: "balanced" | "constrained",
): StyleSpecification {
  const sources = Object.fromEntries(
    Object.entries(PREVIEW_MAP_STYLE.sources).filter(
      ([sourceId]) => sourceId !== "night-earth",
    ),
  );
  return {
    ...PREVIEW_MAP_STYLE,
    name:
      quality === "constrained"
        ? "DropsBot Midnight Conflict Preview · Constrained"
        : "DropsBot Midnight Conflict Preview · Efficient",
    sources,
    layers: PREVIEW_MAP_STYLE.layers.filter(
      (layer) =>
        !(quality === "constrained"
          ? CONSTRAINED_OMITTED_LAYER_IDS
          : EFFICIENT_OMITTED_LAYER_IDS
        ).has(layer.id),
    ),
  };
}
