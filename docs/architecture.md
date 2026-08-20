# Architecture

OddsFront is a read-only Next.js application designed for a CDN-backed runtime.

## Request path

```text
Browser -> CDN / Next.js
             ├── static app shell and self-hosted map assets
             ├── cached conflict-event endpoint -> Polymarket public APIs
             ├── cached activity endpoint       -> public market activity
             └── cached market strip
                    ├── optional authenticated server-only feed
                    └── fixed public fallbacks
```

The browser never receives feed credentials and never calls a private collector
directly. All external API requests originate from server modules or use fixed,
validated public destinations.

## Rendering boundary

- `app/` owns routes, metadata, caching, and read-only API responses.
- `features/global-conflict-map/` owns normalized event types, placement rules,
  map layers, presentation, and deterministic fixture data.
- `lib/` owns public upstream adapters, server-only market-strip adapters, and
  outbound-link validation.
- `public/` contains the global geometry, texture, glyphs, worker, icons, and
  social image required to render without a third-party basemap token. Detailed
  vector tiles come from the fixed OpenFreeMap origin at regional zoom levels.

## Adaptive map delivery

The initial client chooses one of two functional map experiences:

- **Lite** uses a deterministic Natural Earth SVG, keeps every qualified event
  marker, popup, activity alert, and market-strip link, and does not download
  MapLibre or create a WebGL canvas.
- **Detailed** dynamically imports MapLibre for capable desktop devices. Lite
  users can opt in with the `Detailed map` control, and an import failure falls
  back to Lite without losing market access.

Lite is selected for compact or coarse-pointer viewports, data-saving or 3G
connections, and constrained memory/CPU profiles. `?map=lite` and `?map=full`
are deterministic diagnostic overrides. Analytics is imported during browser
idle time and never blocks map readiness. Regenerate the versioned Lite asset
with `npm run generate:lite-map` after reviewing its Natural Earth inputs.

## Event lifecycle

1. The server paginates active Polymarket geopolitics events.
2. The normalizer keeps open binary conflict, war, peace, and military markets
   above the configured volume threshold.
3. Reviewed place rules provide precise anchors. Unmatched titles fall back to
   Natural Earth country label anchors derived from event text and tags.
4. The UI derives flags, odds, expiry, event paging, marker intensity, and
   validated outbound links from the normalized feed.
5. Cached fixture data keeps the map usable when an upstream is unavailable.

## Cache model

- static map and font assets use immutable or long-lived browser caching;
- event discovery is revalidated every ten minutes;
- market-strip data is revalidated every fifteen minutes;
- activity data is short-lived and clients add jitter to avoid synchronized
  bursts;
- API routes return explicit stale or unavailable modes instead of inventing
  live data.

## Security boundary

The application has no account, wallet, signing, custody, or write API. Optional
credentials use server-only environment variables without a `NEXT_PUBLIC_`
prefix. React escapes upstream text, links pass strict validators, and response
headers restrict framing, browser capabilities, resource origins, and MIME
sniffing.
