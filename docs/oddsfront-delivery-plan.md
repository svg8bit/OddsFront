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
- [ ] Run an isolated five-hour publishing cycle with deduplication and editorial evidence checks.
- [x] Store news at runtime without commits or redeploys per article.
- [ ] Publish and verify the initial real-news batch.

## Languages

- [x] Add English, Chinese, Korean, Vietnamese, German, Spanish, Brazilian Portuguese,
      French, Russian, Ukrainian, Persian and Hebrew to the site and articles.
- [x] Automatically select supported browser language and region; fall back to English.
- [x] Persist manual language/region selection.
- [x] Support RTL for Persian and Hebrew.
- [x] Translate interface strings locally; provide article translation without paid APIs.
- [x] Keep translation work outside the map loading and rendering path.

## Release acceptance

- [x] Validate content, language negotiation, fresh-odds behavior and publisher failure recovery.
- [x] Run lint, typecheck, build and the required project test suite.
- [x] Inspect desktop/mobile and RTL article views, empty/error states and source links.
      The expanded suite passes 54 tests; map language preview QA is recorded separately.
- [ ] Merge reviewed code to main, verify the dedicated Vercel deployment and production routes.
- [ ] Record exact commits, deployment IDs, service status and remaining factual limitations.
