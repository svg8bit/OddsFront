# OddsFront Telegram news

Destination: `@oddsfront`, channel ID `-1004406802006`. The user explicitly
authorized the existing `@DropsAnalyticsAIbot` for this channel. Its identity,
channel identity and posting permission are checked before every send.

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

Only stories published in the last three hours and market observations younger
than ten minutes are candidates. The latest nine fresh articles form the selection pool. Actual strikes, attacks,
invasions and ceasefires take priority; otherwise the editor chooses the best
general story. A market is attached only for a strong specific relationship,
with its real tracking link. A common country alone is insufficient. Without a
relevant market, a news-only post retains the article preview. Market prices are fetched
again after selection. The channel ledger prevents duplicate articles and more
than one post within two hours. An ambiguous send outcome remains pending and
requires reconciliation rather than risking a duplicate.

Install the service and timer from `ops/`. Install
`ops/oddsfront-news-editions.conf` as an `oddsfront-news.service` drop-in. The
news job tops up partial research in up to four validated rounds toward nine
new stories; its completion can trigger the Telegram job. The Telegram timer
also checks independently every five minutes; the persisted send time enforces
the two-hour publication interval even when the news job triggers an earlier
check. A skipped check never postpones the next due publication. Timers, receipts and all mutable
state remain OddsFront-specific. The bot's existing webhook is not changed.

Private evidence is under `.local/news/editions` and `.local/news/telegram`.
Before changing units, retain their existing files as a rollback. After a send,
check the returned channel/message IDs and the public Telegram post. For an
unknown send result, inspect the channel before clearing the pending ledger.

## X publication

`node scripts/news/x.ts` prepares the same editorial choice for `@alotofbit`.
`--send` publishes only the newspaper emoji, unchanged English headline and
canonical article URL; the article's large Twitter card supplies its branded
cover. No odds or Telegram buttons are copied into the X text.

The private `/root/OddsFront/.local/x-credentials.env` must contain the four
account-specific OAuth 1.0a keys: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
and `X_ACCESS_TOKEN_SECRET`, with mode `0600`. Verify the account with
`GET /2/users/me` before enabling `ops/oddsfront-x.timer`. Credentials for any
other account must never be substituted. The user authorized copying only the
`@alotofbit` connection from the second VPS into this isolated file.

X has its own lock, two-hour interval, article deduplication, pending-outcome
guard and receipts under `.local/news/x`. Every successful send verifies the
post's author ID. Both timers check every five minutes; they publish at most
once in a two-hour period and wait for fresh news. No external post is simulated.
