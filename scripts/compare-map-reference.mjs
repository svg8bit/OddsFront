import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

function argumentValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const referencePath = path.resolve(
  process.cwd(),
  argumentValue(
    "reference",
    "docs/reference/map-approval-1672x941.png",
  ),
);
const renderedPath = path.resolve(
  process.cwd(),
  argumentValue(
    "rendered",
    "output/visuals/map-approval-1672x941.png",
  ),
);
const diffPath = path.resolve(
  process.cwd(),
  argumentValue(
    "diff",
    "output/visuals/map-reference-diff.png",
  ),
);
const maxRatio = Number(argumentValue("max", "0.08"));

for (const inputPath of [referencePath, renderedPath]) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing visual comparison input: ${inputPath}`);
  }
}

const reference = PNG.sync.read(fs.readFileSync(referencePath));
const rendered = PNG.sync.read(fs.readFileSync(renderedPath));

if (reference.width !== rendered.width || reference.height !== rendered.height) {
  throw new Error(
    `Dimension mismatch: reference ${reference.width}x${reference.height}, rendered ${rendered.width}x${rendered.height}`,
  );
}

const diff = new PNG({ width: reference.width, height: reference.height });
const changedPixels = pixelmatch(
  reference.data,
  rendered.data,
  diff.data,
  reference.width,
  reference.height,
  { threshold: 0.1, includeAA: false, alpha: 0.55 },
);
const changedRatio = changedPixels / (reference.width * reference.height);

fs.mkdirSync(path.dirname(diffPath), { recursive: true });
fs.writeFileSync(diffPath, PNG.sync.write(diff));

console.log(
  JSON.stringify(
    {
      reference: referencePath,
      rendered: renderedPath,
      diff: diffPath,
      dimensions: `${reference.width}x${reference.height}`,
      changedPixels,
      changedRatio: Number(changedRatio.toFixed(6)),
      maxRatio,
      pass: changedRatio <= maxRatio,
    },
    null,
    2,
  ),
);

if (changedRatio > maxRatio) process.exitCode = 1;
