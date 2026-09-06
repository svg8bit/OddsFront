# Social card fonts

The server-rendered news cards use the following SIL Open Font License assets:

- `inter-social-v1.ttf`: Google Fonts `ofl/inter/Inter[opsz,wght].ttf`
- `noto-sans-sc-social-v1.ttf`: Google Fonts `ofl/notosanssc/NotoSansSC[wght].ttf`
- `noto-sans-kr-social-v1.ttf`: Google Fonts `ofl/notosanskr/NotoSansKR[wght].ttf`
- `almarai-social-v1.ttf`: Google Fonts `ofl/almarai/Almarai-Bold.ttf`
- `noto-sans-hebrew-social-v1.ttf`: Google Fonts `ofl/notosanshebrew/NotoSansHebrew[wdth,wght].ttf`

The matching OFL texts are in `public/fonts/licenses`. The files were retrieved
from the official `google/fonts` repository on 2026-09-06 and instantiated at
weight 700 with FontTools 4.60.1. They are loaded only by the social-image route,
whose final PNG response is CDN-cached; normal pages keep using the small
self-hosted webfont files.
