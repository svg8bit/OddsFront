# OddsFront brand identity 1.0

This package implements the two-stroke OddsFront identity supplied on
September 6, 2026. The four unchanged reference images are in `source/`.

## Deliverables

- `oddsfront-brandbook-v1.pdf`: 16-page brandbook.
- `oddsfront-brandbook-v1.html`: self-contained, editable book with embedded
  fonts and artwork. Open locally; no external requests are required.
- `oddsfront-brand-overview.png`: visual overview of the finished assets.
- `svg/`: 37 scalable masters, including horizontal and stacked logos,
  wordmarks, symbols, square/rounded/circular app icons, monochrome variants,
  a Safari pinned-tab mask and an Android maskable icon.
- `tokens.json`: exact colors, geometry, type settings, and minimum sizes.
- The generated release archive also contains transparent PNG exports,
  browser/device icons, social canvases, and a SHA-256 inventory.

All wordmarks are outlined. They require no installed font and contain no
external SVG references. The production wordmark is reconstructed in Inter
750 with -0.035em tracking: the supplied raster references do not identify
their original typeface. The symbol is normalized to two identical strokes;
the original files remain available for comparison.

## Which file to use

| Surface | Master or export |
| --- | --- |
| Default signature on light backgrounds | `svg/logo-horizontal-primary.svg` |
| Signature on dark backgrounds | `svg/logo-horizontal-reversed.svg` |
| One-color production | `svg/logo-horizontal-black.svg` or `logo-horizontal-white.svg` |
| Centered compositions | `svg/logo-stacked-primary.svg` |
| Small brand marker | `svg/symbol-primary.svg` |
| Profile avatar | `svg/icon-square-gradient.svg` or `icon-round-purple.svg` |
| Browser tabs | `public/brand/oddsfront-icon-v1.svg`, PNG fallbacks, `public/favicon.ico` |
| Apple touch icon | `public/brand/oddsfront-apple-touch-icon-v1.png` |
| Android and saved shortcuts | `public/site.webmanifest` and referenced 192/512 PNGs |
| Safari pinned tabs | `public/brand/oddsfront-pinned-tab-v1.svg` |
| Shared links | `public/brand/oddsfront-social-preview-v2.png` |

Paths starting with `public/` are relative to the repository root. Platform
PNGs and the ICO are copied into the release archive's `exports/platform-icons/`.
The regular ICO contains four real 32-bit DIB images: 16, 32, 48, and 64 pixels.
The 512-pixel maskable icon keeps its mark inside the central 40%-radius circle.

## Scope of application

The user authorized the new identity on external surfaces only: browser tabs,
bookmarks, saved shortcuts, link previews, repository presentation, and the
OddsFront Vercel project. The website's existing map, buttons, menu, in-page
DropsBot branding, tracking links and behavior must remain unchanged.

The manifest keeps `display: browser`, and the existing browser theme color is
preserved. This update adds no offline mode, service worker, install prompt,
or visible page component. New asset URLs avoid reuse of the old DropsBot
favicon cache. Clients with permanently cached redirects, existing saved
shortcuts, search crawlers and third-party preview caches choose their own
refresh timing; a deployment cannot force every external cache to refresh.

Vercel supports a dedicated project avatar through its authenticated
`POST /v1/projects/{idOrName}/avatar` API. Use `svg/icon-square-gradient.svg`
for the OddsFront project; the default falls back to the deployed favicon.
A user/team avatar is a separate shared-account setting and is outside this
package. See the official [project avatar API](https://vercel.com/docs/rest-api/projects/upload-a-project-avatar).

## Reproduce

Requirements: the project's pinned Node.js dependencies, Python 3.12, and
Chromium for Playwright. The Python environment below is local to this project.

```bash
npm ci
python3 -m venv .local/brand-tools
.local/brand-tools/bin/pip install -r scripts/brand-requirements.txt
.local/brand-tools/bin/python scripts/generate-brand-vectors.py
npx playwright install chromium
node scripts/export-brand-identity.mjs
```

The SVG script reads the existing Inter font under `public/fonts/`. It uses
FontTools to instantiate the variable font and convert glyphs to paths. The
export script rasterizes the canonical vectors using Sharp and renders the
book and social canvases with Playwright. Outputs go to
`output/brand-identity/`; source masters and browser assets stay in their
documented repository paths. Book metadata timestamps may change on export;
the identity geometry, dimensions and colors are deterministic.

## Palette and accessibility

The core reference colors are Periwinkle `#6366F1`, Deep Navy `#0F172A`,
Charcoal `#374151`, and Light Gray `#F8FAFC`. White and the icon-only gradient
endpoint `#5548FF` are supporting values. All digital exports use sRGB.
Calculated CMYK percentages in the book are starting points, not a press proof
or a Pantone match.

Contrast ratios are calculated with the WCAG relative-luminance formula.
White on Periwinkle is 4.466:1, below the 4.5:1 threshold for normal text;
Deep Navy on Light Gray is 17.06:1. See the official
[WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Rights

OddsFront brand assets remain proprietary; no reuse license is granted by this
repository. Inter is distributed under the SIL Open Font License 1.1; see the
repository's third-party notices. User-provided reference files are preserved
unchanged and are not presented as newly created production masters.
