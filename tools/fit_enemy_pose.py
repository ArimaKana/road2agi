"""Put an enemy's idle drawing on the first frame of one reference clip: python tools/fit_enemy_pose.py <entity> <action> <direction>
H3 starts the figure where the first picture shows it, at that size, so the drawing is cut from a sheet and laid over the blocking model's silhouette.
Ordinary enemies take it from the top row of their design sheet (L, R). Elites (e02e) have <id>-idle.png in four directions, and bosses take two front three-quarter views from <id>-turn.png, eight around an empty middle. Those that never turn (B03, the decoy) take one cell of their design sheet.
Writes refs/<entity>/pose_<action>_<direction>.png, and the whole design sheet on green as refs/<entity>/sheet.png.
"""
import os, sys
import numpy as np
from PIL import Image

entity, action, direction = sys.argv[1:4]
SIZE, GREEN = 896, (0, 255, 0)
FINAL = 'art-source/enemies/final'
LAYOUT = {'L': (0, 0), 'R': (1, 0)}
ELITE = {'UL': (0, 0), 'UR': (1, 0), 'DL': (0, 1), 'DR': (1, 1)}
BOSS = {'L': (0, 2), 'R': (2, 2)}  # The front three-quarter views of the turnaround sheet.
FIXED = {'b03': (0, 0), 'decoy': (1, 0)}
if entity in FIXED:
    sheet, cells, spot = Image.open(f'{FINAL}/{entity}.png').convert('RGBA'), 2, FIXED[entity]
elif entity.startswith('b'):
    sheet, cells, spot = Image.open(f'{FINAL}/{entity}-turn.png').convert('RGBA'), 3, BOSS[direction]
elif entity.endswith('e'):
    sheet, cells, spot = Image.open(f'{FINAL}/{entity}-idle.png').convert('RGBA'), 2, ELITE[direction]
else:
    sheet, cells, spot = Image.open(f'{FINAL}/{entity}.png').convert('RGBA'), 2, LAYOUT[direction]
cell = sheet.width // cells
drawing = sheet.crop((spot[0] * cell, spot[1] * cell, (spot[0] + 1) * cell, (spot[1] + 1) * cell))
# Faint haze the image model sometimes leaves around a figure would tint the green.
drawing.putalpha(drawing.getchannel('A').point(lambda a: a if a > 110 else 0))
drawing = drawing.crop(drawing.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox())
first = np.array(Image.open(f'art-source/reference3d/{entity}_{action}/frames/{direction}/0000.png').convert('RGBA'))
ys, xs = np.nonzero(first[..., 3] > 128)
k = SIZE / first.shape[0]
left, right, top, bottom = xs.min() * k, (xs.max() + 1) * k, ys.min() * k, (ys.max() + 1) * k
# Match the area the silhouette covers: the drawing is rarely the same shape as the blocks.
scale = ((right - left) * (bottom - top) / (drawing.width * drawing.height)) ** .5
drawing = drawing.resize((round(drawing.width * scale), round(drawing.height * scale)), Image.LANCZOS)
canvas = Image.new('RGB', (SIZE, SIZE), GREEN)
canvas.paste(drawing, (round((left + right - drawing.width) / 2), round(bottom - drawing.height)), drawing)
folder = f'art-source/h3/refs/{entity}'
os.makedirs(folder, exist_ok=True)
canvas.save(f'{folder}/pose_{action}_{direction}.png')
design = Image.open(f'{FINAL}/{entity}.png').convert('RGBA')
whole = Image.new('RGB', design.size, GREEN)
whole.paste(design, (0, 0), design)
whole.resize((SIZE, SIZE), Image.LANCZOS).save(f'{folder}/sheet.png')
print(f'{entity} {action} {direction}: scale {scale:.3f}')
