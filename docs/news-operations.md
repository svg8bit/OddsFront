# OddsFront News operations

## Runtime boundary

The UI runs in the dedicated OddsFront Vercel project. An isolated publisher on
this VPS writes original geopolitical articles to `/root/OddsFront/.local/news`.
Private receipts retain research evidence; the read-only public edition is
exported to `/opt/oddsfront-market-feed/news`. The existing sandboxed feed service
can read only that export, with its existing bearer authentication. Caddy adds
`/v1/news` and `/v1/news/articles/<slug>` on the existing feed host. No new port,
public write API, shared environment, or cross-product credential is used.
Vercel reads the edition with the existing OddsFront feed variables, revalidates
in 60 seconds, and keeps the verified bundled edition during an outage. Browser
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
The Kyiv Independent and BBC World. A publishable story needs a recent report
(maximum 72 hours), an independent institutional primary source, dated source
links, at least three source-backed facts and at least five substantive
paragraphs. Write original English reporting: news, verified context, remaining
uncertainty and what happens next. Market cards remain a separate live layer.
No invented quotes, claims, odds, promotional copy, duplicate story or full-text
republication is allowed. The supplied partner URLs do not themselves establish
full-text licensing, so ColdMath's licensed syndication mode is not enabled.
The overlap gate checks evidence notes, not every word of a paywalled source.
Research and publication gates reduce errors; they do not replace human review.

The two-hour cycle requests up to nine stories across the configured sources.
Fewer stories, including zero, is a successful checked edition when evidence is
insufficient. An invalid research response fails the job and retains published
content. Each edition writes a private receipt. The first article was manually
checked against The Kyiv Independent and the Ukrainian presidency before release.

Fresh articles may also become blue map alerts for 15 minutes. The publisher
marks only a newly confirmed strike or a formally agreed/effective ceasefire in
a major global hotspot. The application then independently requires an active
Polymarket question with the same action and participants, the correct strike
direction, and at least $1 million in that market. Forecasts, proposals,
negotiations and loosely related markets fail closed. Both validated DropsBot
and market actions are required; News alerts show no odds.
Partner cover images are fetched from the source page's Open Graph metadata,
proxied through a fixed host and MIME allowlist, credited in the UI, and replaced
by the existing OddsFront art when unavailable.

## Writer and translation costs

The writer uses the existing Codex ChatGPT subscription through an ephemeral,
read-only research process. It consumes subscription usage. Paid API variables
are removed and there is no paid fallback. Publication occurs only in the local
validated runner; the research process has no publication credentials.

Translation is offline on this VPS using MIT-licensed `facebook/m2m100_418M`,
revision `55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636`, converted to CPU int8.
There is no paid translation API, per-request translation call, or browser model.
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
publisher runs every two hours with Nice 10, one CPU quota and a 3 GB memory
limit. Translation follows research. `edition.lock` uses OS flock for both
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

## Verification and rollback

Run `npm run check` and `npm run test:e2e`. Tests cover publisher failure and
duplicate recovery, source restrictions, language negotiation, mobile and RTL
article layouts, persisted preferences, and stale news refreshes. Verify the
production map gestures, non-English glyphs, article source/market links, RSS,
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
