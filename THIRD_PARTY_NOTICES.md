# Third-party notices

This file summarizes the main data and asset sources shipped with OddsFront.
Dependency-level license texts remain available in their upstream packages.

## MapLibre GL JS

The locally hosted MapLibre worker bundle is generated from
[MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js), licensed under the
BSD 3-Clause license and containing upstream third-party notices. The npm
package is pinned in `package-lock.json`.

## Natural Earth

Country geometry and label anchors are derived from
[Natural Earth](https://www.naturalearthdata.com/). Natural Earth raster and
vector map data is public domain. The shipped runtime geometry is simplified
and property-reduced for the global frame.

## OpenFreeMap and OpenStreetMap

Regional vector detail is loaded from the fixed
[OpenFreeMap](https://openfreemap.org/) tile origin and includes data from
OpenStreetMap contributors. Attribution: **© OpenStreetMap contributors ·
OpenFreeMap**. No basemap API token is used.

## NASA Earth imagery

The low-opacity night texture is derived from NASA EOSDIS GIBS, Suomi NPP VIIRS
City Lights 2012. Attribution: **NASA EOSDIS GIBS / Suomi NPP VIIRS**. The
source template and per-tile checksums are recorded in
`public/maps/night-earth/manifest.json`.

## Fonts

- Inter: SIL Open Font License 1.1.
- Open Sans: Apache License 2.0. The shipped glyph ranges are limited to those
  used by the map labels.

## Market-strip icons

The compact market strip includes adapted or locally normalized vectors from
Bootstrap Icons, Simple Icons, Wikimedia Commons, and DropsTab source assets.
Company and product names and marks remain the property of their respective
owners and are used only for identification. See
`public/market-icons/README.md` for the asset-level notes.

## Brand assets

Files under `public/brand/` are OddsFront or DropsBot brand assets. They are not
covered by any third-party open-source license and no reuse license is granted
by this repository.
