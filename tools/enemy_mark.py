"""Repaint the enemy mark by geometry on the sheets where the image model could not keep its shape: a regular hexagon outline with one corner up and one down, and a short bar inside touching nothing.

python tools/enemy_mark.py
Each entry names a sheet, the mark's colour and where each mark sits. The old mark is erased there and the new one drawn at the same place, size and slant. Vertical lines stay vertical, as they do on any upright surface in the fixed camera.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

FOLDER = 'art-source/enemies/'
SHEETS = {
    # output: (source, colour, [(centre x, centre y, width, height, slant)...]), measured on the source sheet.
    'e04-v005': ('e04-v004', (241, 241, 244), [(322, 320, 39, 37, 0), (928, 320, 37, 37, 0), (298, 947, 35, 34, 0), (954, 946, 35, 35, 0)]),
    'e05-v004': ('e05-v003', (119, 105, 120), [(245, 214, 46, 43, 0), (1012, 214, 47, 43, 0), (177, 875, 44, 40, 0), (1092, 882, 43, 39, 0)]),
    'e06-v004': ('e06-v003', (230, 222, 226), [(452, 241, 31, 36, -.33), (787, 227, 28, 32, -.12), (518, 900, 33, 40, -.29), (720, 913, 29, 36, 0)]),
    'e08-v004': ('e08-v003', (235, 231, 232), [(302, 241, 29, 28, 0), (948, 240, 27, 28, 0), (279, 1052, 32, 31, 0), (975, 1063, 30, 28, 0)]),
    'e09-v005': ('e09-v004', (238, 238, 243), [(281, 340, 38, 39, 0), (972, 340, 40, 38, 0), (375, 885, 38, 38, -.18), (884, 885, 38, 38, .2)]),
    'e09e-v004': ('e09e-v003', (242, 227, 195), [(363, 880, 58, 53, 0), (887, 880, 57, 51, 0)]),
    'b03-v003': ('b03-v002', (241, 241, 244), [(320, 539, 40, 35, 0), (947, 539, 40, 35, 0), (320, 1166, 40, 35, 0), (947, 1167, 40, 35, 0)]),
}
SMALLER = {'e04-v005': .9}  # A hexagon's corners reach further than the round mark it replaces, and here they would touch the panel's trim.
STROKE, BAR_LENGTH, BAR_WIDTH, SCALE, MARGIN = .17, .46, .085, 6, 5


def erase(px, colour, cx, cy, width, height):
    # Only the old mark's own strokes go: neutral pixels standing off the surface toward the mark's colour. Trim, seams and highlights around it stay.
    a, b = width / 2 + 2, height / 2 + 2
    x0, x1, y0, y1 = int(cx - a) - MARGIN, int(cx + a) + MARGIN + 1, int(cy - b) - MARGIN, int(cy + b) + MARGIN + 1
    ys, xs = np.ogrid[y0:y1, x0:x1]
    inside = lambda grow: ((xs - cx) / (a + grow)) ** 2 + ((ys - cy) / (b + grow)) ** 2 <= 1
    out = px[y0:y1, x0:x1, :3].astype(float)
    brightness = out.mean(axis=2)
    surface = np.median(brightness[((xs - cx) / (a * .6)) ** 2 + ((ys - cy) / (b * .6)) ** 2 <= 1])
    toward = np.sign(np.mean(colour) - surface) * (brightness - surface)
    stroke = inside(0) & (toward > 18) & (out.max(axis=2) - out.min(axis=2) < 62)
    hole = ndi.binary_dilation(stroke, iterations=2) & inside(2)
    # Grow in from the edge of the hole, so that shading across the surface carries on under it.
    out[hole] = 0
    known = (~hole).astype(float)
    while (known == 0).any():
        weight = ndi.uniform_filter(known, 3)
        blur = np.stack([ndi.uniform_filter(out[..., c] * known, 3) for c in range(3)], axis=2)
        fill = (known == 0) & (weight > .1)  # At least one of the 3x3 neighbours is known; below that the filter's rounding noise would be divided by itself.
        out[fill] = blur[fill] / weight[fill][:, None]
        known[fill] = 1
    px[y0:y1, x0:x1, :3] = np.round(out).astype(np.uint8)


def draw_mark(sheet, colour, cx, cy, width, height, slant):
    radius = (width * height / 3.46) ** .5
    squeeze = min(1, width / height / .866)
    x0, y0, x1, y1 = int(cx - radius * 1.5), int(cy - radius * 1.5), int(cx + radius * 1.5) + 1, int(cy + radius * 1.5) + 1
    place = lambda x, y: ((cx - x0 + squeeze * x) * SCALE, (cy - y0 + y + slant * squeeze * x) * SCALE)
    corners = lambda r: [place(r * np.cos(a), r * np.sin(a)) for a in np.radians([-90, -30, 30, 90, 150, 210])]
    bar_x, bar_y = BAR_LENGTH * radius, BAR_WIDTH * radius
    layer = Image.new('L', ((x1 - x0) * SCALE, (y1 - y0) * SCALE))
    pen = ImageDraw.Draw(layer)
    pen.polygon(corners(radius), fill=255)
    pen.polygon(corners(radius * (1 - STROKE)), fill=0)
    pen.polygon([place(-bar_x, -bar_y), place(bar_x, -bar_y), place(bar_x, bar_y), place(-bar_x, bar_y)], fill=255)
    alpha = layer.resize((x1 - x0, y1 - y0), Image.LANCZOS).filter(ImageFilter.GaussianBlur(.45))
    keep_alpha = sheet.getchannel('A')
    rgb = sheet.convert('RGB')
    rgb.paste(colour, (x0, y0, x1, y1), alpha)
    rgb.putalpha(keep_alpha)
    return rgb


def main():
    for out, (source, colour, marks) in SHEETS.items():
        px = np.array(Image.open(f'{FOLDER}{source}.png').convert('RGBA'))
        for cx, cy, width, height, _ in marks:
            erase(px, colour, cx, cy, width, height)
        sheet = Image.fromarray(px)
        for cx, cy, width, height, slant in marks:
            sheet = draw_mark(sheet, colour, cx, cy, width * SMALLER.get(out, 1), height * SMALLER.get(out, 1), slant)
        sheet.save(f'{FOLDER}{out}.png')
        print(out)


if __name__ == '__main__':
    main()
