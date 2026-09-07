# Publication supervision

The site publishes exactly nine verified articles every two hours. The writer
starts preparing the next private edition sixty minutes before it is due and
releases it at the deadline. Incomplete research remains private and retries.
Telegram EN, Telegram RU and X each publish hourly, using different recent
unsent site stories. Where possible, the next selection changes both country
and editorial topic. RU and X reuse the actual EN selection and retain their
own interval, receipt and duplicate guards.

Social eligibility follows UTC clock hours, so editorial work and the
five-minute timer poll do not accumulate schedule drift. Missed hours do not
create a burst of backlog posts. The common selection requires reviewed Russian
headline/description text before English delivery; the RU bootstrap date cutoff
applies only until that channel has its first successful publication.

Offline translation retains completed texts after every batch. Interrupted
workers resume these cached texts and never save incomplete paragraphs. The
follow-up has a 55-minute bound, leaving time before the next preparation window.

Install `ops/oddsfront-publishing-monitor.service` and `.timer` alongside the
four publishing timers. Back up existing units before updating them. The monitor
runs on the VPS every five minutes, using persisted publication timestamps rather
than Vercel requests. It enables a stopped publishing timer and starts an overdue
idle publisher, with a fifteen-minute recovery backoff. Active writers are not
interrupted. A successful no-op scheduler check is not counted as publication.

After three consecutive unhealthy checks, the supervisor opens one incident in
`svg8bit/OddsFront`. It closes that incident after the timestamps recover. It
stays quiet while healthy. Private state and action receipts are in
`.local/news/monitor`.

Install `ops/oddsfront-publishing-repair.service` and create a root-owned, mode
0600 `.local/news/monitor/dispatch.json` containing `enabled: true` and the
existing authorized OddsFront task UUID in `threadId`. Keep the actual task ID
out of Git. The local Codex daemon must be available under the same VPS user.
After three consecutive unhealthy checks, the service uses the supported
`codex queue --thread ... --message ...` command to notify that existing task.
The task retains the owner's authorization and project history. This does not
create a separate agent, invoke a model on every timer tick, or reset a goal.

The dispatch lock prevents concurrent sends, and a six-hour cooldown bounds
repeat notifications, including unconfirmed outcomes. A health snapshot older
than ten minutes cannot trigger a message. The dispatcher has a 90-second
service limit and restricted filesystem access; it does not inherit API keys.
Its receipt records the exact acknowledged message and destination. Queue
acceptance proves neither task execution nor completed repair. The supervisor
keeps checking actual publication timestamps independently.

The maintenance message asks the existing task to verify that the incident still
exists, use the normal project checks and protected release workflow, and retry
only overdue idle publishers. It preserves source, novelty, cover, translation,
account identity and duplicate guards. Recovered incidents need no action.
Authentication, human challenges and unavailable third-party services remain
external conditions; the dispatcher does not bypass them.

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
`node scripts/news/repair-agent.ts --check` inspects dispatch eligibility without
queueing a message or consuming the incident cooldown. Private receipts are
under `.local/news/monitor/agent`. A manual integration message must be clearly
labelled as a delivery test and must not request publication or fabricate an
incident in production state.

## Disputed-resolution broadcasts

`oddsfront-channel-moderation.service` and `.timer` inspect the two public
OddsFront Telegram channels each minute. The filter removes only the current
Drops `Polymarket Resolution Disputed` format, requiring both its exact alert
header and disputed-status sentence, the exact channel/post identity, and a
verified recent timestamp. Normal news, odds alerts and clarification messages
are retained. The publisher bot identity and deletion permissions are checked
before any deletion. Successful API confirmations are recorded privately in
`.local/news/channel-moderation`.

This is channel moderation after detection, not a change to the user's Drops
profile or a guarantee that a notification never appears. Public-feed delays
and Telegram availability affect detection. It does not call `getUpdates`,
replace a webhook or require a Telegram user-session login. It reuses only the
publisher's existing authorized named bot key. Back up any existing unit files
before installation, then enable the timer. `python3
scripts/news/moderate-telegram.py --check` performs a read-only eligibility check.
