"""Build font-independent OddsFront SVG masters from the supplied identity."""

import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/brand/oddsfront/svg"
OUT.mkdir(parents=True, exist_ok=True)
PURPLE, NAVY, CHARCOAL, LIGHT = "#6366F1", "#0F172A", "#374151", "#F8FAFC"
MARK = "M106 0H178L72 224H0Z M228 0H300L194 224H122Z"
GRADIENT = '<defs><linearGradient id="brand-gradient" x2="1" y2="1"><stop stop-color="#6366F1"/><stop offset="1" stop-color="#5548FF"/></linearGradient></defs>'

font = TTFont(ROOT / "public/fonts/inter-latin.var.woff2")
font = instantiateVariableFont(font, {"wght": 750}, inplace=True)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font["head"].unitsPerEm


def text_paths(text, size, x, baseline, color):
    scale = size / units
    parts = []
    cursor = 0
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        parts.append(f'<path d="{pen.getCommands()}" transform="translate({x + cursor * scale:.4f} {baseline}) scale({scale:.8f} {-scale:.8f})"/>')
        cursor += font["hmtx"][name][0] - units * 0.035
    return f'<g fill="{color}">{"".join(parts)}</g>', (cursor + units * 0.035) * scale


def mark(x, y, width, color):
    return f'<path d="{MARK}" fill="{color}" transform="translate({x} {y}) scale({width / 300:.8f})"/>'


def svg(name, width, height, body, background=None):
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    result = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" aria-label="OddsFront">{GRADIENT}{bg}{body}</svg>\n'
    (OUT / f"{name}.svg").write_text(result)
    return result


for variant, symbol, text in [
    ("primary", PURPLE, NAVY),
    ("reversed", PURPLE, "#FFFFFF"),
    ("black", "#000000", "#000000"),
    ("white", "#FFFFFF", "#FFFFFF"),
]:
    word, width = text_paths("OddsFront", 120, 0, 120, text)
    svg(f"wordmark-{variant}", round(width + 4, 3), 146, word)
    word, width = text_paths("OddsFront", 120, 182, 122, text)
    svg(f"logo-horizontal-{variant}", round(182 + width + 4, 3), 166, mark(0, 26, 136, symbol) + word)
    word, width = text_paths("OddsFront", 72, 0, 0, text)
    word, _ = text_paths("OddsFront", 72, (480 - width) / 2, 272, text)
    svg(f"logo-stacked-{variant}", 480, 300, mark(136, 24, 208, symbol) + word)
    svg(f"symbol-{variant}", 300, 224, mark(0, 0, 300, symbol))

svg("symbol-gradient", 300, 224, mark(0, 0, 300, "url(#brand-gradient)"))
for variant, bg, fg in [
    ("purple", PURPLE, "#FFFFFF"),
    ("gradient", "url(#brand-gradient)", "#FFFFFF"),
    ("light", LIGHT, PURPLE),
    ("dark", NAVY, PURPLE),
    ("black", "#000000", "#FFFFFF"),
    ("white", "#FFFFFF", "#000000"),
]:
    for shape in ["square", "rounded", "round"]:
        if shape == "round":
            field = f'<circle cx="256" cy="256" r="256" fill="{bg}"/>'
        else:
            radius = 104 if shape == "rounded" else 0
            field = f'<rect width="512" height="512" rx="{radius}" fill="{bg}"/>'
        width = 320 if shape == "round" else 384
        y = (512 - width * 224 / 300) / 2
        svg(f"icon-{shape}-{variant}", 512, 512, field + mark((512 - width) / 2, y, width, fg))

# All foreground points remain inside the maskable icon's 40%-radius safe circle.
svg("icon-maskable", 512, 512, mark(96, (512 - 320 * 224 / 300) / 2, 320, "#FFFFFF"), PURPLE)
svg("safari-pinned-tab", 300, 224, mark(0, 0, 300, "#000000"))

tokens = {
    "name": "OddsFront",
    "version": "1.0",
    "date": "2026-09-06",
    "colors": {"periwinkle": PURPLE, "deepNavy": NAVY, "charcoal": CHARCOAL, "lightGray": LIGHT, "white": "#FFFFFF", "gradientEnd": "#5548FF"},
    "typography": {"family": "Inter", "wordmarkWeight": 750, "wordmarkTrackingEm": -0.035, "headingWeight": 700, "bodyWeight": 400},
    "symbol": {"viewBox": [0, 0, 300, 224], "path": MARK, "barWidth": 72, "horizontalShift": 106, "barSeparation": 50},
    "clearSpace": {"symbolHeightMultiplier": 1, "minimumDigitalException": "Compact application assets use supplied locked exports."},
    "minimumSizes": {"horizontalDigitalPx": 144, "stackedDigitalPx": 100, "symbolDigitalPx": 16, "horizontalPrintMm": 30, "symbolPrintMm": 5},
    "surfacePolicy": "External brand surfaces only. Existing website controls, menus, layout and DropsBot branding remain unchanged.",
}
(OUT.parent / "tokens.json").write_text(json.dumps(tokens, indent=2) + "\n")
print(f"Generated {len(list(OUT.glob('*.svg')))} outlined SVG masters.")
