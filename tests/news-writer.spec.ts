import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCodexWriterInvocation, executeSubscriptionCodex } from "../lib/news/writer";

test("subscription research keeps search but cannot load host accounts or paid API credentials", () => {
  const invocation = createCodexWriterInvocation({ schemaPath: "schema.json", outputPath: "article.json", env: { PATH: "/usr/bin", OPENAI_API_KEY: "test-only-not-a-key", OPENAI_BASE_URL: "https://example.invalid" } });
  expect(invocation.env).toEqual({ PATH: "/usr/bin" });
  expect(invocation.args).toContain("--search");
  expect(invocation.args).toContain("read-only");
  expect(invocation.args).toContain("skip_host_skill_discovery");
  for (const feature of ["plugins", "apps", "multi_agent", "shell_tool"]) {
    expect(invocation.args[invocation.args.indexOf(feature) - 1]).toBe("--disable");
  }
  const translator = createCodexWriterInvocation({ schemaPath: "schema.json", outputPath: "article.json", purpose: "translation", env: {} });
  expect(translator.args).not.toContain("--search");
  expect(translator.args).toContain('web_search="disabled"');
});

test("writer records usage without article text or credentials and removes its temporary directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-writer-test-"));
  let temporary = "";
  try {
    const usageFile = join(directory, "usage.jsonl");
    const result = await executeSubscriptionCodex({ prompt: "private test input", schema: {}, env: {}, purpose: "translation", usageFile }, async ({ invocation, cwd }) => {
      temporary = cwd;
      await writeFile(invocation.args[invocation.args.indexOf("--output-last-message") + 1], '{"translation":"fixture"}');
      return { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20 };
    });
    expect(JSON.parse(result)).toEqual({ translation: "fixture" });
    const usage = JSON.parse(await readFile(usageFile, "utf8"));
    expect(usage).toMatchObject({ purpose: "translation", inputTokens: 100, cachedInputTokens: 30, outputTokens: 20 });
    expect(JSON.stringify(usage)).not.toContain("private test input");
    await expect(readFile(join(temporary, "article.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a quota refusal stops after one research invocation and preserves the staged edition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-quota-test-"));
  try {
    const bin = join(directory, "bin");
    const pending = join(directory, "pending-edition");
    await mkdir(bin); await mkdir(pending);
    await writeFile(join(bin, "codex"), `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"turn.failed",error:{message:"You've hit your usage limit."}}));process.exit(1);\n`, { mode: 0o700 });
    await writeFile(join(pending, "discovery-feeds.json"), JSON.stringify({ collectedAt: new Date().toISOString(), feeds: [], leads: [] }));
    const run = spawnSync(process.execPath, ["scripts/news/run-edition.mjs"], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ODDSFRONT_NEWS_DIRECTORY: directory, ODDSFRONT_NEWS_PUBLIC_DIRECTORY: join(directory, "public") } });
    expect(run.status, run.stderr).toBe(1);
    const receipt = JSON.parse(run.stderr.trim().split("\n").at(-1)!);
    expect(receipt.rounds).toEqual([{ attempt: 1, exitCode: 75, prepared: 0 }]);
    const state = JSON.parse(await readFile(join(pending, "edition.json"), "utf8"));
    expect(state.retryReason).toBe("subscription-usage-unavailable");
    expect(state.retryAfter).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(state.retryAfter).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    const retry = spawnSync(process.execPath, ["scripts/news/run-edition.mjs"], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ODDSFRONT_NEWS_DIRECTORY: directory } });
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toContain("research-cooldown");
    await expect(readFile(join(directory, "public/catalog.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
