import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { shouldRunRepairAgent, repairAgentMessage, queuedRepairMessageId, REPAIR_AGENT_COOLDOWN_MS } from "../lib/news/repair-agent";

test("repair dispatch requires persistent failure, excludes concurrent runs and enforces the six-hour cooldown", () => {
  const now = Date.now();
  const input = { incidents: [{ job: "x", reason: "Publication is overdue." }], failures: { x: 3 }, running: false };
  expect(shouldRunRepairAgent({ ...input, incidents: [] }, now)).toBe(false);
  expect(shouldRunRepairAgent({ ...input, failures: { x: 2 } }, now)).toBe(false);
  expect(shouldRunRepairAgent({ ...input, running: true }, now)).toBe(false);
  expect(shouldRunRepairAgent({ ...input, lastStartedAt: now - REPAIR_AGENT_COOLDOWN_MS + 1 }, now)).toBe(false);
  expect(shouldRunRepairAgent({ ...input, lastStartedAt: now - REPAIR_AGENT_COOLDOWN_MS }, now)).toBe(true);
});

test("dispatch confirms only an exact queue receipt for the configured task", () => {
  const task = "00000000-0000-4000-8000-000000000001";
  const message = "00000000-0000-4000-8000-000000000002";
  expect(queuedRepairMessageId(`Queued message ${message} for thread ${task}.\n`, task)).toBe(message);
  expect(queuedRepairMessageId(`Queued message ${message} for thread ${message}.`, task)).toBeNull();
  expect(queuedRepairMessageId("OK", task)).toBeNull();
  expect(queuedRepairMessageId(`Queued message incomplete for thread ${task}.`, task)).toBeNull();
});

test("incident notification preserves delivery guards and can run under the VPS TypeScript runtime", () => {
  const prompt = repairAgentMessage(["x"]);
  expect(prompt).toContain("Never clear an ambiguous pending send");
  expect(prompt).toContain("Never weaken source verification");
  expect(prompt).toContain("without bypassing branch protections");
  expect(prompt).toContain("If publication recovered, do not change anything");
  const runtime = spawnSync(process.execPath, ["--input-type=module", "-e", 'import {shouldRunRepairAgent} from "./lib/news/repair-agent.ts"; if (shouldRunRepairAgent({incidents:[],failures:{},running:false})) process.exit(1);'], { encoding: "utf8" });
  expect(runtime.status, runtime.stderr).toBe(0);
});
