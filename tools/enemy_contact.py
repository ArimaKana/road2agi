"""Lay enemy design sheets out on the game's floor colour, to check them at design size and at play size.

python tools/enemy_contact.py <out.png> <sheet.png>...
  Each row: the sheet's four cells, then the heroine and the wind-up at play size, where she stands about 120 pixels high.
python tools/enemy_contact.py --overview <out.png> <folder>
  All sixteen enemies from <folder>/<id>.png, each with its name, as the overview the design doc shows.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FLOOR = (35, 54, 71)
HERO_SHEET = 'art-source/deepseek-four-directions-v002.png'
CELL_SHOWN = 300  # A cell of the sheet as shown in a row.
PLAY_CELL = 171  # A cell at play size: the heroine fills 70% of a cell.
OVERVIEW_CELL = 240
LABEL = 40
ROSTER = [
    ('e01', 'E01 噪点蠕虫'), ('e02', 'E02 校验盾卫'), ('e03', 'E03 垃圾信使'), ('e04', 'E04 回声祭司'),
    ('e05', 'E05 幻觉投影'), ('e06', 'E06 错引弩手'), ('e07', 'E07 缓存水母'), ('e08', 'E08 索引盗贼'),
    ('e09', 'E09 过拟合骑士'), ('e10', 'E10 退火炉'), ('e11', 'E11 熵蚀编织者'), ('e12', 'E12 遗忘收割者'),
    ('e02e', 'E02＋ 强校验卫'), ('e06e', 'E06＋ 循环引用弩手'), ('e09e', 'E09＋ 复训骑士'), ('e12e', 'E12＋ 格式化收割者'),
]


def cells(sheet):
    half = sheet.width // 2
    return [sheet.crop((x, y, x + half, y + half)) for y in (0, half) for x in (0, half)]


def hero_cell():
    # Her sheet sits on chroma green, so it is keyed here.
    px = np.array(Image.open(HERO_SHEET).convert('RGBA'))
    r, g, b = px[..., 0].astype(int), px[..., 1].astype(int), px[..., 2].astype(int)
    px[(g > 170) & (r < 110) & (b < 110), 3] = 0
    return cells(Image.fromarray(px))[3]


def rows(out, paths):
    hero = hero_cell().resize((PLAY_CELL, PLAY_CELL), Image.LANCZOS)
    canvas = Image.new('RGB', (CELL_SHOWN * 4 + PLAY_CELL * 2, CELL_SHOWN * len(paths)), FLOOR)
    for row, path in enumerate(paths):
        parts = cells(Image.open(path).convert('RGBA'))
        for col, part in enumerate(parts):
            shown = part.resize((CELL_SHOWN, CELL_SHOWN), Image.LANCZOS)
            canvas.paste(shown, (col * CELL_SHOWN, row * CELL_SHOWN), shown)
        x, y = CELL_SHOWN * 4, row * CELL_SHOWN + (CELL_SHOWN - PLAY_CELL) // 2
        small = parts[2].resize((PLAY_CELL, PLAY_CELL), Image.LANCZOS)
        canvas.paste(hero, (x, y), hero)
        canvas.paste(small, (x + PLAY_CELL, y), small)
    canvas.save(out)
    print(out, canvas.size)


def overview(out, folder):
    # Ordinary enemies show idle and wind-up; elites are all wind-up, so they show the back and the front.
    columns, entry = 4, (OVERVIEW_CELL * 2, OVERVIEW_CELL + LABEL)
    canvas = Image.new('RGB', (entry[0] * columns, entry[1] * ((len(ROSTER) + columns - 1) // columns)), FLOOR)
    draw, font = ImageDraw.Draw(canvas), ImageFont.truetype('msyh.ttc', 24)
    for i, (key, name) in enumerate(ROSTER):
        x, y = (i % columns) * entry[0], (i // columns) * entry[1]
        draw.text((x + 16, y + 6), name, font=font, fill=(226, 234, 240))
        for side, part in enumerate(cells(Image.open(f'{folder}/{key}.png').convert('RGBA'))[::2]):
            shown = part.resize((OVERVIEW_CELL, OVERVIEW_CELL), Image.LANCZOS)
            canvas.paste(shown, (x + side * OVERVIEW_CELL, y + LABEL), shown)
    canvas.save(out, optimize=True)
    print(out, canvas.size)


if __name__ == '__main__':
    if sys.argv[1] == '--overview':
        overview(sys.argv[2], sys.argv[3])
    else:
        rows(sys.argv[1], sys.argv[2:])
