"""Cut the summon creations out of their paintings: python tools/creation_exports.py
Writes game/public/assets/creations/: the film train and its rails, the decoy's four states, and Gemini's three dash poses each way.
"""
import os
from PIL import Image

SOURCE, OUT, SIZE = 'art-source/extras', 'game/public/assets/creations', 384
SHEETS = {
    'train': (2, 2, ['train-L', 'train-R', 'rail-L', 'rail-R']),
    'gemini-dash': (3, 2, ['gemini-L-0', 'gemini-L-1', 'gemini-L-2', 'gemini-R-0', 'gemini-R-1', 'gemini-R-2']),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for sheet, (columns, rows, names) in SHEETS.items():
        image = Image.open(f'{SOURCE}/{sheet}.png').convert('RGBA')
        width, height = image.width // columns, image.height // rows
        for i, name in enumerate(names):
            x, y = i % columns * width, i // columns * height
            cell = image.crop((x, y, x + width, y + height))
            cell.putalpha(cell.getchannel('A').point(lambda a: a if a > 24 else 0))
            cell.resize((SIZE, round(SIZE * height / width)), Image.LANCZOS).save(f'{OUT}/{name}.webp', quality=88, alpha_quality=100, method=6)
    total = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT))
    print(len(os.listdir(OUT)), 'files,', total // 1024, 'KB')


main()
