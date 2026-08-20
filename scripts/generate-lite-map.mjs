import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  projectRoot,
  "public/maps/ne_110m_admin_0_countries.render.geojson",
);
const labelsPath = path.join(
  projectRoot,
  "public/maps/ne_110m_admin_0_country_labels.geojson",
);
const outputPath = path.join(projectRoot, "public/maps/world-lite-v1.svg");

const WIDTH = 1_600;
const HEIGHT = 900;
const MIN_LATITUDE = -75;
const MAX_LATITUDE = 82;

const LAND_TONES = [
  "#0b1b30",
  "#0c1d33",
  "#0d2037",
  "#0b1e34",
  "#0e2138",
  "#0c2036",
  "#0d1f35",
];

function mercator(latitude) {
  const bounded = Math.min(85, Math.max(-85, latitude));
  const radians = (bounded * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

const minimumMercator = mercator(MIN_LATITUDE);
const maximumMercator = mercator(MAX_LATITUDE);

function project([longitude, latitude]) {
  const x = ((longitude + 180) / 360) * WIDTH;
  const y =
    ((maximumMercator - mercator(latitude)) /
      (maximumMercator - minimumMercator)) *
    HEIGHT;
  return [x, y];
}

function round(value) {
  return Number(value.toFixed(1));
}

function ringPath(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return "";
  return `${ring
    .map((coordinate, index) => {
      const [x, y] = project(coordinate);
      return `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
    })
    .join(" ")}Z`;
}

function geometryPath(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return "";
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map(ringPath).filter(Boolean).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map(ringPath))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const labelsSource = JSON.parse(await readFile(labelsPath, "utf8"));
const countries = source.features
  .map((feature) => {
    const pathData = geometryPath(feature.geometry);
    if (!pathData) return null;
    const mapColor = Number(feature.properties?.MAPCOLOR7 ?? 1);
    const tone = LAND_TONES[(Math.max(1, mapColor) - 1) % LAND_TONES.length];
    return `<path d="${pathData}" fill="${tone}"/>`;
  })
  .filter(Boolean)
  .join("");
const labels = labelsSource.features
  .filter((feature) => Number(feature.properties?.LABELRANK ?? 99) <= 2)
  .map((feature) => {
    const [x, y] = project(feature.geometry.coordinates);
    const name =
      feature.properties?.NAME_LONG ?? feature.properties?.NAME ?? "";
    const size = 11;
    const opacity = 0.62;
    return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" opacity="${opacity}">${escapeXml(name)}</text>`;
  })
  .join("");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title description">
  <title id="title">World conflict map</title>
  <desc id="description">Lightweight Natural Earth world map used when the detailed WebGL map is unavailable or intentionally disabled.</desc>
  <defs>
    <radialGradient id="ocean" cx="58%" cy="42%" r="78%">
      <stop offset="0" stop-color="#0a1a2e"/>
      <stop offset="0.58" stop-color="#061322"/>
      <stop offset="1" stop-color="#020a16"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#ocean)"/>
  <g stroke="#355477" stroke-width="0.65" stroke-opacity="0.78" stroke-linejoin="round">${countries}</g>
  <g fill="#91a1b7" stroke="#050d18" stroke-width="2.4" paint-order="stroke" text-anchor="middle" font-family="Arial, sans-serif" font-weight="600">${labels}</g>
</svg>
`;

await writeFile(outputPath, svg);
console.log(`Wrote ${path.relative(projectRoot, outputPath)} (${Buffer.byteLength(svg)} bytes)`);
