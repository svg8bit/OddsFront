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

There is no database migration or client state migration. Redeploy the previous
reviewed commit, then smoke-test the same routes and headers. Optional feed
credentials can be removed independently; the public fallbacks remain intact.
