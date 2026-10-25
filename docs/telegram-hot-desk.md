# OddsFront Telegram hot desk

`scripts/news/hot-desk.ts` posts the single hottest geopolitical or political
story of the moment to `@oddsfront` (English) and `@oddsfront_ru` (Russian),
paired with the live Polymarket market it moves. Each post is a branded card,
a short caption and two buttons, `✅ Yes · 23%` and `❌ No · 77%`, that open the
one-tap bet Mini App of `@OddsFrontBot` (the username comes from
`ODDSFRONT_MINI_APP_BOT_USERNAME` in `lib/telegram-app/init-data.ts`):
`https://t.me/OddsFrontBot?startapp=m<gamma market id>_<side>&mode=compact`
(side 0 = Yes, 1 = No). It is independent of the site edition pipeline and of
the older `scripts/news/telegram.ts` publisher, which stay as they are.

## One run

1. Headlines from public RSS feeds (BBC, Guardian, NYT World and Politics, Al
   Jazeera, NPR, France 24, DW, The Hill, Kyiv Independent, CNBC, Sky, Meduza,
   Google News World and US top stories) from the last eight hours. Only titles
   and summaries are read; no article page is fetched. Near-duplicate headlines
   form one story; the number of distinct outlets is the main hype signal.
2. Editor step A (Claude, no tools) picks up to three of the hottest stories,
   scores them 1–10 and proposes Polymarket search queries. Only scores of 8 or
   more continue. The owner's topic map (2026-10-25): wars and military
   escalation; US–Iran, Israel, Hormuz, oil and shipping; Russia–Ukraine–NATO;
   China–Taiwan; sanctions, tariffs and trade wars; nuclear; coups and leaders'
   fates; big US politics. Elections only for the United States (federal, at
   most major governor races). Death-toll stories, crime, local news,
   celebrities, sports and weather are out of scope.
3. Gamma search for those queries, the busiest politics, geopolitics and world
   markets, and the markets on the OddsFront map (`onMap`). A market qualifies
   when it is an open binary Yes/No market accepting orders, with at least $50k
   volume or $5k liquidity, a spread of at most 5¢, a chance between 1%
   and 99%, no deadline within six hours, and is not about an election outside
   the US. A market posted in the last 24 hours rests unless it moved 10% in a day.
4. Editor step B picks one story/market pair (confidence of at least 0.85),
   preferring a market on the map when relevance is equal, and writes both
   editions: headline, one or two sentences of context drawn only from the feed
   text, the Russian market question and the story's country codes. The code
   validates lengths, languages and that both ids are real candidates. No pair,
   no post.
5. The market is fetched again and the picture is rendered (1600×855, the
   owner's reference ratio): a live screenshot of oddsfront.com zoomed to the
   story with the chosen market's popup open (activity cards, zoom and News/
   language buttons hidden), under a dark left gradient with the OddsFront logo,
   the headline and the odds line ("Шанс «Да» 79% · ▼ 1,3% за сутки"). The map
   frames, in order: the market's own marker, its event's marker, the busiest
   marker in the story's countries, the story's country without a popup.
   Nothing on the map, or any map failure, falls back to the classic card
   (headline, market, Yes chance, 7-day chart); the picture never blocks a post.
   Moves are always shown in percent, never in points.

The displayed chance is Polymarket's own (midpoint, or the last trade on a wide
book); the buttons show what a one-tap buy costs (Yes at the best ask, No at one
minus the best bid).

## Modes

- `node scripts/news/hot-desk.ts` — dry run: writes `<stamp>-draft.json`,
  `<stamp>-en.png` and `<stamp>-ru.png` to `.local/news/hot-desk/` and prints a
  summary. Never touches the state file or Telegram.
- `--preview` — sends both editions to `ODDSFRONT_HOT_DESK_PREVIEW_CHAT` (the
  owner's DM). No state change.
- `--send` — publishes to both channels. Before sending it checks the bot
  identity and that the bot is a posting administrator of each channel. `--force`
  skips the interval, daily cap and unchanged-news checks (not a pending guard).

The bot token comes from `/root/OddsFront/.local/telegram.env` (mode `0600`):

```
ODDSFRONT_TELEGRAM_CREDENTIAL_ENV=/etc/oddsfront/bot.env
ODDSFRONT_TELEGRAM_CREDENTIAL_KEY=ODDSFRONT_TELEGRAM_BOT_TOKEN
ODDSFRONT_HOT_DESK_PREVIEW_CHAT=<owner chat id>
```

## Limits and knobs

State lives in `.local/news/hot-desk/state.json` behind a `flock`. Defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ODDSFRONT_HOT_DESK_MIN_INTERVAL_MINUTES` | 90 | minimum gap between posts |
| `ODDSFRONT_HOT_DESK_MAX_PER_DAY` | 8 | posts per UTC day |
| `ODDSFRONT_HOT_DESK_MARKET_REPEAT_HOURS` | 24 | rest period for a posted market |
| `ODDSFRONT_HOT_DESK_MARKET_REPEAT_MOVE_PP` | 10 | 24-hour move that lifts the rest period |
| `ODDSFRONT_HOT_DESK_STORY_MEMORY_HOURS` | 48 | a posted story is never repeated in this window |
| `ODDSFRONT_HOT_DESK_REEVALUATE_MINUTES` | 120 | re-ask the editor about an unchanged news cycle |
| `ODDSFRONT_HOT_DESK_MIN_HYPE` | 8 | minimum story score |
| `ODDSFRONT_HOT_DESK_MIN_CONFIDENCE` | 0.85 | minimum story/market relevance |
| `ODDSFRONT_HOT_DESK_WINDOW_HOURS` | 8 | headline age window |
| `ODDSFRONT_HOT_DESK_MODEL` | sonnet | Claude model for both editor steps |
| `ODDSFRONT_HOT_DESK_MAP_URL` | https://oddsfront.com/ | map page screenshotted for the picture |

To save subscription usage the editor is only called when the post is due and
the news cycle has a story of two or more outlets the editor has not judged in
the last two hours. Each editor step costs about $0.05–0.06 of Claude usage;
usage is logged to `.local/news/hot-desk/writer-usage.jsonl`.

An ambiguous Telegram outcome leaves `pending` in the state file and blocks the
next send. Check both channels, then remove `pending` (or record the post) by
hand. A definite rejection of one channel still records the other.

## Install and roll back

```
install -m 0644 ops/oddsfront-hot-desk.service ops/oddsfront-hot-desk.timer /etc/systemd/system/
systemctl daemon-reload
node scripts/news/hot-desk.ts --preview      # check the post in the DM first
systemctl enable --now oddsfront-hot-desk.timer
```

Roll back with `systemctl disable --now oddsfront-hot-desk.timer`; posts already
published stay. The units write only under `.local/news` and the Claude login.

## Preview watch (before the channel launch)

To let the owner see real posts as news breaks without publishing them, the timer can run in
preview mode with its own ledger (`.local/news/hot-desk/preview-state.json`): same interval, daily
cap and repeat rules as `--send`, each story previewed once in the owner's DM. Drop-in
`/etc/systemd/system/oddsfront-hot-desk.service.d/preview.conf`:

```
[Service]
ExecStart=
ExecStart=/usr/bin/env node scripts/news/hot-desk.ts --preview
Environment=ODDSFRONT_HOT_DESK_PREVIEW_WATCH=1
```

Channel launch: remove the drop-in, `systemctl daemon-reload`; the next run posts to both channels.
