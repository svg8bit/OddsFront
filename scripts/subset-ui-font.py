"""Export the English UI font; requires fonttools[woff] from brand-requirements.txt."""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
font = TTFont(ROOT / "public/fonts/inter-latin.var.woff2")
options = subset.Options()
options.flavor = "woff2"
options.hinting = False
options.layout_features = ["kern", "liga", "clig", "calt", "tnum"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=(
    list(range(0x20, 0x180))
    + list(range(0x2000, 0x2070))
    + list(range(0x20A0, 0x20D0))
    + [0x2212]
))
subsetter.subset(font)
font.save(ROOT / "public/fonts/inter-ui-latin-v1.woff2")
