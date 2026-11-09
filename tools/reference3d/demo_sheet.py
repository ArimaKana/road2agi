"""Turn a key-frame render of a looping action into something to review before any video is generated.
python tools/reference3d/demo_sheet.py <frames dir> <out prefix> <fps> <frame> <frame> ...
Writes <out prefix>.gif, all eight directions looping at game speed, and <out prefix>.png, every frame of the cycle side by side."""
import os, sys
from PIL import Image, ImageDraw

root, out, fps, frames = sys.argv[1], sys.argv[2], int(sys.argv[3]), [int(f) for f in sys.argv[4:]]
ring = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL']
BG, CELL = (32, 48, 62), 260
loaded = {d: [Image.open(os.path.join(root, d, f'{f:04d}.png')).convert('RGBA').resize((CELL, CELL), Image.LANCZOS) for f in frames] for d in ring}


def plate(d, i):
    im = Image.new('RGBA', (CELL, CELL), BG + (255,))
    im.alpha_composite(loaded[d][i])
    ImageDraw.Draw(im).text((8, 6), d, fill=(205, 225, 235, 255))
    return im


# The screen arrangement: each direction sits where it points, so the grid reads as a turntable.
places = {'UL': (0, 0), 'U': (1, 0), 'UR': (2, 0), 'R': (3, 0), 'L': (0, 1), 'DL': (1, 1), 'D': (2, 1), 'DR': (3, 1)}
gif = []
for i in range(len(frames)):
    sheet = Image.new('RGBA', (CELL * 4, CELL * 2), BG + (255,))
    for d, (x, y) in places.items():
        sheet.paste(plate(d, i), (x * CELL, y * CELL))
    gif.append(sheet.convert('P', palette=Image.ADAPTIVE, colors=128))
gif[0].save(out + '.gif', save_all=True, append_images=gif[1:], duration=round(1000 / fps), loop=0, optimize=True)
strip = Image.new('RGBA', (CELL * len(frames), CELL * 3), BG + (255,))
for row, d in enumerate(('R', 'DR', 'U')):
    for i in range(len(frames)):
        strip.paste(plate(d, i), (i * CELL, row * CELL))
strip.convert('RGB').save(out + '.png')
print(out, len(frames), 'frames at', fps, 'fps')
