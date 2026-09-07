import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { queuedRepairMessageId, repairAgentMessage, shouldRunRepairAgent, THREAD_ID_PATTERN } from "../../lib/news/repair-agent.ts";
import { PUBLICATION_JOBS } from "../../lib/news/supervision.ts";

const root = "/root/OddsFront";
const output = path.join(root, ".local/news/monitor/agent");
await mkdir(output, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_REPAIR_AGENT_LOCKED) {
  const result = spawnSync("flock", ["-n", path.join(output, "agent.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_REPAIR_AGENT_LOCKED: "1" } });
  process.exit(result.status ?? 1);
}
async function read(file: string) { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; } }
async function atomic(file: string, data: unknown) { const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); await rename(temp, file); }

const configFile = path.join(root, ".local/news/monitor/dispatch.json");
const config = await read(configFile);
if (config.enabled !== true) { console.log(JSON.stringify({ status: "disabled" })); process.exit(0); }
const permissions = await stat(configFile);
if (typeof config.threadId !== "string" || !THREAD_ID_PATTERN.test(config.threadId) || permissions.uid !== 0 || (permissions.mode & 0o077) !== 0) {
  throw new Error("A private, root-owned OddsFront dispatch configuration with a valid task ID is required.");
}
const health = await read(path.join(root, ".local/news/monitor/latest.json"));
const monitor = await read(path.join(root, ".local/news/monitor/state.json"));
const stateFile = path.join(output, "state.json");
const state = await read(stateFile);
const healthAge = Date.now() - Date.parse(health.checkedAt ?? "");
const freshHealth = healthAge >= 0 && healthAge < 10 * 60_000;
const incidents = (Array.isArray(health.incidents) ? health.incidents : []).filter((item: { job?: string } | null) => item && typeof item.job === "string" && Object.hasOwn(PUBLICATION_JOBS, item.job));
const due = freshHealth && shouldRunRepairAgent({ incidents, failures: monitor.failures ?? {}, running: false, lastStartedAt: state.lastStartedAt });
const checkOnly = process.argv.includes("--check");
if (checkOnly || !due) { console.log(JSON.stringify({ status: checkOnly ? "check" : "not-due", due, freshHealth, configured: true })); process.exit(0); }

const startedAt = Date.now();
const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
await atomic(stateFile, { lastStartedAt: startedAt, status: "dispatching" });
// The existing task retains its user authorization and history. This process
// only queues an incident; queue acceptance does not prove a completed repair.
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(["PATH", "USER", "LOGNAME"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) };
const result = spawnSync("codex", ["queue", "--thread", config.threadId, "--message", repairAgentMessage(incidents.map((item: { job: string }) => item.job))], { cwd: root, env, encoding: "utf8", timeout: 45_000, maxBuffer: 16_384 });
const messageId = result.status === 0 ? queuedRepairMessageId(result.stdout, config.threadId) : null;
const receipt = { startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), status: messageId ? "queued" : "dispatch-unconfirmed", exitCode: result.status, threadId: config.threadId, messageId };
await atomic(path.join(output, `${stamp}-receipt.json`), receipt);
// Keep the cooldown after an unconfirmed response as well: the server may have
// accepted it before a connection timeout. Never create an incident storm.
await atomic(stateFile, { lastStartedAt: startedAt, ...receipt });
if (/^https:\/\/github\.com\/svg8bit\/OddsFront\/issues\/\d+$/.test(monitor.issueUrl ?? "")) {
  const body = path.join(output, "notification.md");
  await writeFile(body, messageId
    ? "The local Codex daemon accepted a maintenance notification for the existing authorized OddsFront task. This confirms queue delivery, not completed repair. The publication supervisor continues checking actual delivery timestamps independently.\n"
    : "The OddsFront maintenance notification did not receive a confirmed queue receipt. The private incident remains open; publication recovery has not been established.\n", { mode: 0o600 });
  spawnSync("gh", ["issue", "comment", monitor.issueUrl, "--repo", "svg8bit/OddsFront", "--body-file", body], { cwd: root, timeout: 20_000, stdio: "ignore" });
}
console.log(JSON.stringify(receipt));
process.exitCode = messageId ? 0 : 1;
