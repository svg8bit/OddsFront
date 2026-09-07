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
- `public/` contains the global geometry, web font, worker, icons, and
  social image required to render without a third-party basemap token. Detailed
  vector tiles come from the fixed OpenFreeMap origin starting at zoom 4.
  Country labels use precomputed, compressed Inter glyphs;
  clients do not rasterize the font on startup. Only a bounded set of compositor pulses animates while
  idle. Map movement and background tabs pause these effects.
  A static geographic backdrop appears before JavaScript is available. It has
  no live-data claims and is replaced when the canvas is ready. Canvas resolution
  stays constant throughout camera gestures, preserving text clarity and avoiding
  framebuffer reallocations or interrupted input. Mobile density is capped at
  1.5 rather than 2. The server emits map bundle preloads while a hydration gate
  keeps WebGL initialization in the browser.
  Marker hit targets are portaled into MapLibre's canvas container so wheel,
  drag and two-finger gestures starting on markers reach the same input handler.
  Popups remain outside that container to keep their controls independent.
  Selecting a marker opens one persistent card without changing the camera or
  rebuilding the marker GeoJSON source. Desktop cards move with a short transform
  transition between selections and follow drag frames directly; mobile cards
  keep their position. Markers and cards remain visible during camera movement.
  MapLibre is served as its original versioned ES modules, allowing the browser
  and worker to share the same downloaded module instead of bundling a second
  copy into Next.js. HTML module preloads start these requests immediately. The
  map creates one WebGL context, using the browser's synchronized presentation.

## Event lifecycle

1. The server paginates active Polymarket geopolitics events.
2. The normalizer keeps open binary conflict, war, peace, and military markets
   above the configured volume threshold.
3. Reviewed place rules provide precise anchors. Unmatched titles fall back to
   Natural Earth country label anchors derived from event text and tags.
4. The UI derives flags, odds, expiry, event paging, marker intensity, and
   validated outbound links from the normalized feed.
5. Failed refreshes keep the browser's last verified feed. Production API errors
   return 503; fallback fixtures never overwrite live client data.

## Cache model

- static map and font assets use immutable or long-lived browser caching;
- event discovery is revalidated every minute, with a blocking refresh if a
  cached upstream snapshot is more than 90 seconds old;
- event API responses bypass browser storage; the shared edge cache lasts 15
  seconds with a 15-second background revalidation window;
- market-strip data is revalidated every fifteen minutes;
- activity data is short-lived and clients add jitter to avoid synchronized
  bursts;
- API routes return explicit stale or unavailable modes instead of inventing
  live data.

The lightweight loader owns one event-feed subscription independently of the
deferred map bundle. It refreshes immediately on entry, pageshow, focus,
visibility restoration and reconnect, deduplicates in-flight requests, times
out blocked requests and ignores older snapshots. Visible tabs poll roughly
once per minute. The activity rail shows the live Gamma day/week changes for
active individual markets with at least $100K volume: at least five percentage
points over 24 hours or twenty over seven days. It includes both periods and
directions when eligible markets exist, and rotates distinct sets of markets
every fifteen minutes. Up to three cards are shown, with another set reserved
for the next cycle; expired cards cannot immediately return under new IDs.
A lone eligible market rests for a cycle after expiry. A price refresh updates
the value without extending that display cycle. The timestamp is labelled
Updated, not a new event occurrence.
Stale feeds and expired markets cannot produce notices. This requires no
additional CLOB history requests from Vercel. Large trades and strict
breaking-news matches retain their actual occurrence times and fifteen-minute
lifetimes.

## Security boundary

The application has no account, wallet, signing or custody API. An anonymous
news-readership endpoint records visible article reads for the popularity rail.
Optional
credentials use server-only environment variables without a `NEXT_PUBLIC_`
prefix. React escapes upstream text, links pass strict validators, and response
headers restrict framing, browser capabilities, resource origins, and MIME
sniffing.

## News and localization

See `news-operations.md` for the isolated runtime publisher, editorial gates,
read-only delivery, offline translations and recovery. News pages do not preload
the map engine; only related live event data is shared with the map.

The news rail ranks real article reads in the preceding seven days, across all
languages. It stays empty until reads have been collected, without fabricated
initial counts. A read requires five seconds with the article tab visible.
Session storage prevents repeat submissions, and the backend additionally
deduplicates each article/session per UTC day. Prefetches, bot previews and
background tabs do not count. The backend stores only HMAC digests, article
slugs and timestamps; raw session IDs and IP addresses are never persisted.
Expired readership rows are deleted after seven days. A separate anonymous
network digest bounds new reads to 30 per minute and expires after two minutes.

The public same-origin POST validates its body and relays to the existing
authenticated feed path `/v1/news/articles/{slug}/view`. SQLite state lives in
the feed service's private `StateDirectory`, outside the repository and news
publisher's exported catalog. `/v1/news` attaches current `views7d` counts;
editorial publication times remain unchanged. A counter failure never prevents
the article or market feed from loading.
