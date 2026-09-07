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
than ten minutes are candidates. An editorial check requires a strong specific
news/market relationship and a working tracking link. A common country alone is insufficient. If there is
no suitable match, the job records a skipped edition. Market prices are fetched
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
