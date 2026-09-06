# MapLibre browser modules

The `6.1.0` directory contains unchanged release assets from the pinned
`maplibre-gl` npm dependency and its BSD license. The main module and worker
reference the same sibling shared module. These URLs are served with immutable
cache headers and preloaded from the page HTML.

When upgrading MapLibre, copy its three production `.mjs` files and `LICENSE.txt`
into a new version directory, update the URLs in `map-library.ts` and
`app/layout.tsx`, and run `npm run check` plus the browser suite. The asset check
compares all four files byte-for-byte with the installed package.

The unversioned worker assets remain available for already-open older pages.
