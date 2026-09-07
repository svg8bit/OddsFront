# Publication supervision

The site publishes exactly nine verified articles every two hours. The writer
starts preparing the next private edition sixty minutes before it is due and
releases it at the deadline. Incomplete research remains private and retries.
Telegram EN, Telegram RU and X each publish hourly, using different recent
unsent site stories. Where possible, the next selection changes both country
and editorial topic. RU and X reuse the actual EN selection and retain their
own interval, receipt and duplicate guards.

Install `ops/oddsfront-publishing-monitor.service` and `.timer` alongside the
four publishing timers. Back up existing units before updating them. The monitor
runs on the VPS every five minutes, using persisted publication timestamps rather
than Vercel requests. It enables a stopped publishing timer and starts an overdue
idle publisher, with a fifteen-minute recovery backoff. Active writers are not
interrupted. A successful no-op scheduler check is not counted as publication.

After three consecutive unhealthy checks, the supervisor opens one incident in
`svg8bit/OddsFront`. It closes that incident after the timestamps recover. It
stays quiet while healthy. Private state and action receipts are in
`.local/news/monitor`. This is bounded service recovery and incident reporting;
it does not promise arbitrary autonomous code changes or silently bypass a
third-party authentication failure.

An unknown send outcome is never cleared or resent automatically. Verify its
external receipt before reconciling the ledger. Explicit provider rejections
(most HTTP 4xx responses, excluding timeout) release the attempt for a later
retry. A missing market feed or failed optional market editor can produce a
verified news-only Telegram post, without inventing odds. X still requires the
actual branded cover attachment.

For intentional maintenance, write `.local/news/maintenance.json` with the job
name (`news`, `telegram`, `telegram-ru`, `x`) mapped to an expiry timestamp in
Unix milliseconds. An expiry must be at most twelve hours away. The supervisor
leaves that job alone until the expiry; remove the entry after maintenance.
Keep this file private and never alter publication history to pause a job.

Run `node scripts/news/supervise.ts --check` to inspect the recovery plan without
starting services, sending messages, or creating issues.
