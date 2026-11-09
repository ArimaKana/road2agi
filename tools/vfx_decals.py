"""Draw the effects whose shape is a rule rather than a painting: python tools/vfx_decals.py
A warning has to cover exactly what it hits, so these are geometry. Enemy ranges are orange-red with an outer edge and diagonal stripes, friendly ones a solid thin edge, and every one also differs in shape, never only in colour (spec section 10).
Writes game/public/assets/vfx/decal-*.webp, white-free and alpha only where nothing is drawn. Ground decals are laid flat by the game, so they are drawn seen from straight above.
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT, SIZE, SCALE = 'game/public/assets/vfx', 512, 2
ENEMY, ENEMY_DARK, FRIEND, SAFE = (255, 106, 61), (150, 40, 20), (120, 220, 240), (255, 180, 110)


def canvas():
    return Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))


def finish(image, name):
    image.resize((SIZE, SIZE), Image.LANCZOS).save(f'{OUT}/decal-{name}.webp', quality=88, method=6)


def stripes(mask, colour, alpha=96, step=44, width=18):
    """Diagonal stripes inside a mask."""
    size = mask.size[0]
    layer = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    pen = ImageDraw.Draw(layer)
    for k in range(-size, size * 2, step):
        pen.line((k, size, k + size, 0), fill=(*colour, alpha), width=width)
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', mask.size, 0), mask))
    return layer


def warning(shape):
    """shape draws the region on a mask. The fill is faint, the stripes carry it, and the outer edge is bright."""
    image, c = canvas(), SIZE * SCALE
    mask = Image.new('L', (c, c), 0)
    shape(ImageDraw.Draw(mask), c)
    fill = Image.new('RGBA', (c, c), (*ENEMY_DARK, 70))
    fill.putalpha(Image.composite(Image.new('L', (c, c), 70), Image.new('L', (c, c), 0), mask))
    image.alpha_composite(fill)
    image.alpha_composite(stripes(mask, ENEMY))
    edge = Image.fromarray(np.array(mask) - np.array(mask.filter(ImageFilter.MinFilter(13))))
    outline = Image.new('RGBA', (c, c), (*ENEMY, 255))
    outline.putalpha(edge)
    image.alpha_composite(outline)
    return image


def friendly_ring():
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    pen.ellipse((12, 12, c - 12, c - 12), outline=(*FRIEND, 255), width=10)
    pen.ellipse((12, 12, c - 12, c - 12), fill=None)
    glow = Image.new('RGBA', (c, c), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((22, 22, c - 22, c - 22), fill=(*FRIEND, 34))
    glow.alpha_composite(image)
    return glow


def shadow(softness, name):
    c = SIZE * SCALE
    mask = Image.new('L', (c, c), 0)
    margin = int(c * softness / 2) + 20
    ImageDraw.Draw(mask).ellipse((margin, margin + int(c * .14), c - margin, c - margin - int(c * .14)), fill=170)
    blurred = mask.filter(ImageFilter.GaussianBlur(c * softness / 4))
    image = Image.new('RGBA', (c, c), (0, 10, 18, 0))
    image.putalpha(blurred)
    finish(image, name)


def double_ring():
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    pen.ellipse((30, 30, c - 30, c - 30), outline=(242, 227, 195, 255), width=14)
    pen.ellipse((110, 110, c - 110, c - 110), outline=(242, 227, 195, 190), width=8)
    return image


def diamond():
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    points = [(c / 2, 60), (c - 300, c / 2), (c / 2, c - 60), (300, c / 2)]
    pen.polygon(points, fill=(242, 227, 195, 255), outline=(60, 50, 40, 255))
    return image


def reticle(colour):
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    r, m = c / 2 - 30, c / 2
    for a in (45, 135, 225, 315):
        pen.arc((m - r, m - r, m + r, m + r), a - 28, a + 28, fill=(*colour, 255), width=18)
    return image


def shield_arc():
    # Exactly the plus or minus 70 degrees the shield blocks, facing up in the picture.
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    pen.pieslice((40, 40, c - 40, c - 40), -160, -20, fill=(150, 235, 250, 42))
    pen.arc((40, 40, c - 40, c - 40), -160, -20, fill=(190, 245, 255, 255), width=22)
    return image


def landing_ring():
    image = warning(lambda p, c: p.ellipse((14, 14, c - 14, c - 14), fill=255))
    pen, c = ImageDraw.Draw(image), SIZE * SCALE
    for a in (0, 90, 180, 270):
        x, y = c / 2 + math.cos(math.radians(a)) * (c / 2 - 70), c / 2 + math.sin(math.radians(a)) * (c / 2 - 70)
        tip = (c / 2 + math.cos(math.radians(a)) * (c / 2 - 130), c / 2 + math.sin(math.radians(a)) * (c / 2 - 130))
        side = (math.cos(math.radians(a + 90)) * 34, math.sin(math.radians(a + 90)) * 34)
        pen.polygon([tip, (x + side[0], y + side[1]), (x - side[0], y - side[1])], fill=(*ENEMY, 255))
    return image


def foot_line(dashed):
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    box = (40, 40, c - 40, c - 40)
    if dashed:
        for a in range(0, 360, 30):
            pen.arc(box, a, a + 16, fill=(235, 225, 245, 255), width=14)
    else:
        pen.ellipse(box, outline=(235, 225, 245, 255), width=14)
    return image


def gap_ring(gap=60):
    # One ring of the furnace's heat: a thick band with one clear gap, gap degrees wide, facing up in the picture.
    image, c = canvas(), SIZE * SCALE
    pen = ImageDraw.Draw(image)
    pen.arc((30, 30, c - 30, c - 30), -90 + gap / 2, 270 - gap / 2, fill=(*ENEMY, 235), width=70)
    pen.arc((30, 30, c - 30, c - 30), -90 + gap / 2, 270 - gap / 2, fill=(255, 210, 120, 255), width=14)
    return image


def main():
    os.makedirs(OUT, exist_ok=True)
    finish(warning(lambda p, c: p.ellipse((14, 14, c - 14, c - 14), fill=255)), 'warn-circle')
    finish(warning(lambda p, c: p.pieslice((14 - c / 2, 14, c * 1.5 - 14, c * 2 - 14), -115, -65, fill=255)), 'warn-fan')
    finish(warning(lambda p, c: p.rectangle((c * .3, 14, c * .7, c - 14), fill=255)), 'warn-line')
    finish(friendly_ring(), 'friend-ring')
    for softness, name in ((.34, 'shadow-small'), (.26, 'shadow-large')):
        shadow(softness, name)
    finish(double_ring(), 'elite-ring')
    finish(diamond(), 'elite-crest')
    finish(reticle(FRIEND), 'lock')
    finish(shield_arc(), 'shield-arc')
    finish(landing_ring(), 'landing')
    finish(foot_line(False), 'foot-solid')
    finish(foot_line(True), 'foot-dashed')
    finish(gap_ring(), 'heat-ring')
    print(len(os.listdir(OUT)), 'decals')


main()
