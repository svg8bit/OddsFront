# OddsFront Telegram hot desk

`scripts/news/hot-desk.ts` posts the single hottest geopolitical or political
story of the moment to `@oddsfront` (English) and `@oddsfront_ru` (Russian),
paired with the live Polymarket market it moves. Each post is a branded card,
a short caption and two buttons, `✅ Yes · 23%` and `❌ No · 77%`, that open the
one-tap bet Mini App of `@DropsAnalyticsAIbot`:
`https://t.me/DropsAnalyticsAIbot?startapp=m<gamma market id>_<side>&mode=compact`
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
   more continue. Death-toll stories, crime, local news, celebrities, sports
   and weather are out of scope.
3. Gamma search for those queries plus the busiest politics, geopolitics and
   world markets. A market qualifies when it is an open binary Yes/No market
   accepting orders, with at least $50k volume or $5k liquidity, a spread of at
   most 5 points, a chance between 1% and 99%, and no deadline within six hours.
   A market posted in the last 24 hours rests unless it moved 10 points in a day.
4. Editor step B picks one story/market pair (confidence of at least 0.85) and
   writes both editions: headline, one or two sentences of context drawn only
   from the feed text, and the Russian market question. The code validates
   lengths, languages and that both ids are real candidates. No pair, no post.
5. The market is fetched again, the card (1280×720, Playwright) shows the
   headline, the market question with its artwork, the Yes chance, the 24-hour
   move (or a notable 7-day move) and a 7-day chart.

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
ODDSFRONT_TELEGRAM_CREDENTIAL_ENV=/etc/drops-analytics/bot.env
ODDSFRONT_TELEGRAM_CREDENTIAL_KEY=DROPS_ANALYTICS_TELEGRAM_BOT_TOKEN
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
