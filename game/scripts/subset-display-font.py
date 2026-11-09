"""Regenerate the bundled UI serif; see public/assets/fonts/README.md."""
import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="Path to the upstream Noto Serif SC variable TTF")
args = parser.parse_args()
game = Path(__file__).resolve().parents[1]

# Include dynamic room names and dialogue names as well as Vue labels. Keep ASCII
# for numbers and keyboard bindings; newly introduced CJK text needs regeneration.
characters = set(map(chr, range(32, 127)))
for source in sorted((game / "src").rglob("*")):
    if source.suffix in {".vue", ".ts"} and not source.name.endswith(".test.ts"):
        characters.update(source.read_text(encoding="utf-8"))
codepoints = {ord(char) for char in characters if char.isprintable()}

font = TTFont(args.source, recalcTimestamp=False)
missing_cjk = {cp for cp in codepoints if 0x3400 <= cp <= 0x9FFF and cp not in font.getBestCmap()}
if missing_cjk:
    raise ValueError(f"Source font lacks Chinese characters: {''.join(map(chr, sorted(missing_cjk)))}")

options = subset.Options()
options.name_IDs = ["*"]  # Retain upstream copyright, license and attribution.
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=codepoints)
subsetter.subset(font)
# Subset first so instancing only processes the glyphs actually used by the game.
instantiateVariableFont(font, {"wght": 500}, inplace=True)
font.flavor = "woff2"
output = game / "public/assets/fonts/r2a-display-serif.woff2"
font.save(output)
print(f"Saved {output.name}: {len(font.getBestCmap())} codepoints, {output.stat().st_size:,} bytes")
