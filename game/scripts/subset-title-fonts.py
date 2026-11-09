"""Build the two static title font subsets; see public/assets/fonts/README.md."""
import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("sources", type=Path, help="Directory containing the two upstream TTFs")
args = parser.parse_args()
output = Path(__file__).resolve().parents[1] / "public/assets/fonts"

for source, text, family, filename in [
    ("CinzelDecorative-Regular.ttf", "ROADAGI", "R2A Title Capitals", "r2a-title-capitals.woff2"),
    ("GreatVibes-Regular.ttf", "to", "R2A Title Script", "r2a-title-script.woff2"),
]:
    font = TTFont(args.sources / source, recalcTimestamp=False)
    options = subset.Options()
    options.name_IDs = ["*"]  # Preserve upstream attribution and license text.
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    # Rename the derivatives, respecting the upstream reserved font names.
    postscript = family.replace(" ", "") + "-Regular"
    names = {1: family, 2: "Regular", 3: postscript, 4: family + " Regular", 6: postscript,
             16: family, 17: "Regular", 18: family + " Regular", 21: family, 22: "Regular"}
    for record in list(font["name"].names):
        if record.nameID in names:
            font["name"].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    font.flavor = "woff2"
    font.save(output / filename)
    print(f"Saved {filename}: {(output / filename).stat().st_size:,} bytes")
