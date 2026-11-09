"""Clean each card's figure layer and cut its avatars and thumbnails: python tools/card_exports.py kimi:v001 glm:v002
Or clean each skill icon and write its sizes: python tools/card_exports.py --icons kimi:v001 glm:v001

Reads art-source/cards/<id>-figure-<version>.png and final/<id>.png and <id>-art.png. Writes into final/: <id>-figure.png,
<id>-avatar-512/256/128.png, <id>-thumb.png with the signature and <id>-art-thumb.png without it.
With --icons, reads art-source/cards/<id>-icon-<version>.png and writes final/<id>-icon-512/256/128.png.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage


CARDS = 'art-source/cards'
FINAL = f'{CARDS}/final'
THUMB = (512, 768)
SIZES = (512, 256, 128)  # avatars and skill icons
ICON_FILL = 1.03  # canvas side against the disc's width, leaving a small margin
# Square around each head on the 1024x1536 card, as left, top, side. Set by eye so ears, hats and hair ornaments stay in.
AVATAR = {
    'kimi': (320, 130, 540), 'glm': (360, 60, 560), 'qwen': (400, 90, 560),
    'seed': (380, 40, 480), 'minimax': (350, 40, 540), 'gpt': (390, 100, 520),
    'claude': (165, 205, 480), 'grok': (300, 90, 640), 'gemini': (300, 160, 600),
}


def clean_alpha(path):
    """Codex leaves a faint haze and specks across the transparent background."""
    rgba = np.array(Image.open(path).convert('RGBA'))
    alpha = rgba[..., 3]
    alpha[alpha <= 16] = 0
    labels, count = ndimage.label(alpha > 0)
    sizes = ndimage.sum_labels(np.ones_like(labels), labels, range(1, count + 1))
    alpha[np.isin(labels, np.flatnonzero(sizes < 150) + 1)] = 0
    return Image.fromarray(rgba, 'RGBA')


def save_sizes(square, name):
    for size in SIZES:
        square.resize((size, size), Image.LANCZOS).save(f'{FINAL}/{name}-{size}.png')


def export_figure(card, version):
    figure = clean_alpha(f'{CARDS}/{card}-figure-{version}.png')
    figure.save(f'{FINAL}/{card}-figure.png')
    left, top, side = AVATAR[card]
    save_sizes(figure.crop((left, top, left + side, top + side)), f'{card}-avatar')
    for source, name in ((card, 'thumb'), (f'{card}-art', 'art-thumb')):
        Image.open(f'{FINAL}/{source}.png').convert('RGB').resize(THUMB, Image.LANCZOS).save(f'{FINAL}/{card}-{name}.png')


def export_icon(card, version):
    # Codex draws each disc at a slightly different size and position, so the set is squared up around the disc itself.
    icon = clean_alpha(f'{CARDS}/{card}-icon-{version}.png')
    left, top, right, bottom = icon.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
    middle_x, middle_y, half = (left + right) // 2, (top + bottom) // 2, round(max(right - left, bottom - top) * ICON_FILL / 2)
    save_sizes(icon.crop((middle_x - half, middle_y - half, middle_x + half, middle_y + half)), f'{card}-icon')


def main():
    jobs = sys.argv[1:]
    export = export_figure
    if jobs[0] == '--icons':
        jobs, export = jobs[1:], export_icon
    for job in jobs:
        card, version = job.split(':')
        export(card, version)
        print(card)


if __name__ == '__main__':
    main()
