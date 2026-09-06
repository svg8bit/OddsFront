import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  throw new Error("Usage: npm run task:start -- short-task-name (lowercase letters, digits and hyphens).");
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const remote = git("remote", "get-url", "origin");
if (!/github\.com[:/]svg8bit\/OddsFront(?:\.git)?$/.test(remote)) {
  throw new Error("This task helper is restricted to svg8bit/OddsFront.");
}
const common = path.resolve(git("rev-parse", "--git-common-dir"));
const root = path.dirname(common);
const worktrees = `${root}-worktrees`;
const target = path.join(worktrees, slug);
const branch = `codex/${slug}`;
git("fetch", "origin", "main");
mkdirSync(worktrees, { recursive: true });
git("worktree", "add", "-b", branch, target, "origin/main");
const localPolicy = path.join(root, "AGENTS.md");
if (existsSync(localPolicy)) copyFileSync(localPolicy, path.join(target, "AGENTS.md"));
process.stdout.write(`${JSON.stringify({ branch, worktree: target, base: "origin/main" }, null, 2)}\n`);
