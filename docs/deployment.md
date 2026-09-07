# Deployment

The production application is designed for Vercel, but any Node.js 24 runtime
capable of serving Next.js 16 can host it.

## Vercel

1. Import `svg8bit/OddsFront` as a Next.js project.
2. Keep the repository root as the project root.
3. Use `npm run build`; no custom output directory is required.
4. Select Node.js 24.
5. Add only the optional server-side variables you actually use.
6. Attach the verified production domain and confirm canonical redirects.

Optional variables:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `ODDSFRONT_MARKET_FEED_URL` | Server only | HTTPS endpoint for a read-only snapshot |
| `ODDSFRONT_MARKET_FEED_TOKEN` | Server only | Bearer credential for that snapshot |
| `DROPSTAB_API_KEY` | Server only | Optional DropsTab API coverage |

Never create `NEXT_PUBLIC_` versions of these variables. Preview deployments
can run without them by using the public fallbacks.

## Release checks

Release through a pull request from the temporary task branch to protected
`main`. Wait for both `verify` and `analyze (javascript-typescript)` and inspect
the Vercel preview before merging. Record the current production deployment
and commit as the rollback target. Merge the verified PR head; the dedicated
Vercel project `oddsfront` publishes `main` automatically. Confirm that the
deployment serving `oddsfront.com` is READY and points to the merge commit.

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

After deployment, verify:

- `/` and `/global-conflict-map` return `200`;
- the map reaches `data-map-ready="true"`;
- API responses contain no environment values or authorization headers;
- security and cache headers are present;
- the technical deployment hostname redirects to `https://oddsfront.com`;
- browser console and network requests contain no runtime errors.

## Rollback

The VPS X publisher reads only its private named credential file
(`/root/OddsFront/.local/x-credentials.env`, mode `0600`). It accepts the four
`X_API_*` / `X_ACCESS_TOKEN*` OAuth1 values, or OAuth2 values
`X_OAUTH2_CLIENT_ID`, `X_OAUTH2_CLIENT_SECRET`, `X_OAUTH2_ACCESS_TOKEN`,
`X_OAUTH2_REFRESH_TOKEN` and `X_OAUTH2_EXPIRES_AT` (Unix milliseconds).
OAuth2 tokens refresh before expiry and rotate atomically in that file while
the publisher holds its lock. Keep these credentials off Vercel and Git.
Every post still verifies `@alotofbit` before sending and retains the existing
two-hour interval, pending-send guard and verified publication receipts.
When rolling back to an OAuth1-only publisher, retain the OAuth2 credential
file privately and pause the X publisher until compatible code is restored.

News readership additionally uses the existing OddsFront feed service. Install
`ops/market-feed/news_readership.py` alongside `oddsfront_market_feed.py`, and
install `ops/oddsfront-readership.conf` as a drop-in for
`oddsfront-market-feed.service`. `StateDirectory=oddsfront-market-feed` gives its
dynamic service user one private writable directory; no new listener or Caddy
route is needed. Back up the existing service code and drop-in before changing
them, validate with `npm run test:readership`, reload systemd and restart only
that feed service. Verify authenticated catalog reads and anonymous endpoint
rejection; production QA must not create synthetic readership rows.

There is no client state migration. Redeploy the previous
reviewed commit, then smoke-test the same routes and headers. Optional feed
credentials can be removed independently; the public fallbacks remain intact.
The readership database may be retained during rollback; previous application
versions ignore its additive catalog fields.
