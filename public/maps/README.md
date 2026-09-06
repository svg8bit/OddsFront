# Local basemap assets

- `ne_110m_admin_0_countries.geojson` is Natural Earth 1:110m Admin 0 Countries
  data. Natural Earth data is public domain. Source:
  <https://github.com/nvkelso/natural-earth-vector>
- `ne_110m_admin_0_countries.render.geojson` is the runtime-only derivative with
  unused properties and bounding boxes removed, coordinates rounded to three
  decimals, and sub-pixel geometry simplified for the global frame.
- `ne_110m_admin_0_country_labels.geojson` contains the source dataset's
  dedicated label anchors so multipolygon countries receive one label. It keeps
  only the three properties used by the map style.
- `world-loading-v1.svg` is a lightweight geographic backdrop derived from the
  same country geometry. It appears before JavaScript/WebGL is ready and has
  no event markers or simulated data. The live canvas replaces it on readiness.
- `fonts/Open Sans Semibold/*.pbf` contains the three Latin glyph ranges used by
  the previous map style. Source: the MapLibre demo tile service. Open Sans is
  licensed under Apache License 2.0.
- The current map uses precomputed Inter Medium glyphs in `fonts/inter-medium-v1`.
  `npm run generate:map-font` bakes them with TinySDF and Chromium so clients do
  not generate glyph bitmaps during startup. It also creates gzip copies;
  `next.config.ts` serves them with an explicit gzip encoding to avoid sending
  uncompressed protobuf bitmaps (the initial range is approximately 29 KB).
  `scripts/subset-ui-font.py` produces the smaller
  Latin UI font while preserving variable weights and tabular numbers. The
  original font and its attribution remain available for the full brand kit.
- `night-earth/` contains a zoom 0-3 derivative of NASA EOSDIS GIBS Suomi NPP
  VIIRS City Lights 2012. It is a low-opacity visual texture, not live conflict
  evidence. The manifest records the source template, attribution, and SHA-256
  digest for every tile.

Country polygons and labels are context only. Conflict overlays are schematic
regional anchors and do not describe borders, frontlines or territorial control.

See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for consolidated
attribution.

Run `npm run generate:map-assets` after changing the Natural Earth derivatives.
`npm run check:map-assets` enforces deterministic output and payload budgets.
