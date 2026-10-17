import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CLAUDE_CHEAP_MODEL, CLAUDE_RESEARCH_MODEL, NEWS_WRITER_MODEL, WriterUsageLimitError, CodexUsageLimitError,
  claudeWriterModel, createClaudeWriterInvocation, createCodexWriterInvocation, executeSubscriptionCodex, executeSubscriptionWriter,
  parseClaudeWriterResult, writerBackend,
} from "../lib/news/writer";

// Stand-in for the Claude Code CLI: one JSON result on stdout, the mode chosen
// by a marker in the prompt so the invocation flags can be echoed back.
const FAKE_CLAUDE = `#!/usr/bin/env node
let input = "";
process.stdin.on("data", chunk => { input += chunk; }).on("end", () => {
  const args = process.argv.slice(2);
  const schema = args[args.indexOf("--json-schema") + 1];
  if (/QUOTA-FIXTURE/.test(input)) {
    console.log(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "You've hit your usage limit. Resets at 3pm.", api_error_status: 429, usage: { input_tokens: 12, output_tokens: 0 }, num_turns: 1 }));
    process.exit(1);
  }
  if (/MAXTURNS-FIXTURE/.test(input)) {
    console.log(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, usage: { input_tokens: 500, output_tokens: 50 }, num_turns: 6 }));
    process.exit(1);
  }
  console.error("fixture stderr noise");
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done",
    structured_output: { translation: "fixture", schemaBytes: schema.length, model: args[args.indexOf("--model") + 1], tools: args.slice(args.indexOf("--tools") + 1, args.indexOf("--tools") + 3).join(" "), cwd: process.cwd(), home: process.env.HOME || "" },
    usage: { input_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 40 }, total_cost_usd: 0.0123, num_turns: 2 }));
});
`;

test("subscription research keeps search but cannot load host accounts or paid API credentials", () => {
  const invocation = createCodexWriterInvocation({ schemaPath: "schema.json", outputPath: "article.json", env: { PATH: "/usr/bin", OPENAI_API_KEY: "test-only-not-a-key", OPENAI_BASE_URL: "https://example.invalid" } });
  expect(invocation.env).toEqual({ PATH: "/usr/bin" });
  expect(invocation.args).toContain("--search");
  expect(invocation.args).toContain("read-only");
  expect(invocation.args).toContain("skip_host_skill_discovery");
  expect(invocation.args[invocation.args.indexOf("--model") + 1]).toBe(NEWS_WRITER_MODEL);
  expect(invocation.args).toContain('model_reasoning_effort="medium"');
  for (const feature of ["plugins", "apps", "multi_agent", "shell_tool"]) {
    expect(invocation.args[invocation.args.indexOf(feature) - 1]).toBe("--disable");
  }
  const translator = createCodexWriterInvocation({ schemaPath: "schema.json", outputPath: "article.json", purpose: "translation", env: {} });
  expect(translator.args).not.toContain("--search");
  expect(translator.args).toContain('web_search="disabled"');
  expect(translator.args[translator.args.indexOf("--model") + 1]).toBe(NEWS_WRITER_MODEL);
  expect(translator.args).toContain('model_reasoning_effort="low"');
});

test("the Claude backend is the default and its invocation is isolated, schema-bound and web-only for research", () => {
  expect(writerBackend({})).toBe("claude");
  expect(writerBackend({ ODDSFRONT_WRITER: "codex" })).toBe("codex");
  expect(writerBackend({ ODDSFRONT_WRITER: " Claude " })).toBe("claude");
  expect(() => writerBackend({ ODDSFRONT_WRITER: "gpt" })).toThrow("ODDSFRONT_WRITER");
  expect(claudeWriterModel("research", {})).toBe(CLAUDE_RESEARCH_MODEL);
  expect(claudeWriterModel(undefined, {})).toBe("sonnet");
  expect(claudeWriterModel("translation", {})).toBe(CLAUDE_CHEAP_MODEL);
  expect(claudeWriterModel("selection", {})).toBe("haiku");
  expect(claudeWriterModel("research", { ODDSFRONT_WRITER_MODEL: "opus" })).toBe("opus");
  expect(claudeWriterModel("selection", { ODDSFRONT_WRITER_CHEAP_MODEL: "sonnet" })).toBe("sonnet");

  const schema = { type: "object", properties: { answer: { type: "string" } } };
  const research = createClaudeWriterInvocation({ schema, model: "sonnet", env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "test-only-not-a-key", OPENAI_API_KEY: "test-only-not-a-key" } });
  expect(research.command).toBe("claude");
  expect(research.env).toEqual({ PATH: "/usr/bin", HOME: homedir() });
  expect(research.args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
  expect(JSON.parse(research.args[research.args.indexOf("--json-schema") + 1])).toEqual(schema);
  expect(research.args[research.args.indexOf("--model") + 1]).toBe("sonnet");
  expect(research.args[research.args.indexOf("--max-turns") + 1]).toBe("80");
  expect(research.args).toContain("--strict-mcp-config");
  expect(research.args[research.args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
  expect(research.args[research.args.indexOf("--setting-sources") + 1]).toBe("");
  expect(research.args).toContain("--no-session-persistence");
  expect(research.args.slice(research.args.indexOf("--tools"))).toEqual(["--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch"]);

  const translator = createClaudeWriterInvocation({ schema, purpose: "translation", env: { HOME: "/srv/home" } });
  expect(translator.env.HOME).toBe("/srv/home");
  expect(translator.args[translator.args.indexOf("--model") + 1]).toBe(CLAUDE_CHEAP_MODEL);
  expect(translator.args[translator.args.indexOf("--max-turns") + 1]).toBe("6");
  expect(translator.args.slice(translator.args.indexOf("--tools"))).toEqual(["--tools", ""]);
  expect(translator.args).not.toContain("WebSearch");
});

test("Claude results map usage, surface max-turn failures and classify limits as the shared usage-limit error", () => {
  const success = parseClaudeWriterResult(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { ok: true }, usage: { input_tokens: 7000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2500, output_tokens: 300 }, total_cost_usd: 0.05, num_turns: 9 }), "warning noise", 0);
  expect(success).toEqual({ output: { ok: true }, usage: { inputTokens: 7000, cachedInputTokens: 3500, outputTokens: 300, totalCostUsd: 0.05, turns: 9 } });
  expect(() => parseClaudeWriterResult(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 80 }), "", 1)).toThrow(/error_max_turns/);
  expect(() => parseClaudeWriterResult(JSON.stringify({ type: "result", subtype: "success", is_error: false }), "", 0)).toThrow(/no structured output/);
  expect(() => parseClaudeWriterResult("", "command not found", 127)).toThrow(/no JSON result/);
  for (const [stdout, stderr, code] of [
    [JSON.stringify({ type: "result", subtype: "error", is_error: true, api_error_status: 429, result: "rate limited" }), "", 1],
    [JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "You've hit your usage limit. Resets at 3pm." }), "", 1],
    ["", "Error: Usage limit reached for this subscription", 1],
  ] as const) {
    expect(() => parseClaudeWriterResult(stdout, stderr, code)).toThrow(WriterUsageLimitError);
  }
  // A successful research result may legitimately mention quotas in its text.
  expect(() => parseClaudeWriterResult(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "fishing quota talks", structured_output: {} }), "", 0)).not.toThrow();
  expect(CodexUsageLimitError).toBe(WriterUsageLimitError);
});

test("the Claude backend writes the structured output for callers and records usage without article text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-claude-writer-test-"));
  try {
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "claude"), FAKE_CLAUDE, { mode: 0o700 });
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME };
    const usageFile = join(directory, "usage.jsonl");
    const result = JSON.parse(await executeSubscriptionWriter({ prompt: "private research input", schema: { type: "object" }, env, usageFile, backend: "claude" }));
    expect(result).toMatchObject({ translation: "fixture", model: "sonnet", tools: "WebSearch WebFetch", home: process.env.HOME });
    expect(result.cwd).toContain("oddsfront-news-");
    expect(result.schemaBytes).toBe(JSON.stringify({ type: "object" }).length);
    const usage = JSON.parse(await readFile(usageFile, "utf8"));
    expect(usage).toMatchObject({ backend: "claude", purpose: "research", model: "sonnet", inputTokens: 1000, cachedInputTokens: 500, outputTokens: 40, totalCostUsd: 0.0123, turns: 2 });
    expect(JSON.stringify(usage)).not.toContain("private research input");
    await expect(readFile(join(result.cwd, "article.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const selection = JSON.parse(await executeSubscriptionWriter({ prompt: "pick one", schema: {}, env, purpose: "selection", backend: "claude" }));
    expect(selection).toMatchObject({ model: "haiku", tools: "" });
    await expect(executeSubscriptionWriter({ prompt: "MAXTURNS-FIXTURE", schema: {}, env, backend: "claude" })).rejects.toThrow(/error_max_turns/);
    await expect(executeSubscriptionWriter({ prompt: "QUOTA-FIXTURE", schema: {}, env, backend: "claude" })).rejects.toThrow(WriterUsageLimitError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("writer records usage without article text or credentials and removes its temporary directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oddsfront-writer-test-"));
  let temporary = "";
  try {
    const usageFile = join(directory, "usage.jsonl");
    const result = await executeSubscriptionCodex({ prompt: "private test input", schema: {}, env: {}, purpose: "translation", usageFile, backend: "codex" }, async ({ invocation, cwd }) => {
      temporary = cwd;
      await writeFile(invocation.args[invocation.args.indexOf("--output-last-message") + 1], '{"translation":"fixture"}');
      return { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20 };
    });
    expect(JSON.parse(result)).toEqual({ translation: "fixture" });
    const usage = JSON.parse(await readFile(usageFile, "utf8"));
    expect(usage).toMatchObject({ backend: "codex", purpose: "translation", model: NEWS_WRITER_MODEL, inputTokens: 100, cachedInputTokens: 30, outputTokens: 20 });
    expect(JSON.stringify(usage)).not.toContain("private test input");
    await expect(readFile(join(temporary, "article.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function quotaRefusalKeepsTheStagedEdition(backend: "claude" | "codex", script: string) {
  const directory = await mkdtemp(join(tmpdir(), `oddsfront-quota-${backend}-test-`));
  try {
    const bin = join(directory, "bin");
    const pending = join(directory, "pending-edition");
    await mkdir(bin); await mkdir(pending);
    await writeFile(join(bin, backend), script, { mode: 0o700 });
    await writeFile(join(pending, "discovery-feeds.json"), JSON.stringify({ collectedAt: new Date().toISOString(), feeds: [], leads: [] }));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ODDSFRONT_WRITER: backend, ODDSFRONT_NEWS_DIRECTORY: directory, ODDSFRONT_NEWS_PUBLIC_DIRECTORY: join(directory, "public") };
    const run = spawnSync(process.execPath, ["scripts/news/run-edition.mjs"], { encoding: "utf8", timeout: 30_000, env });
    expect(run.status, run.stderr).toBe(1);
    const receipt = JSON.parse(run.stderr.trim().split("\n").at(-1)!);
    expect(receipt.rounds).toEqual([{ attempt: 1, exitCode: 75, prepared: 0 }]);
    const state = JSON.parse(await readFile(join(pending, "edition.json"), "utf8"));
    expect(state.retryReason).toBe("subscription-usage-unavailable");
    expect(state.usageLimitFailures).toBe(1);
    expect(state.retryAfter).toBeGreaterThan(Date.now() + 5 * 60 * 60_000 + 59 * 60_000);
    expect(state.retryAfter).toBeLessThanOrEqual(Date.now() + 6 * 60 * 60_000);
    const retry = spawnSync(process.execPath, ["scripts/news/run-edition.mjs"], { encoding: "utf8", timeout: 30_000, env: { ...env, ODDSFRONT_NEWS_PUBLIC_DIRECTORY: undefined } });
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toContain("research-cooldown");
    await expect(readFile(join(directory, "public/catalog.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("a Codex quota refusal stops after one research invocation and preserves the staged edition", async () => {
  await quotaRefusalKeepsTheStagedEdition("codex", `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"turn.failed",error:{message:"You've hit your usage limit."}}));process.exit(1);\n`);
});

test("a Claude quota refusal stops after one research invocation and preserves the staged edition", async () => {
  await quotaRefusalKeepsTheStagedEdition("claude", `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>{console.log(JSON.stringify({type:"result",subtype:"error",is_error:true,result:"You've hit your usage limit.",api_error_status:429,num_turns:1}));process.exit(1);});\n`);
});
