# Social card fonts

The server-rendered news cards (English and Russian) use this SIL Open Font License asset:

- `inter-social-v1.ttf`: Google Fonts `ofl/inter/Inter[opsz,wght].ttf`

The matching OFL text is in `public/fonts/licenses`. The files were retrieved
from the official `google/fonts` repository on 2026-09-06 and instantiated at
weight 700 with FontTools 4.60.1. They are loaded only by the social-image route,
whose final PNG response is CDN-cached; normal pages keep using the small
self-hosted webfont files.
