# OddsFront website wire desk

`scripts/news/wire-desk.ts` restores publishing on `/news`: the hottest
geopolitical and US-political stories of the moment, rewritten as original
English articles with a Russian edition, published one by one as soon as they
are written. It replaces the paused edition publisher (`oddsfront-news.timer`,
ten-story editions researched with Claude's web tools, which most publishers
block). Only English and Russian are published; the other site languages fall
back to English cards.

## One run

1. **Leads.** About 30 public feeds (`lib/news/wire-desk/feeds.ts`): the hot
   desk's 15 plus BBC US, Guardian US, Euronews, CBS, ABC, Fox (full text in
   the feed), Axios and Politico (full text in the feed), Iran International,
   Al-Monitor, Ukrainska Pravda, and Google News searches for
   `site:apnews.com when:1h` / `site:reuters.com when:1h`. The wires block
   automated reads, so their headlines only mark a story as real and early.
   Headlines from the last 10 hours are clustered into stories
   (`lib/news/hot-desk/headlines.ts`).
2. **Gate without a model call.** A story is new when it is on-topic (owner's
   topic lexicon), covered by two outlets or a wire, was not judged in the last
   three hours, and none of its links already fed an article. No new story → the
   run ends (`no-new-stories`) at no cost.
3. **Selection** (one Claude call, ~$0.04): the duty editor picks up to three
   stories in scope, merges clusters that report the same development in
   different words (`storyIds`), and proposes Polymarket searches. Scope is the
   owner's list (wars and escalation; Iran/Israel/Hormuz/oil and shipping;
   Russia–Ukraine–NATO; China–Taiwan; sanctions, tariffs; nuclear; coups and
   leaders' fates; big US politics; elections only in the US; never death-toll
   stories; never geoblocking). A pick needs two distinct outlets in total, or a
   wire.
4. **Source text.** For each pick the server fetches up to three full texts,
   one per outlet, from the allowlisted free outlets only (`FETCHABLE_HOSTS`:
   BBC, Guardian, Al Jazeera, NPR, DW, Kyiv Independent, CNBC, Fox, CBS, ABC,
   Euronews, Iran International, Al-Monitor, Ukrainska Pravda, Meduza), or
   takes the full text a feed carries. Paywalled and automation-refusing
   outlets (NYT, WSJ, FT, Bloomberg, WaPo, Reuters, AP, France 24, The Hill,
   Sky, Politico/Axios pages, Times of Israel) are never requested. robots.txt
   is honoured for our user agent (`OddsFrontNewsDesk/1.0`), tracking
   parameters are removed first, pages marked `isAccessibleForFree: false` are
   skipped, responses are bounded (3 MB HTML, 8,000 characters of text). No
   readable text → the story is dropped without a model call.
5. **Writing** (one Claude call per story, ~$0.07): an original English article
   (450–620 words, attributed to the outlets by name, subheadings, "what
   happens next") and a Russian edition written in the same answer. The model
   first lists the key facts in its own words and writes from that list. When
   a live Polymarket market (Gamma search on the editor's queries) asks about
   exactly this development, one paragraph cites its Yes chance in percent,
   optionally against the level a day or a week earlier — never in points. The
   answer is tagged plain text, not JSON: long two-language copy full of
   quotation marks regularly broke the structured-output JSON and made the CLI
   regenerate the answer 3–6 times.
6. **Gates** (`lib/news/wire-desk/checks.ts`, `article.ts`), all deterministic:
   - originality: share of the article's 8-word sequences found in a source
     (outside quotation marks) at most 5%, and no copied run of 20 words;
   - every number in the English and Russian text must occur in a source or in
     the market data (plain dates, years and counts up to ten excepted);
   - headline and description: no killing/death/casualty wording (EN and RU),
     no non-US election framing; no geoblocking topic, no promotional language,
     no "pp"/points;
   - structure: lengths, 5+ full paragraphs, Russian really in Russian with
     the same paragraphs, at least three facts citing supplied source ids,
     a valid market id, ISO country codes, a category topic first;
   - novelty against the whole catalog (`findDuplicateStory`).
   A failed draft gets one rewrite with the exact problems listed (copied
   phrases, unsupported numbers…); a second failure drops the story for good.
7. **Cover.** OddsFront's own live map (`lib/news/hot-desk/map-card.ts`),
   framed on the cited market's marker, else the busiest marker in the story's
   main country, else that country; brightened, with a brand glow and rings on
   the location. No publisher photos, no text (the site and the social card draw
   the localized headline over it), no popup (a static cover would freeze its
   odds and mobile crops cut it). If the map cannot be captured the article is
   published with `cover.kind = "none"` and the site's own artwork.
8. **Publish, one article at a time.** The cover goes to
   `<public>/covers/<slug>.jpg`, the detail file to `<public>/articles/`, then
   the index `<public>/catalog.json` (all 0644, atomic). Nothing else in the
   articles directory is touched; the slug `market-translations-ru` (the Mini
   App's translation file) is reserved. With `--retire-seed` the bundled,
   week-old seed story is dropped once fresh reporting is live.
9. **Notify.** 35 s after the last export (warm site workers keep a catalog for
   30 s) the desk calls `POST https://oddsfront.com/api/news/revalidate` with the
   changed paths (`/news`, `/ru/news`, RSS, Google News sitemaps, sitemaps,
   topic and country pages), then IndexNow (English and Russian URLs only) and
   WebSub (English and Russian feeds).

Everything a run did is written to `<dir>/runs/<timestamp>.json`; drafts (with
their source texts) stay private in `<dir>/drafts/` for seven days, so a story
whose export failed is published from the cached draft without a new call.

## Site changes

- `app/(default)/api/news/revalidate/route.ts`: token-protected (`Authorization:
  Bearer $ODDSFRONT_NEWS_REVALIDATE_TOKEN`, at least 32 characters; without the
  variable the route answers 404). Accepts up to 80 allowlisted paths
  (`lib/news/revalidation.ts`) and calls `revalidatePath` for each; marking a
  path stale renders nothing until the next request.
- Article pages (`app/[locale]/news/[country]`) keep a 24-hour ISR window
  (was one hour): articles never change and carry no live data in their HTML.
  Localized country listings share that route; English and Russian ones are
  refreshed by the desk, other languages may lag by up to a day.
- Covers: `cover.kind` `"own"` is served by `/api/news-image/<slug>` and used by
  the social card from the feed's `/v1/news/articles/<slug>/cover.jpg`
  (`getOwnNewsCover`); `"none"` never falls back to a publisher photo. Own
  covers get a lighter card shade. The Russian edition written by the desk
  (`editorReviewed`) shows a plain "View original" link instead of the
  machine-translation note.
- Feed service (`ops/market-feed/oddsfront_market_feed.py`): new authenticated
  `GET /v1/news/articles/<slug>/cover.jpg` (JPEG only, at most 3 MB). The nginx
  vhost already proxies `/v1/news/articles/`.
- `lib/news/catalog.ts` is unchanged in its catalog read: still default-mode
  fetch with a bearer header, never `connection()` or `no-store`.

## Knobs (`/etc/oddsfront/wire-desk.env`, root-only)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ODDSFRONT_NEWS_REVALIDATE_TOKEN` | — | shared with Vercel; without it no on-demand refresh |
| `ODDSFRONT_WIRE_DESK_DAILY_ARTICLES` | 20 | articles per UTC day |
| `ODDSFRONT_WIRE_DESK_BURST` | 4 | articles allowed ahead of the even pace (cap × elapsed share of the day) |
| `ODDSFRONT_WIRE_DESK_PER_RUN` | 3 | articles per run |
| `ODDSFRONT_WIRE_DESK_DAILY_WRITER_CALLS` | 36 | writing calls per day, rewrites included |
| `ODDSFRONT_WIRE_DESK_DAILY_SELECTION_CALLS` | 48 | selection calls per day |
| `ODDSFRONT_WIRE_DESK_MIN_COVERAGE` | 2 | distinct outlets a story needs (a wire counts alone) |
| `ODDSFRONT_WIRE_DESK_MIN_PRIORITY` | 6 | editor priority bar (1–10) |
| `ODDSFRONT_WIRE_DESK_REEVALUATE_MINUTES` | 180 | ask again about an unchanged story after this |
| `ODDSFRONT_WIRE_DESK_WINDOW_HOURS` | 10 | headline age window |
| `ODDSFRONT_WIRE_DESK_MODEL` | sonnet | model for both calls |
| `ODDSFRONT_WIRE_DESK_DIRECTORY` | `.local/news/wire-desk` | private state, catalog, drafts, receipts |
| `ODDSFRONT_NEWS_PUBLIC_DIRECTORY` | `/opt/oddsfront-market-feed/news` | export (publish mode only) |
| `ODDSFRONT_SITE_URL` | `https://oddsfront.com` | revalidation target |

A usage-limit refusal backs off 6, 12, then 24 hours (`WriterUsageLimitError`),
like the other desks. Both calls run with a short task prompt instead of
Claude Code's own (about 800 instead of 7,000 input tokens), no tools, no
MCP servers, no settings, and thinking off (`MAX_THINKING_TOKENS=0`).

## Cost (measured 2026-10-25, Sonnet via `claude -p`, API-equivalent)

Final dry runs: selection $0.037–0.041 per call (~10 s); writing $0.051–0.082
per call (single turn, ~4,500 output tokens, ~31 s); 5 articles took 8 writing
calls (three needed one originality rewrite) and 3 selection calls: $0.66 in
total, $0.13 per published article. At 20 articles a day expect roughly
$2.2 of writing plus $1–1.8 of selection (only runs with a new on-topic
story call the editor), about $3–4 a day — roughly 0.35–0.45% of the weekly
subscription limit per day (1% ≈ $8.5 API-equivalent, measured 2026-10-20).
VPS: one Node process per run, a headless Chromium for covers (~20 s each),
no translation model.

## Commands

```bash
node scripts/news/wire-desk.ts --out=/tmp/wire-desk-test          # dry run: real feeds, real Claude, scratch catalog
node scripts/news/wire-desk.ts --out=/tmp/wire-desk-test --force  # ask the editor even without a new story
node scripts/news/wire-desk.ts --publish --retire-seed            # what the timer runs
npm run test:wire-desk
```

A dry run never writes the live catalog: it copies the live catalog once (read
only) into `<dir>/public` and publishes there; IndexNow, WebSub and the
revalidation call are skipped. To look at a scratch catalog in the site, serve
`<dir>/public` as a mock feed over HTTPS and start the site with
`ODDSFRONT_MARKET_FEED_URL` / `_TOKEN` pointing at it (see the mock-feed recipe
in the project notes).

## Going live

1. Merge, let Vercel deploy, and add `ODDSFRONT_NEWS_REVALIDATE_TOKEN`
   (≥ 32 random characters) to the Production environment.
2. Back up `/opt/oddsfront-market-feed/bin/oddsfront_market_feed.py`, install
   the new one from `ops/market-feed/`, restart `oddsfront-market-feed.service`,
   check `/healthz` and `/v1/news`.
3. Back up `/opt/oddsfront-market-feed/news`, update `/root/OddsFront` to the
   merged main, write `/etc/oddsfront/wire-desk.env` (0600) with the same token.
4. Copy `ops/systemd/oddsfront-wire-desk.{service,timer}` to
   `/etc/systemd/system/`, `systemctl daemon-reload`, run the service once by
   hand and read its receipt, then `systemctl enable --now oddsfront-wire-desk.timer`.
5. Keep `oddsfront-news.timer` and `oddsfront-news-translation.service`
   disabled: they write the same public catalog.

## Rollback

`systemctl disable --now oddsfront-wire-desk.timer`. Published articles stay;
to remove them restore the backed-up `/opt/oddsfront-market-feed/news` (the
desk's private copy is in `.local/news/wire-desk/catalog.json`). The site
changes are independent of the timer: with no new articles the pages simply
keep their content, and without the token the revalidation route answers 404.
