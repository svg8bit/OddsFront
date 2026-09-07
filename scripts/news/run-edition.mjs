import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
await mkdir(directory, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_EDITION_LOCKED) {
  const run = spawnSync("flock", ["-w", "300", path.join(directory, "edition.lock"), process.execPath, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_EDITION_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}
const catalog = async () => JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8"));
const previous = new Set((await catalog()).articles.map(article => article.id));
const startedAt = new Date().toISOString();
const rounds = [];
let published = [];
// Top up the same edition after partial research; all normal evidence and duplicate gates remain active.
for (let attempt = 1; attempt <= 4 && published.length < 9; attempt++) {
  const run = spawnSync(process.execPath, ["scripts/news/publish.ts"], { stdio: "inherit", env: { ...process.env, ODDSFRONT_NEWS_BATCH_SIZE: String(9 - published.length) }, timeout: 11 * 60_000 });
  published = (await catalog()).articles.filter(article => !previous.has(article.id));
  rounds.push({ attempt, exitCode: run.status, published: published.length });
}
const receipt = { startedAt, finishedAt: new Date().toISOString(), requested: 9, published: published.map(article => article.slug), rounds, status: published.length === 9 ? "complete" : published.length ? "partial" : "empty" };
await mkdir(path.join(directory, "editions"), { recursive: true, mode: 0o700 });
const target = path.join(directory, "editions", `${startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(`${target}.tmp`, JSON.stringify(receipt, null, 2), { mode: 0o600 });
await rename(`${target}.tmp`, target);
console.log(JSON.stringify(receipt));
if (!published.length && rounds.every(round => round.exitCode !== 0)) process.exitCode = 1;
