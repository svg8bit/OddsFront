import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const maxZoom = 3;
const outputRoot = path.resolve(process.cwd(), "public/maps/night-earth");
const sourceTemplate =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg";

const records = [];

for (let z = 0; z <= maxZoom; z += 1) {
  const side = 2 ** z;
  for (let x = 0; x < side; x += 1) {
    for (let y = 0; y < side; y += 1) {
      const sourceUrl = sourceTemplate
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const destination = path.join(outputRoot, String(z), String(x), `${y}.jpg`);

      const response = await fetch(sourceUrl, {
        headers: { "user-agent": "DropsAnalytics map texture builder" },
      });
      if (!response.ok) {
        throw new Error(`NASA GIBS tile failed (${response.status}): ${sourceUrl}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      records.push({
        path: path.relative(outputRoot, destination),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}

const manifest = {
  dataset: "NASA GIBS VIIRS City Lights 2012",
  role: "Low-opacity contextual night-earth texture; not live conflict evidence",
  sourceTemplate,
  maxZoom,
  tileSize: 256,
  tileCount: records.length,
  totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
  attribution: "NASA EOSDIS GIBS / Suomi NPP VIIRS",
  records,
};

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

process.stdout.write(
  `Downloaded ${manifest.tileCount} tiles (${manifest.totalBytes} bytes) to ${outputRoot}\n`,
);
