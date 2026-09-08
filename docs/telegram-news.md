# OddsFront Telegram news

Destinations: English `@oddsfront` (`-1004406802006`) and Russian
`@oddsfront_ru` (`-1004118165561`). The user explicitly authorized the existing
`@DropsAnalyticsAIbot` for both channels. Its identity, exact channel ID,
username and posting permission are checked before every send.

Configure the protected `/root/OddsFront/.local/telegram.env` (mode `0600`) with
`ODDSFRONT_TELEGRAM_BOT_TOKEN`, or a read-only credential reference using
`ODDSFRONT_TELEGRAM_CREDENTIAL_ENV` and `ODDSFRONT_TELEGRAM_CREDENTIAL_KEY`.
The current installation references only the named bot key in its existing
protected credential file, as explicitly requested by the user. It does not
import, duplicate or modify the source project's environment or runtime data.

`node scripts/news/telegram.ts` prepares a private draft.
`node scripts/news/telegram.ts --send` publishes it. The renderer takes the
headline and article URL from one published article; market title, current YES
odds, referral URL and DropsBot button all come from one fresh market
condition. The branded article preview is explicitly placed below the text.

`node scripts/news/telegram.ts --locale=ru --send` publishes to the Russian
channel. It reuses the article, editorial selection and exact market condition
from the English channel's successful receipt, then refreshes the current odds.
The title, market question, YES label and tracking button are Russian. The link
uses `/ru/news/...`; its public metadata and Russian social cover must be ready
before sending. There is no silent English fallback.

Russian headlines, descriptions and candidate market questions are translated
against the English source by the existing subscription editor, once per unique
text. This is an automated editorial translation, not a human review. The cache
is private in `russian-editor-cache.json`. Counts and dates must be preserved;
body paragraphs continue to use the labelled offline translator. Russian runs
first in the translation follow-up; other languages do not delay its export.
`ODDSFRONT_TRANSLATION_LANGUAGES=ru` limits a manual translation run to Russian.

Install `ops/oddsfront-telegram-ru.service` and `.timer`. Its independent ledger
and lock live in `.local/news/telegram-ru`. Initialize `state.json` with
`lastSentAt: 0`, `sentArticles: []` and `startAfterPublishedAt` equal to the
latest existing edition's publication timestamp to start with the next edition.
This activation boundary is not a claimed historical send. The Russian timer
checks every five minutes and has its own one-hour interval and pending-outcome
guard. Its preparation step retries missing Russian translations after a failed
follow-up, skipping a busy edition lock; it never reruns news research.
A delayed RU translation cannot resend EN or X. Every article is deduplicated
independently in each channel. The website publishes twenty articles every two
hours; EN Telegram, RU Telegram and X each publish one selected story per hour.
The next hourly slot can select another article from the same site edition.

Only stories published in the last six hours and market observations younger
than ten minutes are candidates. Up to twenty recent unsent articles form the selection pool, with a different country and topic from the previous post when possible. Two social slots can use different stories from the same site edition. Actual strikes, attacks,
invasions and ceasefires take priority; otherwise the editor chooses the best
general story. A market is attached only for a strong specific relationship,
with its real tracking link. A common country alone is insufficient. Without a
relevant market, a news-only post retains the article preview. Market prices are fetched
again after selection. The channel ledger prevents duplicate articles and more
than one post within one hour. An ambiguous send outcome remains pending and
requires reconciliation rather than risking a duplicate.

Install the service and timer from `ops/`. Install
`ops/oddsfront-news-editions.conf` as an `oddsfront-news.service` drop-in. The
news job tops up partial research in up to six validated rounds toward twenty
new stories; its completion can trigger the Telegram job. Telegram does not
wait for the news service's offline translation follow-up: the atomic public
edition and send ledger provide readiness and duplicate checks. The Telegram timer
also checks independently every five minutes; the persisted send time enforces
the one-hour publication interval even when the news job triggers an earlier
check. A skipped check never postpones the next due publication. Timers, receipts and all mutable
state remain OddsFront-specific. The bot's existing webhook is not changed.

Private evidence is under `.local/news/editions` and `.local/news/telegram`.
Before changing units, retain their existing files as a rollback. After a send,
check the returned channel/message IDs and the public Telegram post. For an
unknown send result, inspect the channel before clearing the pending ledger.

## X publication

`node scripts/news/x.ts` prepares the same editorial choice for `@alotofbit`.
`--send` publishes the newspaper emoji and unchanged English headline with an
attached OddsFront cover. The post text has no article URL. The publisher fetches
the article's versioned English social PNG, verifies its 1200 by 630 dimensions,
uploads it as `tweet_image`, and attaches the returned media ID. An unavailable
cover blocks the post. No odds or Telegram buttons are copied into the X text.

The private `/root/OddsFront/.local/x-auth/credentials.env` must contain the four
account-specific OAuth 1.0a keys: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
and `X_ACCESS_TOKEN_SECRET`, with mode `0600`.
Create the containing `x-auth` directory with mode `0700` and install the X
service's scoped write permission before enabling its timer. Verify the account with
`GET /2/users/me` before enabling `ops/oddsfront-x.timer`. Credentials for any
other account must never be substituted. The user authorized copying only the
`@alotofbit` connection from the second VPS into this isolated file.

X has its own lock, one-hour interval, article deduplication, pending-outcome
guard and receipts under `.local/news/x`. Every successful send verifies the
post's author ID, headline and attached photo, and rejects external links.
Both timers check every five minutes; they publish at most
once in a one-hour period and wait for fresh news. No external post is simulated.
