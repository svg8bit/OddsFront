import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();
const sourcePath = path.join(
  appRoot,
  "public/maps/ne_110m_admin_0_countries.geojson",
);
const outputPath = path.join(
  appRoot,
  "features/global-conflict-map/preview/country-anchors.generated.json",
);

const source = JSON.parse(await readFile(sourcePath, "utf8"));
if (source?.type !== "FeatureCollection" || !Array.isArray(source.features)) {
  throw new Error("Natural Earth country source is not a FeatureCollection");
}

const isIso2 = (value) => typeof value === "string" && /^[A-Z]{2}$/.test(value);
const isFeatureId = (value) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);
const isCoordinate = (value) =>
  typeof value === "number" && Number.isFinite(value);

const anchors = source.features
  .map((feature) => {
    const properties = feature?.properties ?? {};
    const iso2 = isIso2(properties.ISO_A2)
      ? properties.ISO_A2
      : isIso2(properties.POSTAL)
        ? properties.POSTAL
        : null;
    const featureId = properties.ADM0_A3;
    const longitude = properties.LABEL_X;
    const latitude = properties.LABEL_Y;
    if (
      !iso2 ||
      !isFeatureId(featureId) ||
      !isCoordinate(longitude) ||
      !isCoordinate(latitude)
    ) {
      return null;
    }

    const aliases = [
      properties.NAME_LONG,
      properties.ADMIN,
      properties.NAME,
      properties.NAME_CIAWF,
      properties.FORMAL_EN,
    ]
      .filter((value) => typeof value === "string" && value.trim().length >= 3)
      .map((value) => value.trim());

    return {
      featureId,
      iso2,
      name: String(properties.NAME_LONG || properties.ADMIN || properties.NAME),
      aliases: [...new Set(aliases)],
      continent: String(properties.CONTINENT || "Global"),
      region: String(properties.SUBREGION || properties.REGION_UN || "Global"),
      coordinates: [longitude, latitude],
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.featureId.localeCompare(right.featureId));

if (anchors.length < 170) {
  throw new Error(`Country anchor generation produced only ${anchors.length} entries`);
}

await writeFile(outputPath, `${JSON.stringify(anchors, null, 2)}\n`, "utf8");
console.log(`Generated ${anchors.length} country anchors at ${outputPath}`);
