"""Pack every enemy and boss into one atlas each, and write game/public/assets/enemies.json: python tools/pack_enemies.py
Those with finished takes get their frames, cut to the counts in the art list. The attack take is cut into wind-up, strike and recovery.
Those without yet get a still from their design sheet for every action, so the game can show them now. A later run with the takes replaces it.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

FINAL, H3, REF, OUT = 'art-source/enemies/final', 'art-source/h3', 'art-source/reference3d', 'game/public/assets/enemies'
PX_PER_METRE, TAGS = 64, ('v3', 'v2', 'v1')
SIDES, ELITE_SIDES = ('L', 'R'), ('UL', 'UR', 'DL', 'DR')
# A boss's two sides are the front three-quarter views of its turnaround sheet, the same way an ordinary enemy is drawn.
BOSS_SIDES = {'L': (0, 2), 'R': (2, 2)}
# The statue and Claude are one painting: runaway, winding up, staggered and freed, drawn to one registration. It is close to the camera for its size, so it keeps more pixels.
ICON_STATES, ICON_DETAIL, ICON_CENTRE, ICON_FOOT = {'idle': 0, 'move': 0, 'windup': 1, 'attack': 1, 'recover': 0, 'hit': 0, 'death': 3, 'stagger': 2, 'freed': 3}, 1.5, .51, 590
# action: (source take, frames on the reference timeline, loops)
PICKS = {
    'idle': ('idle', (62, 77, 93), True), 'move': ('move', (48, 60, 72), True),
    'windup': ('attack', (22, 40), False), 'attack': ('attack', (50, 56, 66), False), 'recover': ('attack', (90, 112), False),
    'hit': ('hit', (16, 34), False), 'death': ('death', (22, 54, 110), False),
}
# The picture counts of the art list. A boss has its own moves, cut from their takes at the key frames of their blocking models.
BOSS_FRAMES = {
    'b01': dict(idle=4, move=4, rush=5, slam=5, sweep=6, adds_cast=5, stagger=4, phase_change=7, death=8, enter=7),
    'b02': dict(idle=4, move=4, prism_lance=6, mirror_split=7, mirror_sweep=7, decoy_break=4, stagger=4, phase_change=7, death=8, enter=7),
    'b03': dict(idle=4, sweep=6, stamp=6, ritual=7, arm_break=5, stagger=4, phase_change=8, death=9, enter=7),
    'b04': dict(idle=5, ring_fire=7, sector_pulse=7, core_beam=8, collapse=8, expose=5, stagger=4, phase_change=8, death=12, enter=8),
    # Seed's doll is packed the same way, though it is no boss.
    'decoy': dict(idle=4, appear=3, hit=2, disappear=3),
}
# What an ordinary enemy does beyond the seven base actions: (source take, pictures). Most of it is the attack take, cut whole.
SPECIALS = {
    'e02': dict(shield_break=('shieldbreak', 3)), 'e02e': dict(shield_break=('shieldbreak', 3), stomp=('stomp', 4)), 'e04': dict(summon=('attack', 4)), 'e05': dict(split=('split', 4)), 'e07': dict(drop_mine=('attack', 3)),
    'e08': dict(teleport=('leap', 4)), 'e09': dict(combo=('attack', 4)), 'e09e': dict(combo=('attack', 4)), 'e10': dict(overheat=('attack', 4)), 'e11': dict(link=('attack', 3)), 'e12': dict(memory_cut=('attack', 4)), 'e12e': dict(memory_cut=('attack', 4)),
}
KEYS = json.loads(open('tools/h3-prompts/action_keys.json', encoding='utf8').read())
MAX_ATLAS, DETAIL = 4096, {'b03': 1.5}
# Stills: how tall the figure stands on screen, in the same projected metres as the hero (about 1.47).
ENTITIES = {
    'e01': .6, 'e02': 1.5, 'e03': 1.1, 'e04': 1.5, 'e05': 1.45, 'e06': 1.45, 'e07': 1.2, 'e08': 1.4, 'e09': 1.6, 'e10': 1.4, 'e11': 1.0, 'e12': 1.75,
    'e02e': 1.75, 'e06e': 1.65, 'e09e': 1.85, 'e12e': 2.0, 'b01': 2.6, 'b02': 3.0, 'b03': 5.2, 'b04': 3.4, 'decoy': 1.5,
}


def take(entity, source, direction):
    for tag in TAGS:
        folder = f'{H3}/{entity}_{source}/{direction}/{tag}/rgba'
        if os.path.exists(f'{folder}/matte.json'):
            return folder
    return None


def alpha_box(image):
    return image.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()


def still_cells(entity):
    """The picture of each direction from the design sheets, as for the first frame of a take."""
    if entity.startswith('b'):
        sheet, spots, grid = f'{FINAL}/{entity}-turn.png', BOSS_SIDES, 3
    elif entity.endswith('e'):
        sheet, spots, grid = f'{FINAL}/{entity}-idle.png', dict(zip(ELITE_SIDES, ((0, 0), (1, 0), (0, 1), (1, 1)))), 2
    else:
        sheet, spots, grid = f'{FINAL}/{entity}.png', {'L': (0, 0), 'R': (1, 0)}, 2
    image = Image.open(sheet).convert('RGBA')
    cell = image.width // grid
    out = {}
    for d, (x, y) in spots.items():
        part = image.crop((x * cell, y * cell, (x + 1) * cell, (y + 1) * cell))
        part.putalpha(part.getchannel('A').point(lambda a: a if a > 110 else 0))
        out[d] = part.crop(alpha_box(part))
    return out


def pack_still(entity, metres):
    cells = still_cells(entity)
    scale = metres * PX_PER_METRE / max(c.height for c in cells.values())
    small = {d: c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.LANCZOS) for d, c in cells.items()}
    width, height = max(c.width for c in small.values()) + 4, max(c.height for c in small.values()) + 4
    directions = list(small)
    columns = int(np.ceil(len(directions) ** .5))
    rows = int(np.ceil(len(directions) / columns))
    atlas = Image.new('RGBA', (columns * width, rows * height), (0, 0, 0, 0))
    for i, d in enumerate(directions):
        c = small[d]
        atlas.paste(c, (i % columns * width + (width - c.width) // 2, i // columns * height + height - c.height - 2))
    return atlas, dict(directions=directions, columns=columns, rows=rows, cell=[width, height], anchor=[.5, 2 / height], metres=[width / PX_PER_METRE, height / PX_PER_METRE], top=height / PX_PER_METRE, frames=1, actions={a: dict(start=0, frames=1, loop=False) for a in PICKS}, moving=False)


def pack_icon(entity, metres):
    image = Image.open(f'{FINAL}/{entity}.png').convert('RGBA')
    cell = image.width // 2
    parts = []
    for y in range(2):
        for x in range(2):
            part = image.crop((x * cell, y * cell, (x + 1) * cell, (y + 1) * cell))
            # The model leaves stray specks well away from the figure.
            solid = np.array(part.getchannel('A')) > 110
            labels, count = ndimage.label(solid)
            sizes = ndimage.sum(solid, labels, range(1, count + 1))
            keep = np.isin(labels, [i + 1 for i, size in enumerate(sizes) if size >= 200])
            part.putalpha(Image.fromarray((np.array(part.getchannel('A')) * keep).astype('uint8')))
            parts.append(part)
    boxes = [alpha_box(p) for p in parts]
    left, top, right, bottom = min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)
    standing = ICON_FOOT - boxes[0][1]
    scale = metres * PX_PER_METRE * ICON_DETAIL / standing
    width, height = round((right - left) * scale) + 4, round((bottom - top) * scale) + 4
    atlas = Image.new('RGBA', (width * 2, height * 2), (0, 0, 0, 0))
    for i, part in enumerate(parts):
        small = part.crop((left, top, right, bottom)).resize((width - 4, height - 4), Image.LANCZOS)
        atlas.paste(small, (i % 2 * width + 2, i // 2 * height + 2))
    per_metre = PX_PER_METRE * ICON_DETAIL
    return atlas, dict(directions=['D'], columns=2, rows=2, cell=[width, height], anchor=[(ICON_CENTRE * cell - left) * scale / width, ((bottom - ICON_FOOT) * scale + 2) / height], metres=[width / per_metre, height / per_metre], top=standing * scale / per_metre, frames=4, actions={a: dict(start=s, frames=1, loop=False) for a, s in ICON_STATES.items()}, moving=False)


def cut_at_keys(keys, count, strike=None):
    """count frames from a clip's key frames: drop the closest neighbours, or fill the widest gaps. The strike always stays."""
    points = sorted(set(keys))
    if len(points) > count and points[0] == 0:
        points = points[1:]
    while len(points) > count:
        gaps = [(points[i + 1] - points[i - 1], i) for i in range(1, len(points) - 1) if points[i] != strike]
        points.pop(min(gaps)[1] if gaps else -1)
    while len(points) < count:
        widest = max(range(len(points) - 1), key=lambda i: points[i + 1] - points[i])
        points.insert(widest + 1, (points[widest] + points[widest + 1]) // 2)
    return tuple(points)


def actions_of(entity):
    """action: (source take, frames on the reference timeline, loops, index of the strike frame)."""
    keys = KEYS.get(entity, {})
    if entity in BOSS_FRAMES:
        out = {}
        for action, count in BOSS_FRAMES[entity].items():
            source = keys[action]['keys']
            if action in ('idle', 'move'):
                lo, hi = (62, 93) if action == 'idle' else (48, 80)
                out[action] = (action, tuple(lo + (hi - lo) * i // max(1, count - 1) for i in range(count)), True, 0)
            else:
                strike = source[2]
                frames = cut_at_keys(source, count, strike)
                out[action] = (action, frames, False, frames.index(strike))
        return out
    out = {action: (*pick, 0) for action, pick in PICKS.items()}
    out['windup'] = (*PICKS['windup'], len(PICKS['windup'][1]))
    for action, (source, count) in SPECIALS.get(entity, {}).items():
        strike = keys[source]['keys'][2]
        frames = cut_at_keys(keys[source]['keys'], count, strike)
        out[action] = (source, frames, False, frames.index(strike))
    return out


def on_take(entity, d, spot, source, size):
    """A cell of the design sheet, placed on a take the way fit_enemy_pose.py places the first picture."""
    sheet = Image.open(f'{FINAL}/{entity}.png').convert('RGBA')
    cell = sheet.width // 2
    drawing = sheet.crop((spot[0] * cell, spot[1] * cell, (spot[0] + 1) * cell, (spot[1] + 1) * cell))
    drawing.putalpha(drawing.getchannel('A').point(lambda a: a if a > 110 else 0))
    first = sheet.crop((0, 0, cell, cell))
    box = first.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
    frame = np.array(Image.open(f'{REF}/{entity}_{source}/frames/{d}/0000.png').convert('RGBA'))
    ys, xs = np.nonzero(frame[..., 3] > 128)
    k = size / frame.shape[0]
    left, right, top, bottom = xs.min() * k, (xs.max() + 1) * k, ys.min() * k, (ys.max() + 1) * k
    scale = ((right - left) * (bottom - top) / ((box[2] - box[0]) * (box[3] - box[1]))) ** .5
    small = drawing.resize((round(cell * scale), round(cell * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(small, (round((left + right - (box[2] - box[0]) * scale) / 2 - box[0] * scale), round(bottom - box[3] * scale)), small)
    return canvas


def body_centre(folder, frame):
    a = np.array(Image.open(f'{folder}/{frame:04d}.png').getchannel('A')) > 128
    ys, xs = np.nonzero(a)
    return xs.mean(), ys.mean()


def pack_takes(entity, directions):
    picks = actions_of(entity)
    frames, reference = [], {}
    for source in {p[0] for p in picks.values()}:
        with open(f'{REF}/{entity}_{source}/frames/reference.json', encoding='utf8') as fh:
            reference[source] = json.load(fh)
    extent = [0, 0, 0, 0]
    loaded = {}
    standing = 0
    for action, (source, pick, _, _) in picks.items():
        for d in directions:
            folder = take(entity, source, d)
            for f in pick:
                image = Image.open(f'{folder}/{f:04d}.png').convert('RGBA')
                k = image.width / reference[source]['resolution']
                root = [v * k for v in reference[source]['directions'][d]['rootPx']]
                # A rush or a lunge moves the model across its take, and the rules move the enemy as well, so the picture would go twice as far and snap back. The body stays on its root here.
                if KEYS.get(entity, {}).get(source, {}).get('travel'):
                    at, start = body_centre(folder, f), body_centre(folder, 0)
                    root = [root[0] + at[0] - start[0], root[1] + at[1] - start[1]]
                box = alpha_box(image)
                metre = reference[source]['directions'][d]['pxPerMeter'] * k
                if box:
                    extent = [min(extent[0], (box[0] - root[0]) / metre), min(extent[1], (box[1] - root[1]) / metre), max(extent[2], (box[2] - root[0]) / metre), max(extent[3], (box[3] - root[1]) / metre)]
                    if action == 'idle':
                        standing = max(standing, (root[1] - box[1]) / metre)
                loaded[action, d, f] = (image, root, metre)
    if entity == 'b03':
        # The statue's last moment is a painting, not a take: the machine dead and her free.
        d, source = directions[0], 'idle'
        image = on_take(entity, d, (1, 1), source, Image.open(f'{take(entity, source, d)}/0000.png').width)
        k = image.width / reference[source]['resolution']
        loaded['freed', d, 0] = (image, [v * k for v in reference[source]['directions'][d]['rootPx']], reference[source]['directions'][d]['pxPerMeter'] * k)
        picks['freed'] = (source, (0,), False, 0)
    left, top, right, bottom = extent
    count = sum(len(p[1]) for p in picks.values())
    # A boss's model is blocked out at whatever size read well, so its idle pose sets how many of those metres make its height in the design.
    world = ENTITIES[entity] / standing if entity in BOSS_FRAMES else 1
    # What a phone can hold decides the detail of the biggest.
    px = PX_PER_METRE * DETAIL.get(entity, 1) / world
    while True:
        width, height = int(np.ceil((right - left) * px)) + 4, int(np.ceil((bottom - top) * px)) + 4
        columns = int(np.ceil((count * len(directions) * height / width) ** .5))
        rows = int(np.ceil(count * len(directions) / columns))
        if max(columns * width, rows * height) <= MAX_ATLAS:
            break
        px *= .95
    atlas = Image.new('RGBA', (columns * width, rows * height), (0, 0, 0, 0))
    actions = {}
    for di, d in enumerate(directions):
        at = di * count
        for action, (source, pick, loop, hit) in picks.items():
            if di == 0:
                actions[action] = dict(start=at, frames=len(pick), loop=loop, hit=hit)
            for f in pick:
                image, root, metre = loaded[action, d, f]
                s = px / metre
                small = image.resize((round(image.width * s), round(image.height * s)), Image.LANCZOS)
                x, y = at % columns * width + 2 + round((-left - root[0] / metre) * px), at // columns * height + 2 + round((-top - root[1] / metre) * px)
                sx, sy = at % columns * width, at // columns * height
                crop = small.crop((sx - x, sy - y, sx - x + width, sy - y + height))
                atlas.paste(crop, (sx, sy), crop)
                at += 1
    return atlas, dict(directions=list(directions), columns=columns, rows=rows, cell=[width, height], anchor=[(-left) * px / width, 1 - (-top) * px / height], metres=[width / px * world, height / px * world], top=standing * world, frames=count, actions=actions, moving=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = dict(pxPerMetre=PX_PER_METRE, entities={})
    for entity, metres in ENTITIES.items():
        directions = ELITE_SIDES if entity.endswith('e') else SIDES
        if entity in ('b03', 'decoy'):
            directions = ('D',)
        whole = all(take(entity, p[0], d) for p in actions_of(entity).values() for d in directions)
        if entity == 'decoy' and not whole:
            continue
        atlas, entry = pack_takes(entity, directions) if whole else pack_icon(entity, metres) if entity == 'b03' else pack_still(entity, metres)
        name = f'{entity}.webp'
        atlas.save(f'{OUT}/{name}', quality=88, alpha_quality=100, method=6)
        entry['file'] = f'enemies/{name}'
        manifest['entities'][entity] = entry
        print(entity, 'takes' if whole else 'still', atlas.size, entry['cell'], f"{os.path.getsize(f'{OUT}/{name}') // 1024} KB")
    with open('game/public/assets/enemies.json', 'w', encoding='utf8', newline='\n') as fh:
        json.dump(manifest, fh, indent=1)
    print('total', sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT)) // 1024, 'KB')


main()
