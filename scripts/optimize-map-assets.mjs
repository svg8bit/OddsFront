import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COORDINATE_PRECISION = 3;
const MINIMUM_COUNTRY_COUNT = 170;
const MAX_RENDER_BYTES = 172_000;
const MAX_LABEL_BYTES = 28_000;

const appRoot = process.cwd();
const sourcePath = path.join(
  appRoot,
  "public/maps/ne_110m_admin_0_countries.geojson",
);
const renderPath = path.join(
  appRoot,
  "public/maps/ne_110m_admin_0_countries.render.geojson",
);
const labelsPath = path.join(
  appRoot,
  "public/maps/ne_110m_admin_0_country_labels.geojson",
);

const shouldWrite = process.argv.includes("--write");
const shouldCheck = process.argv.includes("--check");
if (shouldWrite === shouldCheck) {
  throw new Error("Pass exactly one of --write or --check");
}

function assertFeatureCollection(value, label) {
  if (value?.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error(`${label} is not a GeoJSON FeatureCollection`);
  }
  if (value.features.length < MINIMUM_COUNTRY_COUNT) {
    throw new Error(
      `${label} contains only ${value.features.length} country features`,
    );
  }
}

function roundCoordinate(value) {
  if (Array.isArray(value)) return value.map(roundCoordinate);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid GeoJSON coordinate: ${String(value)}`);
  }
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function requiredString(value, field, featureId) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${field} for ${featureId}`);
  }
  return value;
}

function requiredNumber(value, field, featureId) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing ${field} for ${featureId}`);
  }
  return value;
}

const [sourceRaw, renderRaw, labelsRaw] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(renderPath, "utf8"),
  shouldCheck ? readFile(labelsPath, "utf8") : Promise.resolve(null),
]);
const source = JSON.parse(sourceRaw);
const renderSource = JSON.parse(renderRaw);
assertFeatureCollection(source, "Natural Earth source");
assertFeatureCollection(renderSource, "Natural Earth render derivative");
if (shouldCheck) {
  assertFeatureCollection(
    JSON.parse(labelsRaw),
    "Natural Earth label derivative",
  );
}

const sourceById = new Map();
for (const feature of source.features) {
  const featureId = requiredString(
    feature?.properties?.ADM0_A3,
    "ADM0_A3",
    "source feature",
  );
  if (sourceById.has(featureId)) {
    throw new Error(`Duplicate source feature id: ${featureId}`);
  }
  sourceById.set(featureId, feature);
}
const seenRenderIds = new Set();
const render = {
  type: "FeatureCollection",
  features: renderSource.features.map((feature) => {
    const featureId = requiredString(
      feature?.properties?.ADM0_A3,
      "ADM0_A3",
      "render feature",
    );
    if (seenRenderIds.has(featureId)) {
      throw new Error(`Duplicate render feature id: ${featureId}`);
    }
    seenRenderIds.add(featureId);
    if (!sourceById.has(featureId)) {
      throw new Error(`Render feature ${featureId} is absent from the source`);
    }
    if (
      feature?.geometry?.type !== "Polygon" &&
      feature?.geometry?.type !== "MultiPolygon"
    ) {
      throw new Error(`Unexpected geometry for render feature ${featureId}`);
    }
    return {
      type: "Feature",
      properties: {
        ADM0_A3: featureId,
        MAPCOLOR7: requiredNumber(
          feature.properties.MAPCOLOR7,
          "MAPCOLOR7",
          featureId,
        ),
      },
      geometry: {
        type: feature.geometry.type,
        coordinates: roundCoordinate(feature.geometry.coordinates),
      },
    };
  }),
};
const missingRenderIds = [...sourceById.keys()].filter(
  (featureId) => !seenRenderIds.has(featureId),
);
if (missingRenderIds.length > 0) {
  throw new Error(
    `Render derivative is missing source countries: ${missingRenderIds.join(", ")}`,
  );
}

const labels = {
  type: "FeatureCollection",
  features: source.features.map((feature) => {
    const properties = feature?.properties ?? {};
    const featureId = requiredString(
      properties.ADM0_A3,
      "ADM0_A3",
      "source feature",
    );
    return {
      type: "Feature",
      properties: {
        NAME: requiredString(properties.NAME, "NAME", featureId),
        NAME_LONG: requiredString(
          properties.NAME_LONG,
          "NAME_LONG",
          featureId,
        ),
        LABELRANK: requiredNumber(
          properties.LABELRANK,
          "LABELRANK",
          featureId,
        ),
      },
      geometry: {
        type: "Point",
        coordinates: [
          roundCoordinate(
            requiredNumber(properties.LABEL_X, "LABEL_X", featureId),
          ),
          roundCoordinate(
            requiredNumber(properties.LABEL_Y, "LABEL_Y", featureId),
          ),
        ],
      },
    };
  }),
};

const outputs = [
  {
    label: "country render derivative",
    filePath: renderPath,
    current: renderRaw,
    serialized: `${JSON.stringify(render)}\n`,
    maximumBytes: MAX_RENDER_BYTES,
  },
  {
    label: "country label derivative",
    filePath: labelsPath,
    current: labelsRaw ?? "",
    serialized: `${JSON.stringify(labels)}\n`,
    maximumBytes: MAX_LABEL_BYTES,
  },
];

for (const output of outputs) {
  const bytes = Buffer.byteLength(output.serialized);
  if (bytes > output.maximumBytes) {
    throw new Error(
      `${output.label} is ${bytes} bytes; budget is ${output.maximumBytes}`,
    );
  }
}

if (shouldWrite) {
  await Promise.all(
    outputs.map((output) => writeFile(output.filePath, output.serialized, "utf8")),
  );
  for (const output of outputs) {
    console.log(
      `Wrote ${output.label}: ${Buffer.byteLength(output.serialized)} bytes`,
    );
  }
} else {
  const stale = outputs.filter(
    (output) => output.current !== output.serialized,
  );
  if (stale.length > 0) {
    throw new Error(
      `Map assets are not optimized: ${stale
        .map((output) => path.relative(appRoot, output.filePath))
        .join(", ")}. Run npm run generate:map-assets.`,
    );
  }
  console.log(
    `Map assets verified: ${outputs
      .map(
        (output) =>
          `${path.basename(output.filePath)} ${Buffer.byteLength(output.serialized)} bytes`,
      )
      .join(", ")}`,
  );
}
