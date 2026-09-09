// Process isolation and subscription runner ported from ColdMath News.
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
export type CodexWriterInvocation = { command: string; args: string[]; env: Record<string, string | undefined> };
export type WriterPurpose = "research" | "translation" | "selection";
export type WriterUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };
export type CodexProcessRunner = (input: { invocation: CodexWriterInvocation; prompt: string; cwd: string; timeoutMs: number }) => Promise<WriterUsage | void>;
export class CodexUsageLimitError extends Error {}
const PAID_API_ENV_KEYS = new Set(["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT_ID"]);
export function createCodexWriterInvocation(input: {
  schemaPath: string;
  outputPath: string;
  model?: string;
  purpose?: WriterPurpose;
  env: Record<string, string | undefined>;
}): CodexWriterInvocation {
  const env = Object.fromEntries(
    Object.entries(input.env).filter(([key, value]) => value !== undefined && !PAID_API_ENV_KEYS.has(key)),
  );
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--model", input.model || "gpt-5.6-sol",
    "-c", `model_reasoning_effort="${input.purpose === "selection" ? "low" : "medium"}"`,
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
  if (!input.purpose || input.purpose === "research") args.unshift("--search");
  else args.push("-c", 'web_search="disabled"');
  args.push("-");
  return { command: "codex", args, env };
}

const runCodexProcess: CodexProcessRunner = async ({ invocation, prompt, cwd, timeoutMs }) => {
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
      else if (/you(?:'|’)ve hit your usage limit|usage limit reached/i.test(stderr)) reject(new CodexUsageLimitError("Codex subscription usage is unavailable; stop this research run and retain the staged edition."));
      else reject(new Error(`Codex subscription writer exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(prompt);
  });
};

export async function executeSubscriptionCodex(input: {
  prompt: string;
  schema: Record<string, unknown>;
  env: Record<string, string | undefined>;
  model?: string;
  purpose?: WriterPurpose;
  usageFile?: string;
  timeoutMs?: number;
}, runProcess: CodexProcessRunner = runCodexProcess) {
  const workdir = await mkdtemp(path.join(tmpdir(), "oddsfront-news-"));
  const schemaPath = path.join(workdir, "article.schema.json");
  const outputPath = path.join(workdir, "article.json");
  const startedAt = new Date().toISOString();
  try {
    await writeFile(schemaPath, JSON.stringify(input.schema), "utf8");
    const invocation = createCodexWriterInvocation({
      schemaPath,
      outputPath,
      model: input.model,
      purpose: input.purpose,
      env: input.env,
    });
    const usage = await runProcess({
      invocation,
      prompt: input.prompt,
      cwd: workdir,
      timeoutMs: input.timeoutMs || 240_000,
    });
    if (input.usageFile) await appendFile(input.usageFile, `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), purpose: input.purpose || "research", model: input.model || "gpt-5.6-sol", promptBytes: Buffer.byteLength(input.prompt), ...usage })}\n`, { mode: 0o600 }).catch(() => {
      console.warn("Writer usage logging unavailable; retaining the completed editorial result.");
    });
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
