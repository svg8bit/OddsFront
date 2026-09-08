# OddsFront News operations

Research uses a complete compact exclusion index of published, staged and
cover-rejected stories, including their media URLs. Institutional background is
omitted from that index because it can legitimately support a different event.
The latest 24 validation rejections are retained privately between attempts.
After two consecutive rounds add no usable article, the same private edition
waits 30 minutes before further model calls. Publisher timer retries respect
this cooldown; the twenty-story and cover requirements remain unchanged.

Novelty checks compare canonical media URLs (ignoring tracking parameters),
word-normalized article and source headlines, and strongly overlapping leads.
Shared institutional background alone never identifies a duplicate. The full
private history has no age cutoff. Pending editions are rechecked on resume,
after research and immediately before export, including comparisons within the
new batch. Rejected candidates remain private and cannot reduce a published
batch below twenty. These deterministic checks make no additional model calls.

For a verified repeat, use `node scripts/news/withdraw-duplicate.ts ARTICLE_ID
ORIGINAL_ID` from the canonical checkout. The command takes the edition lock,
verifies the relationship, retains a private original-record receipt in
`withdrawals/`, and marks the duplicate in the private catalog. It removes the
public index entry and detail file. Both Node and Python exports and all three
social selectors honor the withdrawal. The private record continues to exclude
that story; historical edition and provider receipts are never rewritten.
Article and social-image lookups first require membership in the current public
catalog so a cached detail response cannot resurrect a withdrawn permalink.
Do not delete catalog history or reset publication timers to remove a duplicate.

Article URLs use exactly one language prefix, including English:
`/en/news/<slug>` and `/ru/news/<slug>`. Country codes remain article context,
not part of article URLs. Legacy country-based article routes redirect with
308; missing or withdrawn articles still return 404. Canonical metadata,
structured data, alternates, RSS, sitemaps, IndexNow and social publisher links
use the shared article URL helper.

The owner disabled automatic maintenance on 2026-09-08. Keep
`oddsfront-publishing-monitor.timer` disabled and the private dispatch
configuration `enabled: false`. Do not re-enable agent wakeups without a new
explicit request. The news and hourly social publication timers remain active.

## Runtime boundary

The UI runs in the dedicated OddsFront Vercel project. An isolated publisher on
this VPS writes original geopolitical articles to `/root/OddsFront/.local/news`.
Private receipts retain research evidence; the read-only public edition is
exported to `/opt/oddsfront-market-feed/news`. The existing sandboxed feed service
can read only that export, with its existing bearer authentication. Caddy adds
`/v1/news` and `/v1/news/articles/<slug>` on the existing feed host. No new port,
public write API, shared environment, or cross-product credential is used.
Vercel reads the edition with the existing OddsFront feed variables, revalidates
in 30 seconds, and retains the last successful live response during an outage. Browser
news refreshes retain the newer edition on failed or older responses. Article
publication requires neither a commit nor a deployment. `/news/archive`, country
routes, RSS and the sitemap derive from the same catalog.

## Editorial workflow

The reviewed migration source and checksums are in `news-migration-provenance.json`.
ColdMath's subscription process runner, evidence and duplicate gates, news-first
article structure, latest rail, country navigation and runtime publication
principles are adapted for geopolitics. ColdMath was read only. Its sports data,
trading UI, credentials, infrastructure and branded assets were not migrated.

Allowed news publishers: Reuters World, Axios World, Al Jazeera Middle East,
The Kyiv Independent, BBC World, The Guardian World, Euronews International,
Sky News World, Meduza and TV Rain. A publishable story needs a recent report
(maximum 72 hours), an independent institutional primary source, dated source
links, at least three source-backed facts and at least five substantive
paragraphs. Write original English reporting: news, verified context, remaining
uncertainty and what happens next. Market cards remain a separate live layer.
No invented quotes, claims, odds, promotional copy, duplicate story or full-text
republication is allowed. The supplied partner URLs do not themselves establish
full-text licensing, so ColdMath's licensed syndication mode is not enabled.
The overlap gate checks evidence notes, not every word of a paywalled source.
Research and publication gates reduce errors; they do not replace human review.

The two-hour cycle publishes exactly twenty verified new stories. Research runs
in small rounds of up to three so a slow writer cannot lose the entire edition.
Partial results persist privately in `pending-edition` and are topped up;
they never replace the public catalog. An incomplete cycle exits unsuccessfully
and the five-minute timer retries that pending edition. The two-hour interval
is measured from the last complete publication in `edition-state.json`.
Each round records coverage of all ten publishers, reviewed candidate counts
and rejection reasons. Missing source coverage or discovery
with no inspected candidates fails the job rather than reporting a healthy
empty edition. Source dates retain their actual precision: a verified calendar
date is valid when the publisher does not provide a time and timezone. The
writer must not invent those fields or reject reporting for missing clock time.
An invalid research response fails the job and retains published
content. Each edition writes a private receipt. The first article was manually
checked against The Kyiv Independent and the Ukrainian presidency before release.

The newest website edition supplies blue News cards throughout its two-hour
publication window. Up to sixteen verified stories whose headlines concern military
strikes, invasions or ceasefires are distributed once each across eight
fifteen-minute slots (at most two per slot). General reporting, court cases,
detentions, labour strikes, cyberattacks and background-only conflict tags
do not qualify. Slots without eligible news remain available to market alerts. A card expires at
the slot boundary; refreshes, language changes and reloads do not restart it.
Withdrawn, future-dated or stale stories are excluded. The published article
must retain an approved media source within 72 hours and an independent
approved official source. Sparse editions leave quiet slots rather than recycle
stories. This is ordinary published reporting, not a breaking-event assertion.

News cards link to the article in the selected language and show its country
flags. Market actions are optional: only a publisher-verified strike or
ceasefire with the same action, participants and direction as an active
Polymarket question with at least $1M market volume can add them. Forecasts,
proposals and country overlap cannot add unrelated market links. News cards
show no odds. Website publication and source-verification gates are unchanged.
Partner cover images are fetched from the source page's Open Graph metadata and
proxied through a fixed host and MIME allowlist. Source provenance stays in the
private receipt and structured data; cover UI contains no technical source label.
Sky News RSS enclosures are matched to the exact article URL when discovering
its photograph. Verified image URLs are saved with articles so subsequent RSS
rotation does not remove their covers. Publisher title/logo-only share cards
(including Meduza's `imgly` cards) use OddsFront artwork instead.
Every twenty-story edition must contain at least seventeen verified photographic covers,
with at most three OddsFront fallbacks. Excess stories without usable images
are retained as private rejections and replaced during the next research round.

## Writer and translation costs

The writer uses the existing Codex ChatGPT subscription through an ephemeral,
read-only research process. It consumes subscription usage. Paid API variables
are removed and there is no paid fallback. Publication occurs only in the local
validated runner; the research process has no publication credentials.

Russian social headlines, descriptions and candidate market questions receive
an automated translation review using the same isolated subscription editor.
Only missing texts are processed and cached, with source-number checks. Russian
exports first so the two-language Telegram edition can proceed; publication
waits for its reviewed text and localized social cover. Article body translation
is offline on this VPS using MIT-licensed `facebook/m2m100_418M`,
revision `55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`, converted to CPU int8.
There is no paid translation API, per-page translation call, or browser model.
The Google translation endpoint used by ColdMath rejects automated requests
from this host; it is not bypassed. Model and private caches are excluded from Git.
The separate Python environment is `/root/OddsFront/.local/translation-venv`;
the model is `/root/OddsFront/.local/translation-model`.

Pinned packages: ctranslate2 4.8.2, transformers 4.57.6, sentencepiece 0.2.1,
PyTorch 2.7.1+cpu. A model cache hit does not repeat inference. Translations are
marked as machine translations and link to English. Empty or over-budget text
is rejected; source numerals are preserved with an English segment fallback.
A failed market fetch retains the preceding translation dictionary. Live prices
remain numeric feed data and are never translated or generated.

Languages: en, zh, ko, vi, de, es, pt-BR, fr, ru, uk, fa and he. Browser locale
and region initialize preferences; unsupported languages use English. Manual
choices persist locally. Persian and Hebrew use RTL layout and lazy self-hosted
RTL map shaping. Country glyphs are precomputed and requested by Unicode range.

## Service operation

Tracked units: `ops/systemd/oddsfront-news.service` and `.timer`. The oneshot
timer checks every five minutes, with actual publication due every two hours,
using Nice 10, one CPU quota and a 3 GB memory limit. Translation and IndexNow
run only after a complete edition, never on an interval check. `edition.lock` uses OS flock for both
processes, preventing lost updates and releasing automatically after termination.
No lock-file deletion is required after a crash. The Codex CLI also needs its
shared `/root/.codex` runtime directory writable for its app-server SQLite state,
temporary aliases and subscription session refresh. Other product roots remain
inaccessible to the service; its research child uses a read-only sandbox.

```bash
systemctl status oddsfront-news.timer oddsfront-news.service
systemctl list-timers oddsfront-news.timer
journalctl -u oddsfront-news.service --since today --no-pager
systemctl start oddsfront-news.service
```

Manual commands from the canonical OddsFront root:

```bash
npm run news:publish
npm run news:translate
```

`ODDSFRONT_NEWS_DIRECTORY`, `ODDSFRONT_NEWS_PUBLIC_DIRECTORY` and
`ODDSFRONT_NEWS_BATCH_SIZE` configure isolated runs. A reviewed local
`ODDSFRONT_NEWS_DRAFT_FILE` is supported for editorial review and tests. Test
fixtures use a temporary directory and never enter the production export.

`node scripts/news/run-edition.mjs --force` is the explicit operator command
for an immediate complete edition. Telegram and X accept `--send --force` for
an explicitly requested immediate post; this bypasses only the interval, never
account, freshness, duplicate or pending-send checks. Normal timers omit it.

Public catalog and detail files are explicitly chmodded to `0644` before
atomic rename, including under the service's `UMask=0077`. Private staging,
state and evidence stay `0600`. Vercel caches only successful live catalog
results, retains the previous cache on refresh failure and returns 503 from
an uncached polling request during an outage, never a successful one-story
seed response. Seed data is used only when no runtime feed is configured.

## Verification and rollback

Run `npm run check` and `npm run test:e2e`. Tests cover publisher failure and
duplicate recovery, source restrictions, language negotiation, mobile and RTL
article layouts, persisted preferences, and stale news refreshes. Verify the
production map gestures, non-English glyphs, article market links, RSS,
favicon and the exact READY deployment commit. News must request no MapLibre
modules, workers, or vector tiles. Local machine translations need editorial
review for nuance; the English original remains available.

Before feed changes, back up its Python file, service units and Caddy config,
record checksums and verify the backup. The September 6 feed backup is under
`/root/OddsFront/.local/backups/news-feed-20260906T172517Z`.
To stop future editions, stop and disable only `oddsfront-news.timer` and stop
its oneshot service. Keep catalog and receipts intact. Restore the backed-up
feed code/config if required, validate Caddy, reload/restart the dedicated
OddsFront services, and confirm the original market endpoint and service health.
Vercel rollback is independent: restore the previous verified OddsFront main
commit/deployment. Never remove publication history to roll back application UI.

### Publisher discovery before editorial research

Public RSS from BBC, the Guardian, Euronews, Sky News, Meduza, Axios and
Al Jazeera supplies bounded current article leads before each editor round.
Feed requests have a six-second deadline, three concurrent requests and a
1.5 MB body limit. Cache raw discovery privately for ten minutes, but filter it
against the entire current published, withdrawn and staged history on every
round. Publisher rotation prevents one large feed monopolizing the prompt.
Reuse recent editor rejections from the pending edition's last twelve receipts:
exclude those exact URLs from the next discovery pool and give their reasons to
the editor. These temporary exclusions expire after two hours; published-story
exclusions remain permanent. Failed research must not silently restart with the
same previously rejected candidates.

RSS provides candidate URLs, publisher timestamps and possible photo links;
it does not replace reading the linked article or verifying primary evidence,
source-use limits, novelty and actual cover availability. The editor still
records coverage for all configured publishers, including outlets without RSS.
Available feed discovery avoids repeated category-page probing. Site coverage
includes the existing politics, energy, security, humanitarian and world-affairs
categories; a market match is unnecessary for an ordinary website article.
