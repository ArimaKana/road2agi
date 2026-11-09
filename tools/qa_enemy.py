"""Check the keyed takes of enemies: python tools/qa_enemy.py [entity or entity_action ...] [--sheet]
Prints one line per take: how many frames, how the figure's height and centre move against its first frame, and whether something other than one figure was keyed. --sheet also writes qa/<take>_<direction>.png, eight frames on the game's floor colour.
A take is flagged when the figure grows, shrinks or wanders far more than its blocking model does, or leaves the frame, which is how a take that went wrong looks.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image

FLOOR = (35, 54, 71, 255)


def box_of(alpha):
    ys, xs = np.nonzero(alpha > 128)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else None


def check(folder, sheet):
    parts = folder.replace('\\', '/').split('/')
    take, direction, tag = parts[-4], parts[-3], parts[-2]
    files = sorted(glob.glob(f'{folder}/[0-9]*.png'))
    boxes, picks = [], [files[i * (len(files) - 1) // 7] for i in range(8)]
    for path in files[::4]:
        alpha = np.array(Image.open(path).getchannel('A'))
        boxes.append(box_of(alpha))
    live = [b for b in boxes if b]
    size = Image.open(files[0]).width
    first = live[0] if live else (0, 0, 1, 1)
    high = [(b[3] - b[1]) / max(1, first[3] - first[1]) for b in live]
    centre = [((b[0] + b[2]) / 2 - (first[0] + first[2]) / 2) / size for b in live]
    edge = sum(b[0] <= 1 or b[1] <= 1 or b[2] >= size - 1 or b[3] >= size - 1 for b in live)
    reference = f'art-source/reference3d/{take}/{take}_{direction}_512.mp4'
    flags = []
    if not take.endswith(('death', 'disappear', 'appear', 'enter', 'collapse')) and (max(high) > 1.7 or min(high) < .45):
        flags.append('SIZE')
    if edge > len(live) * .25:
        flags.append('EDGE')
    if len(live) < len(boxes) * .6:
        flags.append('EMPTY')
    print(f'{take} {direction} {tag}: {len(files)} frames, height {min(high):.2f}-{max(high):.2f}, drift {min(centre):+.2f}{max(centre):+.2f}, at edge {edge}/{len(live)}{" " + ",".join(flags) if flags else ""}', flush=True)
    if sheet:
        os.makedirs('qa', exist_ok=True)
        tile = 256
        out = Image.new('RGBA', (tile * 4, tile * 2), FLOOR)
        for i, path in enumerate(picks):
            image = Image.open(path).convert('RGBA').resize((tile, tile), Image.LANCZOS)
            out.paste(image, (i % 4 * tile, i // 4 * tile), image)
        out.convert('RGB').save(f'qa/{take}_{direction}_{tag}.png')
    return flags


def main():
    sheet = '--sheet' in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith('--')]
    folders = sorted(glob.glob('art-source/h3/*/*/*/rgba/matte.json'))
    flagged = 0
    for matte in folders:
        folder = os.path.dirname(matte)
        take = folder.replace('\\', '/').split('/')[2]
        if not take.split('_')[0][:1] in 'ebd' or (names and not any(take == n or take.startswith(n + '_') for n in names)):
            continue
        flagged += bool(check(folder, sheet))
    print('FLAGGED', flagged)


main()
