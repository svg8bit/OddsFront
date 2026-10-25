// Process isolation and subscription runners ported from ColdMath News.
// Two backends share one contract: the Claude Code CLI (default since the
// owner's Codex subscription is exhausted) and the Codex CLI. Both use the
// owner's subscription login, never a paid API key, and both return the
// schema-conforming JSON that the callers read from the output path.
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
export type WriterBackend = "claude" | "codex";
export type WriterInvocation = { command: string; args: string[]; env: Record<string, string | undefined> };
export type CodexWriterInvocation = WriterInvocation;
export type WriterPurpose = "research" | "translation" | "selection" | "article";
export type WriterUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalCostUsd?: number; turns?: number };
export type WriterProcessRunner = (input: { invocation: WriterInvocation; prompt: string; cwd: string; timeoutMs: number; outputPath: string }) => Promise<WriterUsage | void>;
export type CodexProcessRunner = WriterProcessRunner;
export class WriterUsageLimitError extends Error {}
// run-edition.mjs keeps its 6/12/24 h back-off through this class, whichever backend refused.
export const CodexUsageLimitError = WriterUsageLimitError;
export type CodexUsageLimitError = WriterUsageLimitError;
const PAID_API_ENV_KEYS = new Set([
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT_ID",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
]);
export const NEWS_WRITER_MODEL = "gpt-5.6-luna";
export const CLAUDE_RESEARCH_MODEL = "sonnet";
export const CLAUDE_CHEAP_MODEL = "haiku";
const USAGE_LIMIT_LANGUAGE = /you(?:'|’)ve hit your usage limit|usage limit|rate[ _-]?limit|too many requests|quota|limit reached|out of (?:extra )?usage/i;

export function writerBackend(env: Record<string, string | undefined> = process.env): WriterBackend {
  const value = (env.ODDSFRONT_WRITER || "claude").trim().toLowerCase();
  if (value !== "claude" && value !== "codex") throw new Error(`ODDSFRONT_WRITER must be "claude" or "codex", received "${env.ODDSFRONT_WRITER}"`);
  return value;
}

function isResearch(purpose: WriterPurpose | undefined) {
  return !purpose || purpose === "research";
}

export function claudeWriterModel(purpose: WriterPurpose | undefined, env: Record<string, string | undefined> = process.env): string {
  return isResearch(purpose)
    ? env.ODDSFRONT_WRITER_MODEL || CLAUDE_RESEARCH_MODEL
    : env.ODDSFRONT_WRITER_CHEAP_MODEL || CLAUDE_CHEAP_MODEL;
}

function isolatedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !PAID_API_ENV_KEYS.has(entry[0])),
  );
}

function reasoningEffort(purpose: WriterPurpose | undefined) {
  return isResearch(purpose) ? "medium" : "low";
}
export function createCodexWriterInvocation(input: {
  schemaPath: string;
  outputPath: string;
  model?: string;
  purpose?: WriterPurpose;
  env: Record<string, string | undefined>;
}): WriterInvocation {
  const env = isolatedEnv(input.env);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--model", input.model || NEWS_WRITER_MODEL,
    "-c", `model_reasoning_effort="${reasoningEffort(input.purpose)}"`,
    // A news editor needs public search, not hundreds of host skills, account
    // connectors, shell tools or other agents. Do not change shared host config.
    "--enable", "skip_host_skill_discovery",
    ...["plugins", "apps", "memories", "multi_agent", "browser_use", "computer_use", "shell_tool", "unified_exec", "shell_snapshot", "image_generation"].flatMap(feature => ["--disable", feature]),
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.outputPath,
    "--color",
    "never",
    "--json",
  ];
  if (isResearch(input.purpose)) args.unshift("--search");
  else args.push("-c", 'web_search="disabled"');
  args.push("-");
  return { command: "codex", args, env };
}

export function createClaudeWriterInvocation(input: {
  /** null: plain-text answer (the caller parses it), no structured-output tool. */
  schema: Record<string, unknown> | null;
  model?: string;
  purpose?: WriterPurpose;
  env: Record<string, string | undefined>;
  /** Replaces Claude Code's own system prompt (about 7k tokens) with a short task prompt. */
  systemPrompt?: string;
  /** Turns extended thinking off (MAX_THINKING_TOKENS=0): faster and cheaper for writing from supplied text. */
  disableThinking?: boolean;
}): WriterInvocation {
  const env = isolatedEnv(input.env);
  // Callers pass a minimal environment without HOME; the CLI reads its
  // subscription login and state from $HOME/.claude.
  env.HOME ??= homedir();
  if (input.disableThinking) env.MAX_THINKING_TOKENS = "0";
  const research = isResearch(input.purpose);
  const args = [
    "-p",
    "--output-format", "json",
    ...(input.schema ? ["--json-schema", JSON.stringify(input.schema)] : []),
    "--model", input.model || claudeWriterModel(input.purpose),
    "--max-turns", research ? "80" : "6",
    // No MCP servers, no user settings, memory or CLAUDE.md, no session files:
    // a trivial call then costs about 7k input tokens instead of about 52k.
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--no-session-persistence",
  ];
  if (input.systemPrompt) args.push("--system-prompt", input.systemPrompt, "--disable-slash-commands");
  // Only research may read the public web; translation, selection and article
  // writing work from the prompt alone.
  if (research) args.push("--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch");
  else args.push("--tools", "");
  return { command: "claude", args, env };
}

export interface ClaudeCliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
  num_turns?: number;
  api_error_status?: number;
}

function parseJsonResult(stdout: string): ClaudeCliResult | null {
  const candidates = [stdout.trim(), ...stdout.trim().split("\n").reverse()];
  const first = stdout.indexOf("{"); const last = stdout.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(stdout.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as ClaudeCliResult;
    } catch { /* Try the next candidate. */ }
  }
  return null;
}

export function parseClaudeWriterResult(stdout: string, stderr = "", exitCode: number | null = 0, plainText = false): { output: unknown; usage: WriterUsage } {
  const result = parseJsonResult(stdout);
  const failed = !result || result.is_error === true || exitCode !== 0 || (typeof result.subtype === "string" && result.subtype !== "success");
  const text = `${typeof result?.result === "string" ? result.result : ""}\n${stderr}`;
  if (result?.api_error_status === 429 || (failed && USAGE_LIMIT_LANGUAGE.test(text))) {
    throw new WriterUsageLimitError("Claude subscription usage is unavailable; stop this research run and retain the staged edition.");
  }
  if (!result) throw new Error(`Claude writer returned no JSON result (exit ${exitCode}): ${stderr.trim().slice(-2000)}`);
  if (failed) {
    const detail = typeof result.result === "string" ? result.result.slice(0, 2000) : stderr.trim().slice(-2000);
    throw new Error(`Claude writer failed (${result.subtype || "error"}, exit ${exitCode}${result.api_error_status ? `, api ${result.api_error_status}` : ""}): ${detail}`);
  }
  if (plainText ? typeof result.result !== "string" || !result.result.trim() : result.structured_output === undefined || result.structured_output === null) throw new Error(`Claude writer returned no ${plainText ? "text" : "structured output"}`);
  const usage = result.usage ?? {};
  return {
    output: plainText ? result.result : result.structured_output,
    usage: {
      inputTokens: usage.input_tokens || 0,
      cachedInputTokens: (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
      outputTokens: usage.output_tokens || 0,
      totalCostUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : undefined,
      turns: typeof result.num_turns === "number" ? result.num_turns : undefined,
    },
  };
}

function spawnWriter(invocation: WriterInvocation, prompt: string, cwd: string, timeoutMs: number, label: string) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const command = process.platform === "win32" ? `${invocation.command}.cmd` : invocation.command;
    const child = spawn(command, invocation.args, { cwd, env: invocation.env as NodeJS.ProcessEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 20_000_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-6000); });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} subscription writer timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => { clearTimeout(timeout); resolve({ stdout, stderr, code }); });
    child.stdin.end(prompt);
  });
}

const runClaudeProcess: WriterProcessRunner = async ({ invocation, prompt, cwd, timeoutMs, outputPath }) => {
  const { stdout, stderr, code } = await spawnWriter(invocation, prompt, cwd, timeoutMs, "Claude");
  const plainText = !invocation.args.includes("--json-schema");
  const parsed = parseClaudeWriterResult(stdout, stderr, code, plainText);
  await writeFile(outputPath, plainText ? String(parsed.output) : JSON.stringify(parsed.output), "utf8");
  return parsed.usage;
};

const runCodexProcess: WriterProcessRunner = async ({ invocation, prompt, cwd, timeoutMs }) => {
  return await new Promise<WriterUsage>((resolve, reject) => {
    const command = process.platform === "win32" && invocation.command === "codex" ? "codex.cmd" : invocation.command;
    const child = spawn(command, invocation.args, {
      cwd,
      env: invocation.env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let output = "";
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      let end: number;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "turn.completed" && event.usage) {
            usage.inputTokens += event.usage.input_tokens || 0;
            usage.cachedInputTokens += event.usage.cached_input_tokens || 0;
            usage.outputTokens += event.usage.output_tokens || 0;
          }
          if (event.type === "error" || event.type === "turn.failed") stderr = `${stderr}\n${event.message || event.error?.message || ""}`.slice(-6000);
        } catch { /* Only structured usage and provider errors are retained. */ }
      }
      if (output.length > 2_000_000) output = "";
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex subscription writer timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-6000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(usage);
      else if (/you(?:'|’)ve hit your usage limit|usage limit reached/i.test(stderr)) reject(new WriterUsageLimitError("Codex subscription usage is unavailable; stop this research run and retain the staged edition."));
      else reject(new Error(`Codex subscription writer exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(prompt);
  });
};

export async function executeSubscriptionWriter(input: {
  prompt: string;
  /** null (Claude backend only): the answer is plain text, returned as is. */
  schema: Record<string, unknown> | null;
  env: Record<string, string | undefined>;
  model?: string;
  purpose?: WriterPurpose;
  usageFile?: string;
  timeoutMs?: number;
  /** Defaults to ODDSFRONT_WRITER ("claude" unless set to "codex"). */
  backend?: WriterBackend;
  /** Claude backend only: see createClaudeWriterInvocation. */
  systemPrompt?: string;
  disableThinking?: boolean;
}, runProcess?: WriterProcessRunner) {
  const backend = input.backend ?? writerBackend();
  const workdir = await mkdtemp(path.join(tmpdir(), "oddsfront-news-"));
  const schemaPath = path.join(workdir, "article.schema.json");
  const outputPath = path.join(workdir, "article.json");
  const startedAt = new Date().toISOString();
  const model = input.model || (backend === "claude" ? claudeWriterModel(input.purpose) : NEWS_WRITER_MODEL);
  try {
    await writeFile(schemaPath, JSON.stringify(input.schema), "utf8");
    const invocation = backend === "claude"
      ? createClaudeWriterInvocation({ schema: input.schema, model, purpose: input.purpose, env: input.env, systemPrompt: input.systemPrompt, disableThinking: input.disableThinking })
      : input.schema ? createCodexWriterInvocation({ schemaPath, outputPath, model, purpose: input.purpose, env: input.env }) : (() => { throw new Error("Plain-text answers need the Claude backend"); })();
    const run = runProcess ?? (backend === "claude" ? runClaudeProcess : runCodexProcess);
    const usage = await run({
      invocation,
      prompt: input.prompt,
      cwd: workdir,
      timeoutMs: input.timeoutMs || 240_000,
      outputPath,
    });
    if (input.usageFile) await appendFile(input.usageFile, `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), backend, purpose: input.purpose || "research", model, promptBytes: Buffer.byteLength(input.prompt), ...usage })}\n`, { mode: 0o600 }).catch(() => {
      console.warn("Writer usage logging unavailable; retaining the completed editorial result.");
    });
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

// Existing callers keep this name; the backend is selected by ODDSFRONT_WRITER.
export const executeSubscriptionCodex = executeSubscriptionWriter;
