# Data sources

OddsFront uses a small set of fixed, read-only sources.

## Prediction markets

Polymarket's public Gamma and market-data endpoints provide event discovery,
questions, odds, volume, expiry information, and public activity used by the
map. The application does not place orders, connect a wallet, or use signing
credentials.

Events must pass the product's conflict/geopolitics filters and volume floor.
Titles and tags are treated as untrusted data and rendered as text through
React. Links are reconstructed from validated event slugs rather than copied
blindly from upstream responses.

## Market strip

The market strip prefers an optional authenticated server-to-server snapshot.
When it is not configured or temporarily unavailable, fixed public read-only
sources are used as fallbacks. An optional `DROPSTAB_API_KEY` can improve
coverage but remains server-side.

The UI explicitly represents unavailable values. It does not convert a stale or
missing response into a fabricated quote.

## Geographic context

- Natural Earth 1:110m Admin 0 geometry supplies country context and label
  anchors.
- NASA EOSDIS GIBS VIIRS City Lights 2012 supplies a low-opacity visual texture.
- OpenFreeMap vector tiles add land-use, water, boundary, and place detail only
  at regional zoom levels. The origin is fixed in code and uses no API token.
- Map placements are schematic editorial anchors. They do not describe borders,
  frontlines, territorial control, or legal claims.

## Freshness and limitations

All upstream data can be delayed, revised, malformed, rate-limited, or
unavailable. OddsFront uses bounded caches and deterministic fallbacks to keep
the interface stable, but the map is not an authoritative conflict database or
a trading terminal.
