"""Export the painted effects for the game: python tools/vfx_exports.py
Each art-source/vfx/vfx-<art id>.png is a 2x2 flipbook. It goes to game/public/assets/vfx/fx-<art id>.webp at 512 pixels, so a frame is 256, played top left, top right, bottom left, bottom right.
"""
import glob, os
from PIL import Image

OUT = 'game/public/assets/vfx'
SKIP = {'035', '041'}  # A status icon and the train's own pictures do these jobs in the game.
HAZE = {'054': 110, '057': 70, '215': 135}  # The painter fills these with a fog or a grey plate that would dirty the floor, and retakes kept it. How much alpha counts as the fog.
os.makedirs(OUT, exist_ok=True)
paths = sorted(glob.glob('art-source/vfx/vfx-*.png'))
newest = {}
for path in paths:
    key = os.path.basename(path)[4:7]
    newest[key] = max(newest.get(key, path), path)  # A retake is vfx-054-v2.png and sorts after the first.
for key, path in newest.items():
    if key in SKIP:
        continue
    image = Image.open(path).convert('RGBA')
    if key in HAZE:
        image.putalpha(image.getchannel('A').point(lambda a: a if a > HAZE[key] else 0))
    image.resize((512, 512), Image.LANCZOS).save(f'{OUT}/fx-{key}.webp', quality=86, method=6)
total = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT))
print(len(newest), 'flipbooks,', len(os.listdir(OUT)), 'files,', round(total / 1024), 'KB')
