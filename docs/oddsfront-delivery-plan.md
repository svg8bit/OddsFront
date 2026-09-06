# OddsFront delivery plan

The canonical production branch is `main`. Implementation stays in isolated
OddsFront task worktrees and reaches production through verified pull requests.

## Completed, retain and verify

- [x] Purple icon with two light strokes for favicons, app icons and share metadata.
- [x] Full logo variants and brandbook in `assets/brand/oddsfront`.
- [x] Preserve in-page DropsBot branding and existing menu buttons.
- [x] Stable wheel/pinch zoom and constant canvas density during movement.
- [x] Remove marker white centers; use bounded compositor pulses.
- [x] Refresh event data on entry/resume and retain good data after failed refreshes.
- [x] Protected main, required CI and project-scoped worktrees.

## Map release

- [x] Keep one popup mounted while selecting different points.
- [x] Open points without forced camera zoom or rebuilding marker data.
- [x] Keep markers and cards visible during map gestures.
- [x] Remove duplicate MapLibre shared-module delivery and extra WebGL initialization.
- [x] Run project checks and all 47 map browser tests; inspect desktop/mobile preview.
- [x] Verify production release, repeat browser smoke and compare mobile load measurements.
      PR #36, main `74b74ed`, READY `dpl_5mz77svU3JmGwKkoomXr7LJAvFCf`.
      Desktop/mobile production QA passed. Constrained mobile startup measured
      7.12 s before and 6.31 s after; software-rendered drag remains a performance limit.

## News migration

- [x] Inspect ColdMath news source, automation, editorial and runtime publishing rules.
- [x] Port news overview, article and archive principles into the OddsFront map visual system.
- [x] Add all-news and country sections, source citations, publication time, article metadata and RSS.
- [x] Configure Reuters World, Axios World, Al Jazeera Middle East, Kyiv Independent and BBC World.
- [x] Show related geopolitical events with fresh odds, market links and DropsBot tracking.
- [x] Run an isolated publishing cycle with deduplication and editorial evidence checks.
- [x] Store news at runtime without commits or redeploys per article.
- [x] Publish and verify the initial real-news batch.

## Languages

- [x] Add English, Chinese, Korean, Vietnamese, German, Spanish, Brazilian Portuguese,
      French, Russian, Ukrainian, Persian and Hebrew to the site and articles.
- [x] Automatically select supported browser language and region; fall back to English.
- [x] Persist manual language/region selection.
- [x] Support RTL for Persian and Hebrew.
- [x] Translate interface strings locally; provide article translation without paid APIs.
- [x] Keep translation work outside the map loading and rendering path.

## News alert and compact-layout follow-up

- [x] Gate 15-minute blue News alerts by confirmed strike/ceasefire semantics,
      exact participants and direction, and at least $1 million market volume.
- [x] Keep odds out of News alerts while retaining validated DropsBot and market actions.
- [x] Add Polymarket event images to map popups and news related-event cards only.
- [x] Unmount News/language controls while a popup is open and repair compact navigation.
- [x] Remove the public partner directory, add the OddsFront Telegram footer link,
      reduce news spacing and proxy credited partner covers with a safe fallback.
- [x] Schedule up to nine verified stories every two hours.
- [x] Pass project checks, 57-scenario browser QA and desktop/mobile performance runs.

## Release acceptance

- [x] Validate content, language negotiation, fresh-odds behavior and publisher failure recovery.
- [x] Run lint, typecheck, build and the required project test suite.
- [x] Inspect desktop/mobile and RTL article views, empty/error states and source links.
      The expanded suite passes 54 tests; map language preview QA is recorded separately.
- [x] Merge reviewed code to main, verify the dedicated Vercel deployment and production routes.
- [x] Record exact commits, deployment IDs, service status and remaining factual limitations.

## Release evidence

- UI/news release: PR #37, main `4c58884ee5223d987acddeeecd9ba6d76d694058`,
  READY `dpl_HLMNqnrRyLgrMf9LZLeC2kKKUYAi`, with `oddsfront.com` alias verified.
- CI `verify`: all 55 tests passed. CodeQL analysis passed.
- Desktop/mobile production news, article and zh/fa map checks: no browser errors;
  four related live markets; news pages did not request the map engine.
- Publisher timer is enabled. Its first successful systemd cycle finished at
  2026-09-06 17:49:54 UTC with exit status 0, preserving the verified edition
  when no additional stories met evidence requirements. All eleven translation
  caches were refreshed. Publication is intentionally quality-gated, not a quota.
- Initial real article is available in English and eleven translated editions;
  RSS, sitemap, public news API and authenticated source export were verified.
- Shared Codex runtime write access is required by the subscription app-server;
  other product roots remain inaccessible in the publishing unit.
- Constrained software-renderer benchmark remains a limitation: roughly 6.68 s
  to interactive map, 24.8 fps drag and 18.2 fps zoom at 4x CPU/slow 4G. These
  figures are not a promise of 60 fps on every device.
