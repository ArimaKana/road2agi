"""Lay each card's signature over its art: python tools/card_signature.py kimi:v007 glm:v001

Codex cannot draw a signature to a given size, so it is generated alone on a transparent canvas and placed here.
Reads art-source/cards/<id>-<version>-art.png and <id>-signature-v001.png, writes <id>-<version>.png and <id>-signature-v001-clean.png.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter


CARDS = 'art-source/cards'
BOX = (600, 370)  # on a 1024x1536 card
LEFT, BOTTOM = 120, 1470
# Ink and outline per card: pale ink on dark cards, dark ink on pale ones. The outline keeps the name legible across hair and cloth.
INK = {
    'kimi': ('#ECE8F6', '#1C1E52'), 'glm': ('#ECF1FF', '#10141F'), 'qwen': ('#FFFFFF', '#2F2F73'),
    'seed': ('#3A2FA8', '#F4F2FF'), 'minimax': ('#B5341C', '#FFF3E8'), 'gpt': ('#5A4AA8', '#F8F6FF'),
    'claude': ('#7A2A0C', '#FFF4E2'), 'grok': ('#FFF2F2', '#3A0A14'), 'gemini': ('#F4F0FF', '#1E0F55'),
}


def rgba(colour):
    return tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def signature_mask(path):
    alpha = np.array(Image.open(path).convert('RGBA'))[..., 3].astype(float)
    alpha[alpha < 64] = 0  # Codex leaves a faint halo around the strokes
    ys, xs = np.where(alpha > 128)
    return Image.fromarray(alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype('uint8'), 'L')


def main():
    for job in sys.argv[1:]:
        card, version = job.split(':')
        mask = signature_mask(f'{CARDS}/{card}-signature-v001.png')
        Image.merge('RGBA', [Image.new('L', mask.size, 236)] * 3 + [mask]).save(f'{CARDS}/{card}-signature-v001-clean.png')
        scale = min(BOX[0] / mask.width, BOX[1] / mask.height)
        width, height = round(mask.width * scale), round(mask.height * scale)
        pad = 6
        ink = Image.new('L', (width + 2 * pad, height + 2 * pad), 0)
        ink.paste(mask.resize((width, height), Image.LANCZOS), (pad, pad))
        outline = ink.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(.7))
        art = Image.open(f'{CARDS}/{card}-{version}-art.png').convert('RGBA')
        for colour, layer in zip(reversed(INK[card]), (outline, ink)):
            art.paste(Image.new('RGBA', ink.size, rgba(colour)), (LEFT - pad, BOTTOM - height - pad), layer)
        art.convert('RGB').save(f'{CARDS}/{card}-{version}.png')
        print(f'{card}-{version}.png: signature {width}x{height}')


if __name__ == '__main__':
    main()
