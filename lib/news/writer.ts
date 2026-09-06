// Process isolation and subscription runner ported from ColdMath News.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
export type CodexWriterInvocation = { command: string; args: string[]; env: Record<string, string | undefined> };
export type CodexProcessRunner = (input: { invocation: CodexWriterInvocation; prompt: string; cwd: string; timeoutMs: number }) => Promise<void>;
const PAID_API_ENV_KEYS = new Set(["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT_ID"]);
export function createCodexWriterInvocation(input: {
  schemaPath: string;
  outputPath: string;
  model?: string;
  env: Record<string, string | undefined>;
}): CodexWriterInvocation {
  const env = Object.fromEntries(
    Object.entries(input.env).filter(([key, value]) => value !== undefined && !PAID_API_ENV_KEYS.has(key)),
  );
  const args = [
    "--search",
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.outputPath,
    "--color",
    "never",
  ];
  if (input.model) args.push("--model", input.model);
  args.push("-");
  return { command: "codex", args, env };
}

const runCodexProcess: CodexProcessRunner = async ({ invocation, prompt, cwd, timeoutMs }) => {
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" && invocation.command === "codex" ? "codex.cmd" : invocation.command;
    const child = spawn(command, invocation.args, {
      cwd,
      env: invocation.env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
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
      if (code === 0) resolve();
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
  timeoutMs?: number;
}, runProcess: CodexProcessRunner = runCodexProcess) {
  const workdir = await mkdtemp(path.join(tmpdir(), "oddsfront-news-"));
  const schemaPath = path.join(workdir, "article.schema.json");
  const outputPath = path.join(workdir, "article.json");
  try {
    await writeFile(schemaPath, JSON.stringify(input.schema), "utf8");
    const invocation = createCodexWriterInvocation({
      schemaPath,
      outputPath,
      model: input.model,
      env: input.env,
    });
    await runProcess({
      invocation,
      prompt: input.prompt,
      cwd: workdir,
      timeoutMs: input.timeoutMs || 240_000,
    });
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
