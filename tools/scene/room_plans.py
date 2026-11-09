"""Draw a top-down plan of every battle room from level.ts: python tools/scene/room_plans.py
Writes art-source/scenes/rooms/<id>-plan.png with the walkable floor, walls, cover, doors, machines and where the hero starts. The north of the plan is the top row of the map.
"""
import os, re
from PIL import Image, ImageDraw

CELL, OUT = 26, 'art-source/scenes/rooms'
COLOUR = {'#': (70, 86, 104), 'o': (176, 136, 84), '<': (92, 200, 170), '>': (235, 110, 90), '.': (34, 46, 60)}
TRAP = dict(press=(232, 120, 70), belt=(110, 130, 200), valve=(230, 200, 90), shelf=(160, 110, 190), mirror=(210, 210, 240), vent=(240, 150, 50), stamper=(200, 90, 60), scan=(120, 220, 240), erase=(90, 90, 110), beacon=(240, 240, 240), pad=(120, 210, 150))


def rooms():
    text = open('game/src/game/level.ts', encoding='utf8').read()
    for match in re.finditer(r"\bid: '(\d-\d)', kind: '(\w+)'", text):
        rest = text[match.start():]
        following = re.search(r"\n\s*\{\s*\n\s*id: '", rest[10:])
        block = rest[:following.start() + 10] if following else rest
        rows = re.findall(r"^\s*'([^']+)',?\s*$", block[block.index('map: ['):], re.M)
        traps = {m[0]: m[1] for m in re.findall(r"\b(\w): \{ kind: '(\w+)'", block)}
        yield match.group(1), match.group(2), rows, traps


def main():
    os.makedirs(OUT, exist_ok=True)
    count = 0
    for room, kind, rows, traps in rooms():
        width, height = len(rows[0]) * CELL, len(rows) * CELL
        image = Image.new('RGB', (width + 20, height + 44), (16, 22, 30))
        pen = ImageDraw.Draw(image)
        pen.text((10, 6), f'{room} {kind}  green door in, red door out, white dot start', fill=(230, 235, 240))
        for r, row in enumerate(rows):
            for c, mark in enumerate(row):
                colour = TRAP.get(traps.get(mark)) or COLOUR.get(mark, COLOUR['.'])
                pen.rectangle((10 + c * CELL, 30 + r * CELL, 10 + (c + 1) * CELL - 1, 30 + (r + 1) * CELL - 1), fill=colour, outline=(22, 30, 40))
                if mark in traps:
                    pen.text((10 + c * CELL + 8, 30 + r * CELL + 6), traps[mark][0], fill=(16, 22, 30))
        doors = [(c, r) for r, row in enumerate(rows) for c, m in enumerate(row) if m == '<']
        if doors:
            c, r = sum(d[0] for d in doors) / len(doors), sum(d[1] for d in doors) / len(doors)
            inward_x, inward_y = (1 if c < 1 else -1 if c > len(rows[0]) - 2 else 0), (1 if r < 1 else -1 if r > len(rows) - 2 else 0)
            x, y = 10 + (c + .5 + inward_x * 2.5) * CELL, 30 + (r + .5 + inward_y * 2.5) * CELL
            pen.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(245, 245, 245))
        image.save(f'{OUT}/{room}-plan.png')
        count += 1
    print(count, 'plans')


main()
