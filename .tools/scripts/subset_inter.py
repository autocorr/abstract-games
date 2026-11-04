"""Subset the Inter variable fonts for the site (common/fonts/).

Download the official release (https://github.com/rsms/inter/releases), unzip
it, and pass the directory holding web/InterVariable*.woff2:

    uv run --project .tools python .tools/scripts/subset_inter.py <unzipped-release-dir>

Keeps the weight axis (100-900) and pins optical size to text size (opsz 14),
which roughly halves the files. Keeps Latin plus the punctuation, arrows and
symbols the pages use, and the OpenType features they rely on (kerning,
ligatures, tabular figures, case-sensitive forms). Copies the license next to
the fonts.
"""
import pathlib
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Latin-1, Latin Extended-A, combining marks, common punctuation, arrows and
# a few symbols.
UNICODES = (
    "U+0000-017F,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0300-0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2195,U+2212,U+2215,"
    "U+22C5,U+FEFF,U+FFFD"
)
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "case", "cpsp",
            "dlig", "frac", "sups", "subs"]

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parents[2] / "common" / "fonts"
out.mkdir(exist_ok=True)

for name in ["InterVariable", "InterVariable-Italic"]:
    font = TTFont(str(src / "web" / f"{name}.woff2"), lazy=False)
    options = subset.Options()
    options.layout_features = FEATURES
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, {"opsz": 14})
    font.flavor = "woff2"
    target = out / f"{name}.woff2"
    font.save(str(target))
    print(f"{target.name}: {target.stat().st_size // 1024} KB")

shutil.copy(src / "LICENSE.txt", out / "LICENSE.txt")
