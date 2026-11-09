"""Export the hero's stills: python tools/hero_stills.py
ART-008: art-source/extras/face-*.png go to art/hero at 512 and game/public/assets/deepseek-face-<name>-v001.webp at 256, and the calm one is cropped to her head for the avatar.
ART-007: the lower row of the rapier painting is split at its gaps into grip, guard and blade in art/hero/rapier. rapier.json gives each layer's box and the anchors on the whole sword in the upper row. Per-frame tips of the animated sword are in hero.json.
ART-004: every direction of eight key poses from the finished takes, each kept as a layer in art/hero/keypose, and one 2048 sheet of them all at one scale.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

# The layers people work from are kept in the repository, unlike the raw takes.
FINAL, RAPIER, KEYPOSE, RUNTIME = 'art/hero', 'art/hero/rapier', 'art/hero/keypose', 'game/public/assets'
FACES = ('calm', 'firm', 'surprised', 'tired', 'smile')
AVATAR_BOX = (140, 20, 1000, 880)
# Newest first, the same order the atlases are packed in.
TAGS = ('v10', 'v9', 'v7', 'v6', 'v5', 'v4')
DIRECTIONS = ('U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL')
POSES = (('ready', 'idle', 62), ('stride', 'run', 64), ('glide', 'dash', 58), ('coil', 'light1', 27), ('lunge', 'light1', 45), ('deep', 'flurry', 81), ('draw', 'charge', 36), ('release', 'charge', 54))


def faces():
    os.makedirs(FINAL, exist_ok=True)
    for name in FACES:
        image = Image.open(f'art-source/extras/face-{name}.png').convert('RGBA')
        image.resize((512, 512), Image.LANCZOS).save(f'{FINAL}/face-{name}-512.png')
        image.resize((256, 256), Image.LANCZOS).save(f'{RUNTIME}/deepseek-face-{name}-v001.webp', quality=88, method=6)
    avatar = Image.open('art-source/extras/face-calm.png').convert('RGBA').crop(AVATAR_BOX)
    for size in (512, 256, 128):
        avatar.resize((size, size), Image.LANCZOS).save(f'{FINAL}/avatar-{size}.png')


def bands(profile, gap=4):
    """Runs of True in a 1D mask, ignoring gaps of up to gap samples."""
    runs, start, last = [], None, None
    for i, on in enumerate(profile):
        if on:
            if start is None:
                start = i
            elif i - last > gap + 1:
                runs.append((start, last + 1))
                start = i
            last = i
    if start is not None:
        runs.append((start, last + 1))
    return runs


def rapier():
    os.makedirs(RAPIER, exist_ok=True)
    image = Image.open('art-source/extras/rapier.png').convert('RGBA')
    alpha = np.array(image.getchannel('A')) > 128
    rows = bands(alpha.any(axis=1), 8)
    if len(rows) != 2:
        raise SystemExit(f'expected two rows of swords, found {rows}')
    (top0, top1), (low0, low1) = rows
    whole = alpha[top0:top1]
    columns = np.nonzero(whole.any(axis=0))[0]
    left, right = int(columns[0]), int(columns[-1]) + 1
    image.crop((left, top0, right, top1)).save(f'{RAPIER}/whole.png')
    # The pieces overlap column by column, so they are told apart by what touches what.
    labels, count = ndimage.label(alpha[low0:low1], structure=np.ones((3, 3)))
    found = [(np.nonzero(labels == i)[1], np.nonzero(labels == i)[0], i) for i in range(1, count + 1)]
    found = [f for f in found if len(f[0]) > 60]
    blade = max(found, key=lambda f: f[0].max() - f[0].min())
    grip = min((f for f in found if f is not blade), key=lambda f: f[0].min())
    groups = dict(grip=[grip], blade=[blade], guard=[f for f in found if f is not grip and f is not blade])
    if not groups['guard']:
        raise SystemExit('the guard is touching the grip or the blade in the painting')
    layers, boxes = {}, {}
    pixels = np.array(image)
    for name, members in groups.items():
        xs, ys = np.concatenate([m[0] for m in members]), np.concatenate([m[1] for m in members])
        box = (int(xs.min()), low0 + int(ys.min()), int(xs.max()) + 1, low0 + int(ys.max()) + 1)
        keep = np.isin(labels, [m[2] for m in members])
        keep = ndimage.binary_dilation(keep, iterations=3)
        layer = pixels[low0:low1].copy()
        layer[~keep, 3] = 0
        Image.fromarray(layer, 'RGBA').crop((box[0], box[1] - low0, box[2], box[3] - low0)).save(f'{RAPIER}/{name}.png')
        layers[name] = dict(file=f'{name}.png', size=[box[2] - box[0], box[3] - box[1]])
        boxes[name] = box
    # Anchors as fractions of the whole sword, measured where the blade and grip run straight.
    w, h = right - left, top1 - top0
    axis = lambda x: float(np.nonzero(whole[:, x])[0].mean())
    tip_x = right - 3
    shift = left - boxes['grip'][0]
    guard_x = (boxes['guard'][0] + boxes['guard'][2]) / 2 + shift
    grip_x = (boxes['grip'][0] + boxes['grip'][2]) / 2 + shift
    anchors = dict(tip=[round((tip_x - left) / w, 4), round(axis(tip_x) / h, 4)], guard=[round((guard_x - left) / w, 4), round(axis(int(right - w * .2)) / h, 4)], grip=[round((grip_x - left) / w, 4), round(axis(int(grip_x)) / h, 4)])
    with open(f'{RAPIER}/rapier.json', 'w', encoding='utf8', newline='\n') as fh:
        json.dump(dict(size=[w, h], lengthMetres=1.12, anchors=anchors, layers=layers), fh, indent=1)
    print('rapier', w, h, anchors)


def take(action, direction):
    for tag in TAGS:
        if os.path.exists(f'art-source/h3/{action}/{direction}/{tag}/rgba/matte.json'):
            return f'art-source/h3/{action}/{direction}/{tag}/rgba'
    raise SystemExit(f'no take of {action} {direction}')


def keyposes():
    os.makedirs(KEYPOSE, exist_ok=True)
    cell = 2048 // len(DIRECTIONS)
    sheet = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
    with open(f'{RUNTIME}/hero.json', encoding='utf8') as fh:
        actions = json.load(fh)['actions']
    # Takes come in different sizes, so every pose is brought to one scale in pixels per metre, and a lunge is visibly longer than a stance.
    metres = {}
    frames = {}
    for name, action, frame in POSES:
        for d in DIRECTIONS:
            image = Image.open(f'{take(action, d)}/{frame:04d}.png').convert('RGBA')
            image = image.crop(image.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox())
            image.save(f'{KEYPOSE}/{name}_{d}.png')
            frames[name, d] = image
            sheets = actions['charge_start' if action == 'charge' else action]['sheets']
            metres[name, d] = next(s['masterPxPerMetre'] for s in sheets if d in s['directions'])
    widest = max(max(frames[k].size) / metres[k] for k in frames)
    scale = (cell - 8) / widest
    for row, (name, _, _) in enumerate(POSES):
        for column, d in enumerate(DIRECTIONS):
            image, k = frames[name, d], scale / metres[name, d]
            small = image.resize((max(1, round(image.width * k)), max(1, round(image.height * k))), Image.LANCZOS)
            sheet.alpha_composite(small, (column * cell + (cell - small.width) // 2, row * cell + (cell - small.height) // 2))
    sheet.save(f'{KEYPOSE}/sheet.png')
    print('key poses', len(frames), 'at', round(scale), 'px per metre')


faces()
rapier()
keyposes()
