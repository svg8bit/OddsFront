import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildIndexNowPlan,
  indexNowBatches,
  isIndexNowSnapshot,
} from "../../lib/news/indexnow.ts";

const host = "oddsfront.com";
const origin = `https://${host}`;
const key = "03913c8474b65893aebfb67df212e25ed48c4ef85b4cf98297f3185ae23defd1";
const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const stateFile = path.join(directory, "indexnow-state.json");
const full = process.argv.includes("--full");
const dryRun = process.argv.includes("--dry-run");

async function readSnapshot() {
  try {
    const snapshot = JSON.parse(await readFile(stateFile, "utf8"));
    return isIndexNowSnapshot(snapshot) ? snapshot : null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    console.warn(JSON.stringify({ service: "IndexNow", status: "state-invalid", recovery: "full-snapshot" }));
    return null;
  }
}

async function writeSnapshot(snapshot) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  await rename(temporary, stateFile);
}

try {
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8"));
  const previous = full ? null : await readSnapshot();
  const plan = buildIndexNowPlan(catalog, previous, full);
  const batches = indexNowBatches(plan.urls);
  if (dryRun) {
    console.log(JSON.stringify({ service: "IndexNow", dryRun: true, submitted: plan.urls.length, batches: batches.length, changedArticles: plan.changedArticles }));
  } else if (batches.length === 0) {
    console.log(JSON.stringify({ service: "IndexNow", submitted: 0, batches: 0, changedArticles: 0, accepted: true, status: "unchanged" }));
  } else {
    const statuses = [];
    for (const urlList of batches) {
      const response = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "OddsFrontIndexNow/2.0" },
        body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
        signal: AbortSignal.timeout(15_000),
      });
      statuses.push(response.status);
      if (response.status !== 200 && response.status !== 202) throw new Error(`IndexNow rejected a batch with HTTP ${response.status}`);
    }
    await writeSnapshot(plan.snapshot);
    console.log(JSON.stringify({ service: "IndexNow", statuses, submitted: plan.urls.length, batches: batches.length, changedArticles: plan.changedArticles, accepted: true }));
  }
} catch (error) {
  console.error(JSON.stringify({ service: "IndexNow", accepted: false, error: error instanceof Error ? error.message : "Unknown error" }));
  process.exitCode = 1;
}
