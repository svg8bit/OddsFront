# OddsFront map performance and freshness

- Production branch: `main` (all completed work is released here).
- Temporary verification branch: `codex/map-performance-20260906`
- Worktree: `/root/OddsFront-worktrees/map-performance-20260906`
- Repository: `svg8bit/OddsFront`
- Production: `https://oddsfront.com`

## Acceptance checklist

- [x] Create an isolated OddsFront task branch and worktree.
- [x] Open this branch's review in the current Codex task.
- [x] Verify protected `main`, required CI and dedicated production target.
- [x] Capture the current production load and interaction baseline.
- [x] Refresh data immediately on entry, tab resume, reconnect and browser restoration.
- [x] Prevent valid rolling alerts from expiring together after a successful refresh.
- [x] Preserve verified data through transient failures and reject older snapshots.
- [x] Reduce map startup dependencies and repeated drawing work.
- [x] Replace blurry beacons with crisp points and restrained compositor pulses.
- [x] Improve country labels and preserve legibility on high-density displays.
- [x] Verify regression tests, mobile/desktop rendering and performance changes.

## Release gate

Release completion is recorded by the merged GitHub pull request and the READY
Vercel deployment of its merge commit serving `oddsfront.com`. The PR records
the required CI checks and production verification; use the deployment runbook
for the rollback procedure.

## Local verification

- `npm run check`: map asset budgets, lint, TypeScript and production build pass.
- Browser regression suite covers entry and
  resume refresh, old/failed responses, renewed alert expiry, static first
  frame, gesture alignment, repeated zoom taps, reversed wheel input, two-finger
  mobile pinch, stable canvas density, reduced motion, the selected-beacon pulse
  cap and geographic detail on selection.
- Desktop 1440x900 and touch/mobile 390x844 (device pixel ratio 3): live map,
  focus refresh, zoom controls, no horizontal overflow or runtime errors.
- Six-second selected-marker idle comparison against `5872689`: main-thread
  task time decreased from 2844 ms to 30 ms on the same software-WebGL host.
- Cold CPU/network throttling remains substantially slower than normal browser
  QA. The static geographic backdrop and interactive readiness are separate
  measurements; the backdrop does not imply that events or input are ready.

## Gesture regression correction

- Removed per-gesture canvas resizing that blurred labels and interrupted zoom.
- Moved marker hit targets into the map's input container so a gesture starting
  on a marker receives wheel input and both fingers of a pinch.
- Restored MapLibre's standard wheel/trackpad sensitivity and accumulated rapid
  zoom-button taps from the pending camera target rather than stale React state.
- Removed the white pinpoint from event markers.
- Reduced mobile canvas density from 2 to a fixed 1.5, drawing 44% fewer pixels.
- Enabled server-emitted map chunk preloads without attempting WebGL on the server.
- Added `--device=mobile` to the performance benchmark for cold mobile comparisons.

## Working agreement

This task is OddsFront-scoped even if the app still displays the original host
workspace. Run all product commands with the worktree above as the explicit
working directory. Never operate on another product's Git root or deployment.

Use a short-lived `codex/*` branch for each subsequent substantive task. Keep
`main` synchronized with reviewed releases. Before a PR run `npm run check`,
`npm run test:e2e`, and compare the map benchmark when rendering changes. The
protected branch requires `verify` and `analyze (javascript-typescript)` checks.
Merge the reviewed PR, await the dedicated Vercel production deployment, verify
the canonical domain, and keep the previous deployment as the rollback target.

The Codex branch review is opened for this worktree. Reassigning an existing
task's underlying workspace is a separate app action; it must not be simulated
by rewriting the app's database or conversation files.
