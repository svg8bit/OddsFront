# Local basemap assets

- `ne_110m_admin_0_countries.geojson` is Natural Earth 1:110m Admin 0 Countries
  data. Natural Earth data is public domain. Source:
  <https://github.com/nvkelso/natural-earth-vector>
- `ne_110m_admin_0_countries.render.geojson` is the runtime-only derivative with
  unused properties removed, coordinates rounded, and sub-pixel geometry
  simplified for the global frame.
- `ne_110m_admin_0_country_labels.geojson` contains the source dataset's
  dedicated label anchors so multipolygon countries receive one label.
- `fonts/Open Sans Semibold/*.pbf` contains the three Latin glyph ranges used by
  MapLibre country labels. Source: the MapLibre demo tile service. Open Sans is
  licensed under Apache License 2.0.
- `night-earth/` contains a zoom 0-3 derivative of NASA EOSDIS GIBS Suomi NPP
  VIIRS City Lights 2012. It is a low-opacity visual texture, not live conflict
  evidence. The manifest records the source template, attribution, and SHA-256
  digest for every tile.

Country polygons and labels are context only. Conflict overlays are schematic
regional anchors and do not describe borders, frontlines or territorial control.

See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for consolidated
attribution.
