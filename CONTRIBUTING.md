# Contributing

Thanks for helping improve OddsFront.

## Before you start

- Use an issue for bugs or a focused proposal for larger product changes.
- Never include credentials, private feed URLs, user data, or production state.
- Keep the product read-only. Wallet signing, custody, and embedded trading are
  outside this repository's scope.
- Treat market data as untrusted input and preserve the validated outbound-link
  helpers.

## Local workflow

Start each substantive task in a dedicated branch and sibling worktree:

```bash
npm run task:start -- map-improvement
```

The command verifies the OddsFront remote, fetches `origin/main`, and prints the
new `codex/*` branch and worktree path. Existing worktrees and uncommitted work
are preserved. Open that printed path as the workspace for the Codex task.
For the current map work, see [the acceptance checklist](docs/map-performance-work-plan.md).

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`main` is the permanent production branch. Temporary `codex/*` branches exist
only to prepare a reviewable change. Required CI checks (`verify` and
`analyze (javascript-typescript)`) must pass before merging to `main`. The linked
Vercel project `oddsfront` deploys `main` automatically; verify its commit and
the canonical domain after the merge. See [the release runbook](docs/deployment.md).

## Pull requests

Keep each pull request focused and explain:

- what changed and why;
- which routes or data contracts are affected;
- how the change was tested;
- whether screenshots are relevant;
- any deployment, cache, security, or rollback considerations.

Generated output, browser traces, `.env*` files, and `node_modules/` must remain
untracked. A maintainer reviews and merges accepted changes.
