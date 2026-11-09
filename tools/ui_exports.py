"""Copy the finished interface art to final/ and export what the game loads: python tools/ui_exports.py
Icons get 512, 256 and 128 PNG in art-source/ui/final and a 128 WebP in game/public/assets/ui; screens are scaled to 1280 wide and card furniture to half size. Kit pieces stay in final/, as the game draws its buttons and panels in CSS, and so does what no screen shows: see NOT_SHOWN.
"""
import os
from PIL import Image

SOURCE, FINAL, RUNTIME = 'art-source/ui', 'art-source/ui/final', 'game/public/assets/ui'
# Newer takes of an icon replace the first one.
TAKES = {'reward-weapon': 'reward-weapon-v2', 'status-zerocost': 'status-zerocost-v2'}
# A locked card is a silhouette, a level I card has no frame, and the pause and team screens have no picture of their own.
NOT_SHOWN = ('card-back', 'overlay-locked', 'frame-tier1', 'bg-album', 'bg-pause')


def load(name):
    return Image.open(f'{SOURCE}/{TAKES.get(name, name)}.png').convert('RGBA')


def main():
    os.makedirs(FINAL, exist_ok=True)
    os.makedirs(RUNTIME, exist_ok=True)
    icons = [l.strip() for l in open(f'{SOURCE}/icons.txt', encoding='utf8') if l.strip()]
    for name in icons:
        image = load(name)
        for size in (512, 256, 128):
            image.resize((size, size), Image.LANCZOS).save(f'{FINAL}/{name}-{size}.png')
        image.resize((128, 128), Image.LANCZOS).save(f'{RUNTIME}/{name}.webp', quality=88, method=6)
    for batch in ('batch-card', 'batch-plain'):
        for name in [l.strip() for l in open(f'{SOURCE}/{batch}.txt', encoding='utf8') if l.strip()]:
            image = load(name)
            image.save(f'{FINAL}/{name}.png')
            if name.startswith('kit-') or name in NOT_SHOWN:
                continue
            if name.startswith('bg-'):
                small = image.convert('RGB').resize((1280, round(1280 * image.height / image.width)), Image.LANCZOS)
                small.save(f'{RUNTIME}/{name}.webp', quality=80, method=6)
            else:
                small = image.resize((image.width // 2, image.height // 2), Image.LANCZOS)
                small.save(f'{RUNTIME}/{name}.webp', quality=88, method=6)
    total = sum(os.path.getsize(f'{RUNTIME}/{f}') for f in os.listdir(RUNTIME))
    print(len(os.listdir(RUNTIME)), 'runtime files,', round(total / 1024), 'KB')


main()
