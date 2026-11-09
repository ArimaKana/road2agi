"""The non-humanoid enemies as blocking models built from plain solids, and their actions.

A model is a list of parts; an action says where every part is on every frame. Positions are in the creature's starting frame (see C), so a lunge simply lands further along.
Sizes follow the design sheets in art-source/enemies/final, with the heroine at 1.8 m. Every action leaves from and returns to frame 0 of idle, so any two join without a pop; death is the one that does not come back.
"""
import math
from mathutils import Euler, Matrix, Vector


def C(r, f, u):
    """Creature axes (its right, forward, up) to world metres. It faces -Y, like the mannequin."""
    return Vector((-r, -f, u))


def solid(position, size, turn=(0, 0, 0)):
    """World matrix of a unit solid. turn is degrees of pitch, roll and yaw."""
    return Matrix.LocRotScale(position, Euler(tuple(math.radians(a) for a in turn)), Vector(size if isinstance(size, tuple) else (size, size, size)))


def ease(kind, t):
    if kind == 'in':
        return t * t * t
    if kind == 'out':
        return 1 - (1 - t) ** 3
    if kind == 'linear':
        return t
    return t * t * (3 - 2 * t)


def track(keys, frame):
    """A value over time from (frame, value) or (frame, value, easing into it) keys."""
    if frame <= keys[0][0]:
        return keys[0][1]
    for a, b in zip(keys, keys[1:]):
        if frame <= b[0]:
            return a[1] + (b[1] - a[1]) * ease(b[2] if len(b) > 2 else 'smooth', (frame - a[0]) / (b[0] - a[0]))
    return keys[-1][1]


def tracks(channels, frame):
    return {name: track(keys, frame) for name, keys in channels.items()}


FRAMES, FPS, BREATH = 124, 24, 62
breath = lambda frame: (1 - math.cos(2 * math.pi * frame / BREATH)) / 2


# ---- E01 Noise Worm: seven cubes in an S curve, head first. ----
WORM_SIZES = (.30, .27, .25, .22, .19, .16, .13)
# Where each cube sits when the body bunches up behind the head, around the middle of the clump.
WORM_CLUMP = ((0, .36, .20), (-.20, .08, .12), (.20, .04, .14), (.02, .10, .34), (-.14, -.17, .24), (.15, -.17, .22), (0, -.16, .05))
WORM_SPIN = ((0, 0, 0), (0, 20, 35), (15, 0, -25), (30, 10, 10), (-15, 25, 50), (20, -20, -40), (10, 30, 20))
WORM_FLY = ((.1, .5, .55), (-.75, .15, .25), (.8, .05, .3), (.25, -.3, .7), (-.6, -.6, .3), (.65, -.55, .2), (0, -.9, .15))


def worm(curve=.10, phase=0., gather=0., lift=0., pitch=0., swell=0., forward=0., hump=0., hump_phase=0., squash=0., scatter=0., back=0., stretch=1.):
    parts, along = {}, 0.
    for i, size in enumerate(WORM_SIZES):
        if i:
            along += (WORM_SIZES[i - 1] + size) / 2 * 1.06 * stretch
        rise = hump * max(0, math.sin(along * 5.5 - hump_phase))
        laid_out = C(curve * math.sin(along * 3.2 + phase), .58 - along, size / 2 * (1 - squash) + rise)
        r, f, u = WORM_CLUMP[i]
        bunched = C(r * 1.3, f * 1.25 + .05, u * 1.25 + .1)
        at = laid_out.lerp(bunched, gather) + C(0, forward - back, 0)
        if i == 0:
            at += C(0, 0, lift)
        r, f, u = WORM_FLY[i]
        at += C(r, f, u * (1 - scatter)) * scatter * 1.1
        at.z = max(at.z, size * .35)
        spin = WORM_SPIN[i]
        turn = (gather * spin[0] + (pitch if i == 0 else 0) + scatter * 70 * spin[0] / 30, gather * spin[1], gather * spin[2] - curve * 90 * math.cos(along * 3.2 + phase))
        grow = size * (1 + swell * (i > 0)) * (1 - .45 * scatter)
        parts[f'seg{i}'] = solid(at, (grow, grow, grow * (1 - squash)), turn)
    return parts


def worm_idle(frame):
    w = breath(frame)
    return worm(curve=.10 + .025 * w, phase=.5 * w, lift=.03 * w, swell=.05 * w, pitch=-6 * w)


def worm_move(frame):
    # In place, the game supplies the speed: a hump runs from the head to the tail, one cycle in 48 frames. It eases in from the hub pose.
    blend = min(1, frame / 24)
    return worm(curve=.10 + .03 * blend, phase=2 * math.pi * frame / 48 * blend * .5, hump=.16 * blend, hump_phase=2 * math.pi * frame / 48)


WORM_POUNCE = 2.33  # 3.5 world units, as far as the simulation's pounce.
WORM_ATTACK = dict(
    # Bunch up and swell, hold while shaking, shoot out flat along a line, lie there, then gather back into the hub pose where it landed.
    gather=[(0, 0), (12, 0), (30, 1, 'out'), (46, 1), (52, 0, 'out')],
    lift=[(0, 0), (12, 0), (30, .24, 'out'), (46, .24), (50, .18), (56, 0), (124, 0)],
    pitch=[(0, 0), (12, 0), (30, -28), (46, -28), (52, 8), (66, 0)],
    swell=[(0, 0), (12, 0), (30, .42, 'out'), (46, .5), (52, 0, 'out')],
    forward=[(0, 0), (46, 0), (54, WORM_POUNCE, 'out')],
    curve=[(0, .10), (12, .10), (46, .02), (54, 0), (78, 0), (106, .10)],
    stretch=[(0, 1), (46, 1), (52, 1.5, 'out'), (60, 1.1), (78, 1), (124, 1)],
    squash=[(0, 0), (52, 0), (58, .28, 'out'), (78, .28), (92, 0)],
)


def worm_attack(frame):
    p = tracks(WORM_ATTACK, frame)
    shake = .012 * math.sin(frame * 2.4) if 30 <= frame <= 46 else 0
    return worm(**dict(p, forward=p['forward'] + shake))


WORM_HIT = dict(back=[(0, 0), (10, 0), (15, .26, 'out'), (44, 0)], squash=[(0, 0), (10, 0), (14, .3, 'out'), (24, .05), (44, 0)], lift=[(0, 0), (10, 0), (15, .12, 'out'), (30, 0)], pitch=[(0, 0), (10, 0), (15, -35, 'out'), (44, 0)])
WORM_DEATH = dict(back=[(0, 0), (10, 0), (18, .3, 'out')], squash=[(0, 0), (10, 0), (16, .3, 'out')], scatter=[(0, 0), (18, 0), (44, 1, 'out'), (124, 1)], curve=[(0, .10), (18, .10), (44, .2)])
WORM = dict(
    ortho=4.4,
    side_on=25,  # The sheet draws it long and low, nearer the side than a true three-quarter.
    parts=[('seg0', 'box', 'head')] + [(f'seg{i}', 'box', 'body') for i in range(1, 7)],
    colours=dict(head=(.30, .74, .80), body=(.20, .28, .40)),
    actions=dict(
        idle=dict(pose=worm_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=worm_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=worm_attack, travel=WORM_POUNCE, keys=(0, 30, 46, 50, 54, 70, 110)),
        hit=dict(pose=lambda frame: worm(**tracks(WORM_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: worm(**tracks(WORM_DEATH, frame)), travel=0, keys=(0, 15, 30, 60)),
    ),
)

def bar(a, b, thick):
    """A unit box or cylinder stretched between two points."""
    d = b - a
    return Matrix.LocRotScale((a + b) / 2, d.to_track_quat('Z', 'Y'), Vector((thick, thick, max(d.length, 1e-3))))


def two_bone(root, target, len_a, len_b, pole):
    """The joint of a two-segment limb reaching from root toward target, bending to the pole side."""
    to = target - root
    d = min(max(to.length, abs(len_a - len_b) + 1e-3), (len_a + len_b) * .999)
    u = to.normalized()
    cos_a = (len_a * len_a + d * d - len_b * len_b) / (2 * len_a * d)
    n = (pole - u * pole.dot(u)).normalized()
    return root + u * (len_a * cos_a) + n * (len_a * math.sqrt(max(0., 1 - cos_a * cos_a))), root + u * d


def limb(parts, name, root, target, len_a, len_b, pole, thick):
    joint, end = two_bone(root, target, len_a, len_b, pole)
    parts[f'{name}a'], parts[f'{name}b'] = bar(root, joint, thick), bar(joint, end, thick * .8)
    return end


def blended(frame, cycle=48, ease_in=24):
    """How far a walk on the spot has eased in from the hub pose, and where it is in its cycle."""
    return min(1, frame / ease_in), 2 * math.pi * frame / cycle


def stride(phase, length, lift):
    """A foot going round: on the ground for half the cycle, in the air for the other half."""
    phase %= 2 * math.pi
    return length * math.cos(phase), lift * math.sin(phase - math.pi) if phase > math.pi else 0.


# ---- E03 Junk Courier: a parcel on bird legs, with a stack strapped to its back. ----
def courier(rise=0., pitch=6., bob=0., spread=0., swing=0., reach=0., bundle=0., ahead=0., throw=0., lfoot=(0, 0), rfoot=(0, 0), topple=0.):
    parts, pivot = {}, C(0, 0, 1.15 + rise + bob)
    tilt = Matrix.Rotation(math.radians(-pitch), 4, 'X')
    on_body = lambda r, f, u: pivot + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (-pitch, 0, 0)
    parts['body'] = solid(pivot, (.8, .8, .72), turn)
    parts['tape'] = solid(on_body(0, 0, .37), (.82, .13, .03), turn)
    parts['lens'] = solid(on_body(0, .42, 0), (.26, .26, .08), (90 - pitch, 0, 0))
    for i, (f, u, size) in enumerate(((-.58, .06, (.5, .42, .44)), (-.46, .44, (.54, .4, .3)), (-.34, .7, (.34, .3, .24)))):
        at = on_body(0, f, u) + C(.3 * topple * (i - 1), -.5 * topple, -.45 * topple * (i + 1))
        parts[f'stack{i}'] = solid(at, size, (-pitch - 40 * topple * (i + 1), 0, 20 * topple))
    for side, name, (f, u) in ((1, 'r', rfoot), (-1, 'l', lfoot)):
        hip = pivot + C(side * .24, 0, -.36)
        foot = C(side * (.27 + .2 * spread), f + side * .28 * spread, .05 + u)
        end = limb(parts, f'{name}leg', hip, foot, .42, .46, C(side * .25, -.25, .1), .08)
        parts[f'{name}foot'] = solid(end + C(0, .05, -.02), (.2, .3, .05))
    for side, name, sw in ((1, 'r', swing), (-1, 'l', -swing)):
        shoulder = pivot + C(side * .46, .1, -.04)
        hang = C(side * .62, .1 + sw, .4 + rise + bob)
        up = C(side * .26, .12 + ahead, 2.04 + rise)
        back = pivot + C(side * .4, -.5, .4)
        hand = hang.lerp(back, min(1, reach * 2)) if reach < .5 else back.lerp(up, (reach - .5) * 2)
        end = limb(parts, f'{name}arm', shoulder, hand, .5, .5, C(side * .5, 0, -.1) if reach < .5 else C(side * .5, 0, .2), .075)
        parts[f'{name}hand'] = solid(end, .13)
    if bundle > 0:
        centre = C(0, .12 + ahead + throw * 1.6, 2.24 + rise - throw * .5)
        for i in range(3):
            parts[f'pack{i}'] = solid(centre + C(0, 0, (i - 1) * .14), (.62 * bundle, .38 * bundle, .13 * bundle), (-pitch * .4, 0, 0))
    return parts


def courier_idle(frame):
    w = breath(frame)
    return courier(bob=-.02 * w, pitch=6 + 1.5 * w)


def courier_move(frame):
    # On the spot, the game supplies the speed.
    k, phase = blended(frame)
    rf, ru = stride(phase, .3, .16)
    lf, lu = stride(phase + math.pi, .3, .16)
    return courier(pitch=6 + 6 * k, bob=.03 * k * math.cos(2 * phase) - .03 * k, swing=.14 * k * math.cos(phase), rfoot=(rf * k, ru * k), lfoot=(lf * k, lu * k))


COURIER_ATTACK = dict(
    # Reach back for a bundle, heave it overhead and brace, throw it forward, stumble and settle.
    reach=[(0, 0), (10, 0), (20, .5), (34, 1, 'out'), (46, 1), (53, .45, 'in'), (80, 0)],
    bundle=[(0, 0), (19, 0), (21, 1, 'out'), (50, 1), (55, 0)],
    pitch=[(0, 6), (10, 6), (34, -16, 'out'), (46, -18), (52, 22, 'in'), (66, 18), (100, 6)],
    rise=[(0, 0), (20, 0), (34, -.2, 'out'), (46, -.22), (52, -.14), (66, -.1), (100, 0)],
    spread=[(0, 0), (20, 0), (34, 1, 'out'), (66, 1), (100, 0)],
    ahead=[(0, 0), (46, 0), (52, .5, 'in'), (60, .7)],
    throw=[(0, 0), (46, 0), (55, 1, 'in')],
)
COURIER_HIT = dict(pitch=[(0, 6), (10, 6), (15, -16, 'out'), (46, 6)], rise=[(0, 0), (10, 0), (15, -.1, 'out'), (46, 0)], spread=[(0, 0), (10, 0), (15, .5, 'out'), (46, 0)])
COURIER_DEATH = dict(pitch=[(0, 6), (10, 6), (18, -18, 'out'), (46, -62, 'in'), (124, -62)], rise=[(0, 0), (18, -.1), (46, -.62, 'in'), (124, -.62)], spread=[(0, 0), (10, 0), (46, 1.6)], topple=[(0, 0), (30, 0), (56, 1, 'out')])
COURIER = dict(
    ortho=3.8,
    parts=[('body', 'box', 'card'), ('tape', 'box', 'tape'), ('lens', 'cyl', 'lens')] + [(f'stack{i}', 'box', 'card') for i in range(3)]
    + [(f'{s}{p}', 'cyl', 'metal') for s in 'rl' for p in ('lega', 'legb', 'arma', 'armb')] + [(f'{s}{p}', 'box', 'metal') for s in 'rl' for p in ('foot', 'hand')] + [(f'pack{i}', 'box', 'lens') for i in range(3)],
    colours=dict(card=(.50, .33, .17), tape=(.10, .13, .22), metal=(.08, .09, .14), lens=(.45, .68, .88)),
    actions=dict(
        idle=dict(pose=courier_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=courier_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda frame: courier(**tracks(COURIER_ATTACK, frame)), travel=0, keys=(0, 20, 34, 46, 52, 66, 110)),
        hit=dict(pose=lambda frame: courier(**tracks(COURIER_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: courier(**tracks(COURIER_DEATH, frame)), travel=0, keys=(0, 18, 34, 70)),
    ),
)


# ---- E07 Cache Jellyfish: a faceted bell over a chip, hanging six thin tentacles. ----
def jelly(float_z=0., squeeze=0., deflate=0., mine=0., drop=0., curl=0., sway=0., lean=0., back=0.):
    parts = {}
    wide, tall = 1.32 * (1 - .28 * squeeze) * (1 + .25 * deflate), .92 * (1 + .75 * squeeze) * (1 - .6 * deflate)
    centre = C(0, -back, 1.32 + float_z + .2 * squeeze - 1.05 * deflate)
    parts['bell'] = solid(centre, (wide, wide, tall), (lean, 0, 0))
    parts['chip'] = solid(centre + C(0, .06, tall * .36 - .2 * squeeze), (.8 * (1 - .22 * squeeze), .8 * (1 - .22 * squeeze), .12), (lean, 0, 0))
    grip = C(.04, .28, .5 + float_z) + C(0, -back, 0)
    for i in range(6):
        a = math.radians(30 + 60 * i)
        root = centre + C(math.cos(a) * wide * .34, math.sin(a) * wide * .3, -tall * .4)
        tip = C(math.cos(a) * .5 + sway * .2, math.sin(a) * .4 - back, max(.04, root.z - .92 + deflate * .2))
        tip = tip.lerp(grip + C(math.cos(a) * .2, math.sin(a) * .2, 0), curl)
        out = C(math.cos(a), math.sin(a), 0)
        joint, end = two_bone(root, tip, .5, .5, out * (.15 + curl))
        parts[f'ten{i}a'], parts[f'ten{i}b'] = bar(root, joint, .05), bar(joint, end, .04)
        parts[f'bead{i}'] = solid(joint, .1)
    if mine > 0:
        at = grip + C(0, 0, -drop * (grip.z - .2))
        parts['mine'] = solid(at, .4 * mine)
        for i, d in enumerate(((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))):
            parts[f'spike{i}'] = solid(at + C(*d) * .23 * mine, .09 * mine, (45, 45, 0))
    return parts


def jelly_idle(frame):
    w = breath(frame)
    return jelly(float_z=.05 * w, sway=.2 * math.sin(2 * math.pi * frame / BREATH), squeeze=.03 * w)


def jelly_move(frame):
    k, phase = blended(frame)
    return jelly(float_z=.1 * k * math.sin(phase), squeeze=.16 * k * (1 + math.cos(phase)) / 2, sway=.6 * k * math.sin(phase), lean=6 * k)


JELLY_ATTACK = dict(
    # Squeeze tall and narrow with the tentacles curling round a new mine, hold it, let it fall, spring back.
    squeeze=[(0, 0), (10, 0), (30, 1, 'out'), (48, 1), (56, .1, 'out'), (68, .25), (100, 0)],
    curl=[(0, 0), (10, 0), (30, 1, 'out'), (48, 1), (56, .1, 'out'), (92, 0)],
    mine=[(0, 0), (16, 0), (30, 1, 'out'), (62, 1), (68, 0)],
    drop=[(0, 0), (48, 0), (60, 1, 'in')],
    float_z=[(0, 0), (48, 0), (56, .16, 'out'), (92, 0)],
)
JELLY_HIT = dict(back=[(0, 0), (10, 0), (15, .22, 'out'), (46, 0)], deflate=[(0, 0), (10, 0), (15, .18, 'out'), (34, 0)], lean=[(0, 0), (10, 0), (15, -14, 'out'), (46, 0)], sway=[(0, 0), (10, 0), (15, 1, 'out'), (46, 0)])
JELLY_DEATH = dict(back=[(0, 0), (10, 0), (15, .2, 'out')], deflate=[(0, 0), (10, 0), (15, .2, 'out'), (56, 1, 'in'), (124, 1)], sway=[(0, 0), (15, 1), (56, 0)])
JELLY = dict(
    ortho=3.6,
    parts=[('bell', 'facet', 'bell'), ('chip', 'cyl', 'chip'), ('mine', 'ball', 'chip')] + [(f'spike{i}', 'box', 'chip') for i in range(6)]
    + [(f'ten{i}{p}', 'cyl', 'tentacle') for i in range(6) for p in 'ab'] + [(f'bead{i}', 'box', 'chip') for i in range(6)],
    colours=dict(bell=(.42, .38, .56), chip=(.72, .72, .76), tentacle=(.45, .45, .5)),
    actions=dict(
        idle=dict(pose=jelly_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=jelly_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda frame: jelly(**tracks(JELLY_ATTACK, frame)), travel=0, keys=(0, 30, 48, 56, 64, 110)),
        hit=dict(pose=lambda frame: jelly(**tracks(JELLY_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: jelly(**tracks(JELLY_DEATH, frame)), travel=0, keys=(0, 15, 36, 70)),
    ),
)


# ---- E10 Annealing Furnace: a fat iron boiler with a glowing mouth; the radiator fins fan out when it heats up. ----
FIN_ROWS = [('top', k) for k in range(5)] + [('right', k) for k in range(4)] + [('left', k) for k in range(4)]


def furnace(open_fins=0., squash=0., pulse=0., roll=0., steps=(0, 0), sag=0., back=0., fall=0.):
    parts = {}
    tall = 1.55 * (1 - .14 * squash - .1 * sag - .35 * fall) * (1 + .05 * pulse)
    wide = 1.85 * (1 + .08 * squash + .05 * pulse + .08 * fall)
    z = tall / 2 + .1 * (1 - fall)
    centre = C(0, -back, z)
    parts['boiler'] = solid(centre, (wide, tall, 1.5), (90, roll, 0))
    parts['rim'] = solid(centre + C(0, .78, -.14), (1.08, 1.08, .22), (90, 0, 0))
    parts['mouth'] = solid(centre + C(0, .88, -.14), (.8, .8, .06), (90, 0, 0))
    # The fan is centred on the back of the boiler; a closed fin lies flat along the body.
    hub = centre + C(0, -.2, .1)
    for i, (row, k) in enumerate(FIN_ROWS):
        side = {'top': 0, 'right': 1, 'left': -1}[row]
        if row == 'top':
            shut = centre + C(0, -.4 + k * .17, tall / 2 + .06 - .03 * fall)
            shut_size = (.8, .13, .14)
            shut_turn = (0, roll, 0)
        else:
            shut = centre + C(side * (wide / 2 + .03), -.42 + k * .24, -.02)
            shut_size = (.1, .14, .6)
            shut_turn = (0, roll, 0)
        a = math.radians(-92 + i * (184 / 12))
        out = hub + C(math.sin(a), -.05, math.cos(a)) * (1.08 - .2 * sag)
        at = shut.lerp(out, open_fins)
        size = Vector(shut_size).lerp(Vector((.16, .2, .86)), open_fins)
        drop = -math.degrees(a) * (1 + .2 * sag * open_fins)
        turn = (shut_turn[0], shut_turn[1] * (1 - open_fins) + drop * open_fins, 0)
        at.z = max(at.z, .1)
        parts[f'fin{i}'] = solid(at, tuple(size), turn)
    for i, (r, f) in enumerate(((.55, .46), (-.55, .46), (.55, -.46), (-.55, -.46))):
        parts[f'foot{i}'] = solid(C(r, f - back, .09 + steps[i % 2] * (1 - fall)), (.34, .4, .18 * (1 - fall) + .02))
    return parts


def furnace_idle(frame):
    w = breath(frame)
    return furnace(squash=.05 * w, pulse=.1 * w)


def furnace_move(frame):
    k, phase = blended(frame)
    return furnace(roll=5 * k * math.sin(phase), steps=(.09 * k * max(0, math.sin(phase)), .09 * k * max(0, -math.sin(phase))))


FURNACE_ATTACK = dict(
    # Squash down and fan the fins open, punch out three rings of heat, sag overheated with the fins still out, close up.
    open_fins=[(0, 0), (10, 0), (28, 1, 'out'), (90, 1), (112, 0)],
    squash=[(0, 0), (10, 0), (28, 1, 'out'), (58, 1), (90, .5), (112, 0)],
    sag=[(0, 0), (58, 0), (68, 1), (90, 1), (112, 0)],
)


def furnace_attack(frame):
    p = tracks(FURNACE_ATTACK, frame)
    p['pulse'] = sum(max(0, 1 - abs(frame - at) / 4) for at in (32, 44, 56))
    return furnace(**p)


FURNACE_HIT = dict(back=[(0, 0), (10, 0), (15, .12, 'out'), (46, 0)], squash=[(0, 0), (10, 0), (15, .7, 'out'), (46, 0)], roll=[(0, 0), (10, 0), (15, -6, 'out'), (30, 3), (46, 0)])
FURNACE_DEATH = dict(open_fins=[(0, 0), (12, 0), (24, 1, 'out'), (124, 1)], sag=[(0, 0), (24, 0), (60, 1), (124, 1)], fall=[(0, 0), (20, 0), (60, 1, 'in'), (124, 1)], roll=[(0, 0), (20, 0), (60, 8), (124, 8)])
FURNACE = dict(
    ortho=4.4,
    parts=[('boiler', 'oct', 'iron'), ('rim', 'cyl', 'fin'), ('mouth', 'cyl', 'glow')] + [(f'fin{i}', 'box', 'fin') for i in range(13)] + [(f'foot{i}', 'box', 'iron') for i in range(4)],
    colours=dict(iron=(.30, .27, .25), fin=(.48, .43, .38), glow=(.95, .5, .08)),
    actions=dict(
        idle=dict(pose=furnace_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=furnace_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=furnace_attack, travel=0, keys=(0, 28, 32, 44, 56, 78, 110)),
        hit=dict(pose=lambda frame: furnace(**tracks(FURNACE_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: furnace(**tracks(FURNACE_DEATH, frame)), travel=0, keys=(0, 24, 44, 70)),
    ),
)


# ---- E11 Entropy Weaver: a spider whose abdomen is a spool of bright thread. ----
SPIDER_LEGS = ((.30, 1.0, .72), (.12, 1.12, .24), (-.1, 1.12, -.26), (-.3, 1.0, -.74))  # Forward offset on the body, reach out to the side, forward offset of the foot.


def spider(rear=0., raised=0., thread=0., drop=0., bob=0., shift=0., gait=None, curl=0.):
    parts = {}
    height = .62 + bob + .24 * rear - .46 * drop
    pitch = -30 * rear
    centre = C(0, shift - .12, height)
    tilt = Matrix.Rotation(math.radians(-pitch), 4, 'X')
    on_body = lambda r, f, u: centre + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (-pitch, 0, 0)
    # The spool's axis runs across the body.
    parts['spool'] = solid(on_body(0, -.22, .12), (.62, .86, .86), (-pitch, 90, 0))
    for side, name in ((1, 'capr'), (-1, 'capl')):
        parts[name] = solid(on_body(side * .38, -.22, .12), (.14, 1.1, 1.1), turn)
    parts['neck'] = solid(on_body(0, .34, -.06), (.44, .42, .36), turn)
    parts['head'] = solid(on_body(0, .66, -.14), (.3, .26, .24), turn)
    for i, (f, reach, ahead) in enumerate(SPIDER_LEGS):
        for side, name in ((1, 'r'), (-1, 'l')):
            hip = on_body(side * .24, f, -.12)
            lift, step = (0., 0.) if gait is None else stride(gait + (i + (side > 0)) * math.pi, .16, .16)[::-1]
            foot = C(side * reach * (1 - .55 * curl), ahead + step + shift, .03 + lift)
            if i == 0:
                foot = foot.lerp(C(side * .82, 1.0 + shift, 1.5), raised)
            limb(parts, f'{name}{i}', hip, foot, .62, .74, C(side * .3, 0, 1), .11)
    if thread > 0:
        a, b = on_body(0, -.05, .38), C(0, 1.0 + shift, 1.5)
        parts['thread'] = bar(a, a.lerp(b, thread) + C(0, thread * 1.0, 0), .035)
    return parts


def spider_idle(frame):
    return spider(bob=-.025 * breath(frame))


def spider_move(frame):
    k, phase = blended(frame)
    return spider(bob=.02 * k * math.cos(2 * phase), gait=phase if k >= 1 else phase * k)


SPIDER_ATTACK = dict(
    # Rear up on the back legs, front legs high, draw a taut thread out of the spool, hold it, whip it out, come back down.
    rear=[(0, 0), (10, 0), (30, 1, 'out'), (50, 1), (58, .5, 'in'), (96, 0)],
    raised=[(0, 0), (10, 0), (30, 1, 'out'), (50, 1), (58, .3, 'in'), (96, 0)],
    thread=[(0, 0), (24, 0), (32, 1, 'out'), (54, 1), (60, 0)],
    shift=[(0, 0), (50, 0), (56, .14, 'in'), (96, 0)],
)
SPIDER_HIT = dict(shift=[(0, 0), (10, 0), (15, -.16, 'out'), (46, 0)], drop=[(0, 0), (10, 0), (15, .3, 'out'), (46, 0)])
SPIDER_DEATH = dict(shift=[(0, 0), (10, 0), (15, -.14, 'out')], drop=[(0, 0), (15, .25, 'out'), (46, 1, 'in'), (124, 1)], curl=[(0, 0), (15, 0), (56, 1), (124, 1)])
SPIDER = dict(
    ortho=3.8,
    parts=[('spool', 'cyl', 'thread'), ('capr', 'facet', 'shell'), ('capl', 'facet', 'shell'), ('neck', 'box', 'shell'), ('head', 'box', 'plate'), ('thread', 'cyl', 'thread')]
    + [(f'{s}{i}{p}', 'box', 'shell' if p == 'a' else 'plate') for s in 'rl' for i in range(4) for p in 'ab'],
    colours=dict(shell=(.10, .10, .11), plate=(.45, .22, .08), thread=(.92, .5, .05)),
    actions=dict(
        idle=dict(pose=spider_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=spider_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda frame: spider(**tracks(SPIDER_ATTACK, frame)), travel=0, keys=(0, 30, 40, 50, 58, 110)),
        hit=dict(pose=lambda frame: spider(**tracks(SPIDER_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: spider(**tracks(SPIDER_DEATH, frame)), travel=0, keys=(0, 15, 40, 70)),
    ),
)

# ---- E02 Checksum Guard: a broad riveted machine behind a tower shield held straight ahead. ----
def guard(lean=0., drop=0., forward=0., shield_out=0., shield_low=0., shield_aside=0., swing=0., lfoot=(0, 0), rfoot=(0, 0), stance=0., fall=0.):
    parts = {}
    hips = C(0, forward - .08 * lean, 1.02 - drop - .78 * fall)
    pitch = lean + 62 * fall
    tilt = Matrix.Rotation(math.radians(pitch), 4, 'X')  # Positive leans it backward.
    on_body = lambda r, f, u: hips + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (pitch, 0, 0)
    parts['hips'] = solid(hips, (.62, .42, .3), turn)
    parts['torso'] = solid(on_body(0, 0, .46), (.86, .56, .62), turn)
    parts['head'] = solid(on_body(0, .04, 1.0), (.46, .46, .4), turn)
    parts['visor'] = solid(on_body(0, .28, 1.0), (.32, .03, .08), turn)
    for side, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}pad'] = solid(on_body(side * .56, 0, .68), (.4, .46, .32), turn)
    for side, name, (f, u) in ((1, 'r', rfoot), (-1, 'l', lfoot)):
        foot = C(side * .3, f + forward - side * .3 * stance, .1 + u)
        end = limb(parts, f'{name}leg', hips + C(side * .24, 0, -.14), foot, .46, .48, C(side * .1, 1, 0), .26)
        parts[f'{name}foot'] = solid(end + C(0, .06, -.04), (.3, .46, .14))
    # The right arm is a short piston with a fist.
    shoulder = on_body(.6, 0, .54)
    fist = shoulder + C(.12 + .02 * swing, .12 + .3 * swing, -.72)
    end = limb(parts, 'rarm', shoulder, fist, .38, .38, C(.5, -.4, 0), .2)
    parts['rfist'] = solid(end, .26)
    # The shield is carried on a thick left arm, its face straight ahead and low enough to reach the shins.
    centre = on_body(-.08, .62 + .42 * shield_out, .24 - .26 * shield_low) + C(-.4 * shield_aside, -.25 * shield_aside, 0)
    shield_turn = (pitch * .4 + 90 * fall + 18 * shield_low - 0, 0, 62 * shield_aside)
    limb(parts, 'larm', on_body(-.6, 0, .54), centre + C(-.12, -.1, 0), .36, .36, C(-.6, -.2, 0), .2)
    parts['shield'] = solid(centre, (.86, .14, 1.3), shield_turn)
    parts['plate'] = solid(centre + C(0, .08, 0), (.72, .02, 1.12), shield_turn)
    return parts


def guard_idle(frame):
    w = breath(frame)
    return guard(drop=.015 * w, lean=1.5 * w, swing=.05 * w)


def guard_move(frame):
    k, phase = blended(frame)
    rf, ru = stride(phase, .26, .14)
    lf, lu = stride(phase + math.pi, .26, .14)
    return guard(drop=.03 * k + .02 * k * math.cos(2 * phase), lean=-3 * k, swing=.2 * k * math.cos(phase), rfoot=(rf * k, ru * k), lfoot=(lf * k, lu * k))


GUARD_RAM = 1.67  # 2.5 world units, as far as the simulation's shield push.
GUARD_ATTACK = dict(
    # Rock back behind the lit shield, ram forward, then the shield hangs low and open while it recovers where it stopped.
    lean=[(0, 0), (10, 0), (28, 14, 'out'), (44, 16), (50, -14, 'in'), (60, -8), (84, -4), (108, 0)],
    drop=[(0, 0), (10, 0), (28, .12, 'out'), (44, .14), (50, .08), (84, .06), (108, 0)],
    stance=[(0, 0), (10, 0), (28, 1, 'out'), (44, 1), (52, 1.2), (84, .8), (108, 0)],
    forward=[(0, 0), (44, 0), (52, GUARD_RAM, 'out')],
    shield_out=[(0, 0), (10, 0), (28, -.4, 'out'), (44, -.45), (50, .6, 'in'), (58, .3), (84, 0)],
    shield_low=[(0, 0), (54, 0), (62, 1, 'out'), (84, 1), (108, 0)],
    swing=[(0, 0), (10, 0), (28, -.6), (44, -.6), (52, .5), (84, 0)],
)
GUARD_BREAK = dict(
    # The shield is knocked out to the side and hangs there while it reels, then it hauls the shield back.
    shield_aside=[(0, 0), (10, 0), (16, 1, 'out'), (64, 1), (96, 0)],
    shield_low=[(0, 0), (10, 0), (18, .8, 'out'), (64, .8), (96, 0)],
    lean=[(0, 0), (10, 0), (16, 18, 'out'), (40, 12), (64, 6), (96, 0)],
    drop=[(0, 0), (10, 0), (18, .16, 'out'), (64, .1), (96, 0)],
    stance=[(0, 0), (10, 0), (18, .8, 'out'), (64, .5), (96, 0)],
)
GUARD_HIT = dict(lean=[(0, 0), (10, 0), (15, 10, 'out'), (44, 0)], drop=[(0, 0), (10, 0), (15, .08, 'out'), (44, 0)], shield_out=[(0, 0), (10, 0), (15, -.3, 'out'), (44, 0)])
GUARD_DEATH = dict(lean=[(0, 0), (10, 0), (18, 12, 'out')], fall=[(0, 0), (16, 0), (50, 1, 'in'), (124, 1)], drop=[(0, 0), (16, .1)], shield_low=[(0, 0), (12, 0), (34, 1)], shield_aside=[(0, 0), (20, 0), (46, .6)])
GUARD = dict(
    ortho=4.6,
    mirror=('L',),
    parts=[(n, 'box', 'armour') for n in ('hips', 'torso', 'head', 'rpad', 'lpad', 'rfist', 'rfoot', 'lfoot')] + [('visor', 'box', 'visor'), ('shield', 'box', 'armour'), ('plate', 'box', 'face')]
    + [(f'{s}{p}', 'box', 'armour') for s in 'rl' for p in ('lega', 'legb')] + [(f'{s}arm{p}', 'box', 'armour') for s in 'rl' for p in 'ab'],
    colours=dict(armour=(.20, .30, .42), visor=(.9, .85, .6), face=(.08, .1, .14)),
    actions=dict(
        idle=dict(pose=guard_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=guard_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda frame: guard(**tracks(GUARD_ATTACK, frame)), travel=GUARD_RAM, keys=(0, 28, 44, 50, 54, 70, 110)),
        hit=dict(pose=lambda frame: guard(**tracks(GUARD_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: guard(**tracks(GUARD_DEATH, frame)), travel=0, keys=(0, 18, 34, 70)),
        shieldbreak=dict(pose=lambda frame: guard(**tracks(GUARD_BREAK, frame)), travel=0, keys=(0, 16, 40, 64, 100)),
    ),
)


# ---- E04 Echo Priest: a hard pleated robe with no feet, a hood with two points of light, and a tall staff. ----
def priest(raise_staff=0., slam=0., sag=0., sway=0., lean=0., fall=0., back=0.):
    parts = {}
    base = C(0, -back, 0)
    tilt = Matrix.Rotation(math.radians(lean + 80 * fall), 4, 'X')
    on_body = lambda r, f, u: base + C(0, 0, .2 * fall) + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (lean + 80 * fall, 0, sway)
    squash = 1 - .3 * sag
    parts['robe'] = solid(on_body(0, 0, .5 * squash), (1.0, .9, 1.0 * squash), turn)
    parts['chest'] = solid(on_body(0, .03, 1.1 * squash), (.56, .44, .36), turn)
    parts['panel'] = solid(on_body(0, .26, 1.02 * squash), (.26, .02, .4), turn)
    parts['hood'] = solid(on_body(0, .02, 1.42 * squash), (.42, .46, .42), turn)
    parts['face'] = solid(on_body(0, .22, 1.4 * squash), (.24, .04, .26), turn)
    # Upright beside it at rest. Both hands lift it overhead, laid along the facing direction with the rings out in front and raised, and drive it down from there.
    rest = on_body(.5, .12, .05)
    foot = rest.lerp(C(0, -.7, 1.72 - .25 * slam), raise_staff)
    top = (rest + C(0, 0, 1.75)).lerp(C(0, 1.0, 2.28 - .9 * slam), raise_staff)
    if fall:
        foot, top = rest + C(.5 * fall, 0, 0), rest + C(.5 * fall + .9 * fall, .9 * fall, 1.75 * (1 - fall) + .1 * fall)
    parts['staff'] = bar(foot, top, .07)
    grip = foot.lerp(top, .5)
    direction = (top - foot).normalized()
    for i, (along, size) in enumerate(((.98, .2), (.91, .42), (.84, .56))):
        spread = 1 + .5 * raise_staff
        at = foot + (top - foot) * (1 - (1 - along) * spread)
        parts[f'ring{i}'] = Matrix.LocRotScale(at, direction.to_track_quat('Z', 'Y'), Vector((size, size, size)))
    limb(parts, 'rarm', on_body(.34, .02, 1.16 * squash), grip, .36, .36, C(.6, 0, -.2), .12)
    second = on_body(-.42, .1, .82).lerp(foot.lerp(top, .22), raise_staff)
    end = limb(parts, 'larm', on_body(-.34, .02, 1.16 * squash), second, .36, .36, C(-.6, 0, -.2), .12)
    parts['claw'] = solid(end, .14)
    return parts


def priest_idle(frame):
    w = breath(frame)
    return priest(lean=1.5 * w, sway=1.5 * math.sin(2 * math.pi * frame / BREATH))


def priest_move(frame):
    k, phase = blended(frame)
    return priest(lean=-5 * k, sway=5 * k * math.sin(phase))


PRIEST_ATTACK = dict(
    # Lift the staff overhead and hold it through the cast with the rings spread, then drive it down and let it sink back.
    raise_staff=[(0, 0), (10, 0), (30, 1, 'out'), (58, 1), (72, 1), (100, 0)],
    lean=[(0, 0), (10, 0), (30, 6), (58, 7), (66, -10, 'in'), (80, -4), (100, 0)],
    slam=[(0, 0), (58, 0), (66, 1, 'in'), (80, 1), (100, 0)],
)
PRIEST_HIT = dict(back=[(0, 0), (10, 0), (15, .2, 'out'), (44, 0)], lean=[(0, 0), (10, 0), (15, 12, 'out'), (44, 0)], sag=[(0, 0), (10, 0), (15, .15, 'out'), (34, 0)])
PRIEST_DEATH = dict(back=[(0, 0), (10, 0), (15, .15, 'out')], lean=[(0, 0), (10, 0), (15, 10, 'out')], sag=[(0, 0), (15, .1), (50, 1, 'in'), (124, 1)], fall=[(0, 0), (20, 0), (56, 1, 'in'), (124, 1)])
PRIEST = dict(
    ortho=3.8,
    mirror=('R',),
    parts=[('robe', 'cone', 'brass'), ('chest', 'box', 'brass'), ('panel', 'box', 'navy'), ('hood', 'box', 'brass'), ('face', 'box', 'void'), ('staff', 'cyl', 'navy'), ('claw', 'box', 'brass')]
    + [(f'ring{i}', 'ring', 'glow') for i in range(3)] + [(f'{s}arm{p}', 'box', 'brass') for s in 'rl' for p in 'ab'],
    colours=dict(brass=(.52, .36, .10), navy=(.06, .07, .16), void=(.01, .01, .02), glow=(.15, .7, .75)),
    actions=dict(
        idle=dict(pose=priest_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=priest_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda frame: priest(**tracks(PRIEST_ATTACK, frame)), travel=0, keys=(0, 30, 58, 66, 80, 110)),
        hit=dict(pose=lambda frame: priest(**tracks(PRIEST_HIT, frame)), travel=0, keys=(0, 15, 30)),
        death=dict(pose=lambda frame: priest(**tracks(PRIEST_DEATH, frame)), travel=0, keys=(0, 18, 40, 70)),
    ),
)

# ---- B01 Cache Warden: a wide crab with three tanks on its back, a lock plate on its front and two pincers, the right one bigger. ----
CRAB_LEGS = ((.38, 1.5, .8), (0, 1.62, 0), (-.38, 1.5, -.8))  # Forward offset on the body, reach out to the side, forward offset of the foot.


def crab(rise=0., pitch=0., forward=0., roll=0., gait=None, spread=0., lift=0., swing=0., snap=.25, sag=0., plate=0., swell=0., shake=0., splay=0.):
    parts = {}
    height = .95 + rise - .62 * sag
    centre = C(shake, forward, height)
    tilt = Matrix.Rotation(math.radians(pitch), 4, 'X') @ Matrix.Rotation(math.radians(roll), 4, 'Y')
    on_body = lambda r, f, u: centre + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (pitch, roll, 0)
    parts['shell'] = solid(centre, (2.5 * (1 + .03 * swell), 2.0, .86 * (1 + .05 * swell)), turn)
    parts['plate'] = solid(on_body(0, 1.0 + .1 * plate, -.04), (.62 + .12 * plate, .62 + .12 * plate, .12), (pitch + 90, roll, 0))
    parts['hole'] = solid(on_body(0, 1.07 + .1 * plate, -.04), (.2, .2, .03), (pitch + 90, roll, 0))
    for i, r in enumerate((-.66, 0, .66)):
        parts[f'tank{i}'] = solid(on_body(r, -.32, .66 + .04 * swell), (.62, .62, .62), turn)
        parts[f'cap{i}'] = solid(on_body(r, -.32, 1.0 + .04 * swell), (.66, .66, .1), turn)
    for side, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}stalk'] = bar(on_body(side * .34, .78, .3), on_body(side * .36, .92, .68), .06)
        parts[f'{name}eye'] = solid(on_body(side * .36, .92, .72), .14)
        for i, (f, reach, ahead) in enumerate(CRAB_LEGS):
            hip = on_body(side * .9, f, -.14)
            step, up = (0., 0.) if gait is None else stride(gait + (i + (side > 0)) * math.pi, .26, .24)
            foot = C(side * (reach + .7 * splay), ahead + step + forward, .03 + up)
            limb(parts, f'{name}{i}', hip, foot, .8, 1.0, C(side * .4, 0, 1), .17)
        # Pincers swing around the front. The right one is bigger.
        big = 1.3 if side > 0 else 1.
        angle = math.radians(35 * spread - 62 * swing * side)
        shoulder = on_body(side * 1.0, .56, -.08)
        hand = centre + C(side * (.92 + .5 * spread) * math.cos(angle * side) + 1.4 * math.sin(angle) * 0, 1.42 * math.cos(angle) - .1 * spread, -.46 + 1.72 * lift)
        if swing:
            hand = centre + C(math.sin(math.radians(62 * swing * side)) * 1.5 + side * .9 * (1 - abs(swing)), 1.42 * math.cos(math.radians(62 * swing)), -.46 + 1.72 * lift)
        joint, end = two_bone(shoulder, hand, .78, .78, C(side * .9, 0, .3))
        parts[f'{name}arma'], parts[f'{name}armb'] = bar(shoulder, joint, .26), bar(joint, end, .26)
        along = (end - joint).normalized()
        out = along.cross(Vector((0, 0, 1))).normalized() * side
        jaw = .54 * big
        parts[f'{name}palm'] = solid(end, (.5 * big, .5 * big, .44 * big))
        parts[f'{name}jawa'] = bar(end, end + along * jaw + Vector((0, 0, 1)) * snap * .6, .2 * big)
        parts[f'{name}jawb'] = bar(end, end + along * jaw - Vector((0, 0, 1)) * snap * .6, .16 * big)
    return parts


def crab_idle(frame):
    w = breath(frame)
    return crab(rise=-.02 * w, swell=.4 * w, snap=.25 + .06 * w)


def crab_move(frame):
    k, phase = blended(frame)
    return crab(rise=.02 * k * math.cos(2 * phase), roll=2 * k * math.sin(phase), gait=phase if k >= 1 else phase * k)


CRAB_RUSH = 3.0
CRAB_ATTACKS = dict(
    # Crouch and point the pincers ahead, then a straight run that carries it across the frame, and a skid.
    rush=dict(rise=[(0, 0), (10, 0), (30, -.2, 'out'), (46, -.22), (54, .02), (84, 0)], pitch=[(0, 0), (10, 0), (30, 7), (46, 8), (54, -8), (72, -3), (92, 0)], forward=[(0, 0), (46, 0), (66, CRAB_RUSH, 'out')], snap=[(0, .25), (30, .1), (70, .1), (92, .25)], lift=[(0, 0), (30, .1), (70, .1), (92, 0)]),
    # Rear up with both pincers high and bring them down on the ground in front.
    slam=dict(pitch=[(0, 0), (10, 0), (32, -24, 'out'), (46, -26), (52, 10, 'in'), (70, 6), (100, 0)], rise=[(0, 0), (10, 0), (32, .34, 'out'), (46, .36), (52, -.16, 'in'), (70, -.1), (100, 0)], lift=[(0, 0), (10, 0), (32, 1.1, 'out'), (46, 1.2), (52, -.05, 'in'), (72, 0), (100, 0)], spread=[(0, 0), (10, 0), (32, .8), (46, .8), (52, .1), (100, 0)], snap=[(0, .25), (32, .55), (46, .55), (52, .15), (100, .25)]),
    # Wind both pincers to one side and scythe them across the front.
    sweep=dict(swing=[(0, 0), (10, 0), (34, -1, 'out'), (46, -1), (56, 1, 'in'), (72, 1), (100, 0)], rise=[(0, 0), (34, -.08), (56, -.04), (100, 0)], roll=[(0, 0), (34, -7), (46, -7), (56, 8, 'in'), (72, 6), (100, 0)], lift=[(0, 0), (34, .16), (100, 0)], snap=[(0, .25), (34, .5), (56, .2), (100, .25)]),
    # Tanks swell, the shell bows and it calls its worms.
    adds_cast=dict(swell=[(0, 0), (10, 0), (34, 1, 'out'), (70, 1), (100, 0)], rise=[(0, 0), (10, 0), (34, .16), (70, .16), (100, 0)], pitch=[(0, 0), (10, 0), (34, -10), (58, -10), (66, 4), (100, 0)], lift=[(0, 0), (34, .5), (70, .5), (100, 0)], spread=[(0, 0), (34, .8), (70, .8), (100, 0)]),
    # The end of each round: it sags open and the lock plate comes forward.
    stagger=dict(sag=[(0, 0), (10, 0), (22, .55, 'out'), (72, .55), (106, 0)], plate=[(0, 0), (16, 0), (26, 1, 'out'), (72, 1), (100, 0)], pitch=[(0, 0), (10, 0), (22, -14, 'out'), (72, -12), (106, 0)], spread=[(0, 0), (22, 1), (72, 1), (106, 0)], lift=[(0, 0), (22, -.1), (72, -.1), (106, 0)], snap=[(0, .25), (22, .45), (72, .45), (106, .25)]),
    # Overload: it rears, shakes with everything swollen, and comes down in the same pose.
    phase_change=dict(rise=[(0, 0), (12, 0), (36, .4, 'out'), (76, .42), (96, 0)], pitch=[(0, 0), (12, 0), (36, -24), (76, -26), (96, 0)], swell=[(0, 0), (12, 0), (40, 1.4), (84, 1.4), (110, .4)], lift=[(0, 0), (12, 0), (36, 1.1), (76, 1.1), (96, 0)], spread=[(0, 0), (36, 1), (76, 1), (96, 0)], snap=[(0, .25), (36, .6), (76, .6), (96, .25)]),
    death=dict(sag=[(0, 0), (12, 0), (56, 1, 'in'), (124, 1)], splay=[(0, 0), (20, 0), (60, 1), (124, 1)], roll=[(0, 0), (20, 0), (60, 8), (124, 8)], pitch=[(0, 0), (20, 0), (60, 7), (124, 7)], lift=[(0, 0), (20, 0), (60, -.14), (124, -.14)], snap=[(0, .25), (60, .6), (124, .6)], plate=[(0, 0), (40, 0), (60, 1)]),
)


def crab_action(name):
    channels = CRAB_ATTACKS[name]
    def pose(frame):
        p = tracks(channels, frame)
        if name in ('phase_change', 'stagger') and 30 < frame < 80:
            p['shake'] = .03 * math.sin(frame * 2.1)
        return crab(**p)
    return pose


def crab_enter(frame):
    # It rises out of a crouch with its legs tucked, lifts its pincers and settles into the hub pose.
    p = tracks(dict(sag=[(0, 1), (14, 1), (56, 0, 'out')], splay=[(0, 1), (14, 1), (56, 0)], lift=[(0, -.1), (40, -.1), (70, 1), (84, 1), (110, 0)], spread=[(0, 0), (56, 0), (70, 1), (84, 1), (110, 0)], snap=[(0, .4), (70, .6), (84, .6), (110, .25)]), frame)
    return crab(**p)


CRAB = dict(
    ortho=6.8,
    parts=[('shell', 'facet', 'shell'), ('plate', 'cyl', 'brass'), ('hole', 'cyl', 'void')] + [(f'tank{i}', 'cyl', 'glass') for i in range(3)] + [(f'cap{i}', 'cyl', 'brass') for i in range(3)]
    + [(f'{s}stalk', 'cyl', 'dark') for s in 'rl'] + [(f'{s}eye', 'ball', 'glass') for s in 'rl']
    + [(f'{s}{i}{p}', 'box', 'shell' if p == 'a' else 'dark') for s in 'rl' for i in range(3) for p in 'ab']
    + [(f'{s}{p}', 'box', 'shell') for s in 'rl' for p in ('arma', 'armb', 'palm', 'jawa', 'jawb')],
    colours=dict(shell=(.16, .18, .24), brass=(.45, .32, .12), void=(.01, .01, .02), glass=(.45, .72, .72), dark=(.08, .08, .1)),
    actions=dict(
        idle=dict(pose=crab_idle, travel=0, keys=(0, 62, 93)),
        move=dict(pose=crab_move, travel=0, keys=(0, 48, 64, 80)),
        rush=dict(pose=crab_action('rush'), travel=CRAB_RUSH, keys=(0, 30, 46, 56, 66, 90)),
        slam=dict(pose=crab_action('slam'), travel=0, keys=(0, 32, 46, 52, 70, 100)),
        sweep=dict(pose=crab_action('sweep'), travel=0, keys=(0, 34, 46, 52, 58, 72, 100)),
        adds_cast=dict(pose=crab_action('adds_cast'), travel=0, keys=(0, 34, 58, 70, 100)),
        stagger=dict(pose=crab_action('stagger'), travel=0, keys=(0, 22, 50, 72, 106)),
        phase_change=dict(pose=crab_action('phase_change'), travel=0, keys=(0, 36, 60, 84, 110)),
        death=dict(pose=crab_action('death'), travel=0, keys=(0, 30, 56, 80, 120)),
        enter=dict(pose=crab_enter, travel=0, keys=(0, 30, 56, 70, 84, 110)),
    ),
)

# ---- E02+ Strict Validator: the guard with a stamp of its boot, which puts down the checksum seal. ----
def validator_stomp(frame):
    p = tracks(dict(lean=[(0, 0), (10, 0), (30, 8, 'out'), (42, 8), (48, -4, 'in'), (80, -2), (104, 0)], drop=[(0, 0), (30, -.04), (42, -.04), (48, .12, 'in'), (80, .08), (104, 0)]), frame)
    up = track([(0, 0), (10, 0), (30, .52, 'out'), (42, .54), (48, 0, 'in'), (124, 0)], frame)
    return guard(lfoot=(.1, up), **p)


VALIDATOR = dict(GUARD, ortho=5.0, mirror=('DL', 'UL'), actions=dict(GUARD['actions'], stomp=dict(pose=validator_stomp, travel=0, keys=(0, 30, 42, 48, 70, 110))))

def common(hit, death, pose):
    """The hit and death every enemy has, from its channel tables."""
    return dict(hit=dict(pose=lambda frame: pose(**tracks(hit, frame)), travel=0, keys=(0, 15, 30)), death=dict(pose=lambda frame: pose(**tracks(death, frame)), travel=0, keys=(0, 18, 40, 70)))


# ---- E05 Illusion Projection: a triangular mask over a robe of stacked pages, floating, with two page bundles for arms. ----
def phantom(float_z=0., twist=0., fan=0., swing=0., lean=0., back=0., scatter=0., bloat=0.):
    parts, z = {}, 1.28 + float_z - .5 * scatter
    centre = C(0, -back, z)
    parts['mask'] = solid(centre + C(0, .16, .42), (.46, .08, .5), (lean, 0, twist * .3))
    for i in range(6):
        r = (i - 2.5) * .11 * (1 + bloat)
        drop = (.2 + .16 * (i % 3)) * (1 + .4 * scatter)
        parts[f'page{i}'] = solid(centre + C(r * (1 + scatter * 2.5), .02 * (i % 2), -.42 - drop * .6), (.22, .04, .9 + drop), (lean, 12 * (i - 2.5) * (.3 + bloat + scatter), twist))
    parts['head'] = solid(centre + C(0, 0, .3), (.46, .3, .5), (lean, 0, twist * .5))
    for side, name in ((1, 'r'), (-1, 'l')):
        shoulder = centre + C(side * .34, 0, .05)
        hand = centre + C(side * .56, .08, -.62)
        if side > 0:
            hand = hand.lerp(centre + C(1.0, -.5 + 1.5 * swing, .36 - .9 * max(0, swing)), fan)
        parts[f'{name}arm'] = bar(shoulder, hand, .13)
        count = 5 if side > 0 else 1
        for k in range(count):
            spread = math.radians((k - 2) * 26 * fan) if side > 0 else 0
            d = (hand - shoulder).normalized()
            out = C(math.sin(spread) * .9, 0, math.cos(spread) * .9) * .5 * (fan if side > 0 else .0) + d * .5
            parts[f'{name}blade{k}'] = bar(hand, hand + out, .09)
    return parts


PHANTOM_ATTACK = dict(fan=[(0, 0), (10, 0), (30, 1, 'out'), (46, 1), (62, .6), (96, 0)], swing=[(0, 0), (46, 0), (54, 1, 'in'), (74, 1), (96, 0)], twist=[(0, 0), (10, 0), (30, -32, 'out'), (46, -36), (54, 26, 'in'), (72, 16), (96, 0)], lean=[(0, 0), (30, 6), (54, -12), (96, 0)])
PHANTOM_SPLIT = dict(bloat=[(0, 0), (10, 0), (34, 1.4, 'out'), (56, 1.4), (84, 0)], float_z=[(0, 0), (34, .16), (84, 0)], twist=[(0, 0), (56, 0), (84, 0)], lean=[(0, 0), (34, -6), (84, 0)])
PHANTOM_HIT = dict(back=[(0, 0), (10, 0), (15, .24, 'out'), (46, 0)], lean=[(0, 0), (10, 0), (15, 12, 'out'), (46, 0)], bloat=[(0, 0), (10, 0), (15, .8, 'out'), (46, 0)])
PHANTOM_DEATH = dict(back=[(0, 0), (10, 0), (15, .2, 'out')], scatter=[(0, 0), (16, 0), (60, 1, 'out'), (124, 1)], lean=[(0, 0), (16, 8), (60, 30)])
PHANTOM = dict(
    ortho=3.8,
    mirror=('L',),
    parts=[('mask', 'box', 'ivory'), ('head', 'box', 'page')] + [(f'page{i}', 'box', 'page') for i in range(6)] + [(f'{s}arm', 'box', 'page') for s in 'rl'] + [(f'rblade{k}', 'box', 'ivory') for k in range(5)] + [('lblade0', 'box', 'ivory')],
    colours=dict(ivory=(.8, .76, .66), page=(.42, .38, .5)),
    actions=dict(
        idle=dict(pose=lambda f: phantom(float_z=.05 * breath(f), lean=2 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=lambda f: phantom(float_z=.05 * math.sin(blended(f)[1]) * blended(f)[0], lean=-8 * blended(f)[0], twist=8 * math.sin(blended(f)[1]) * blended(f)[0]), travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda f: phantom(**tracks(PHANTOM_ATTACK, f)), travel=0, keys=(0, 30, 46, 54, 74, 110)),
        split=dict(pose=lambda f: phantom(**tracks(PHANTOM_SPLIT, f)), travel=0, keys=(0, 34, 56, 84)),
        **common(PHANTOM_HIT, PHANTOM_DEATH, phantom),
    ),
)


# ---- A thin machine on two legs, shared by the arbalester and the thief. ----
def stick_body(parts, hips, pitch, side_turn, feet, thick=.09, shin=.5, thigh=.5, torso=.7):
    tilt = Matrix.Rotation(math.radians(pitch), 4, 'X') @ Matrix.Rotation(math.radians(side_turn), 4, 'Z')
    on_body = lambda r, f, u: hips + (tilt @ C(r, f, u).to_4d()).to_3d()
    parts['hips'] = solid(hips, (.3, .2, .16), (pitch, 0, side_turn))
    parts['torso'] = bar(hips, on_body(0, 0, torso), .2)
    parts['chest'] = solid(on_body(0, 0, torso * .85), (.34, .22, .3), (pitch, 0, side_turn))
    for side, name, foot in ((1, 'r', feet[0]), (-1, 'l', feet[1])):
        end = limb(parts, f'{name}leg', hips + C(side * .12, 0, -.06), foot, thigh, shin, C(side * .1, 1, 0), thick)
        parts[f'{name}foot'] = solid(end + C(0, .08, -.03), (.13, .3, .07))
    return on_body


# ---- E06 Misquoting Arbalester: lean, with a folding bookshelf on its back and a crossbow longer than itself. ----
def arbalest(level=0., kneel=0., shelf=0., recoil=0., pitch=0., step=(0, 0), fall=0., back=0.):
    parts, z = {}, 1.1 - .48 * kneel - .9 * fall
    hips = C(0, -back, z)
    bow_lean = pitch - 10 * kneel + 70 * fall + 14 * recoil
    feet = (C(.16, .34 * kneel + step[0], .06), C(-.16, -.5 * kneel + step[1], .06 + .0))
    on_body = stick_body(parts, hips, bow_lean, 0, feet, torso=.74)
    head = on_body(0, .1, 1.02)
    parts['neck'] = bar(on_body(0, 0, .74), head, .08)
    parts['head'] = solid(head, (.22, .34, .22), (90 + bow_lean, 0, 0))
    parts['lens'] = solid(head + C(0, .18, 0), (.2, .2, .04), (90 + bow_lean, 0, 0))
    centre = on_body(0, -.28, .56)
    if shelf < .02:
        parts['shelf'] = solid(centre, (.54, .24, .78), (bow_lean, 0, 0))
    else:
        parts['shelf'] = solid(centre, (.26, .22, .78), (bow_lean, 0, 0))
        for side, name in ((1, 'r'), (-1, 'l')):
            parts[f'{name}door'] = solid(centre + C(side * (.13 + .24 * shelf), -.05 * shelf, 0), (.5, .1, .78), (bow_lean, 0, side * -48 * shelf))
    grip = on_body(.04, .2, .62)
    if level > 0:
        tip_up, tip_rest = C(.0, 1.7 - .25 * recoil, grip.z + .02), C(.3, .55, .1)
    else:
        tip_up, tip_rest = C(.0, 1.7, grip.z), C(.3, .55, .1)
    butt_rest = on_body(.16, -.05, .62)
    tip = tip_rest.lerp(tip_up, level)
    butt = butt_rest.lerp(C(.06, -.25 * recoil - .05, grip.z + .04), level)
    parts['stock'] = bar(butt, tip, .07)
    span = (tip - butt).normalized()
    across = span.cross(Vector((0, 0, 1))).normalized()
    bow_at = butt.lerp(tip, .88)
    parts['bow'] = bar(bow_at - across * .56, bow_at + across * .56, .05)
    parts['bolt'] = bar(butt.lerp(tip, .5), butt.lerp(tip, 1.04), .03)
    limb(parts, 'rarm', on_body(.2, 0, .66), butt.lerp(tip, .2), .3, .3, C(.6, 0, -.3), .07)
    limb(parts, 'larm', on_body(-.2, 0, .66), butt.lerp(tip, .5), .36, .36, C(-.6, 0, -.3), .07)
    return parts


ARBALEST_ATTACK = dict(level=[(0, 0), (10, 0), (30, 1, 'out'), (92, 1), (112, 0)], kneel=[(0, 0), (10, 0), (30, 1, 'out'), (88, 1), (112, 0)], shelf=[(0, 0), (16, 0), (34, 1, 'out'), (84, 1), (108, 0)], recoil=[(0, 0), (52, 0), (55, 1, 'in'), (72, 0)])
ARBALEST_HIT = dict(back=[(0, 0), (10, 0), (15, .2, 'out'), (46, 0)], pitch=[(0, 0), (10, 0), (15, 16, 'out'), (46, 0)])
ARBALEST_DEATH = dict(back=[(0, 0), (10, 0), (15, .15, 'out')], pitch=[(0, 0), (15, 16)], fall=[(0, 0), (16, 0), (54, 1, 'in'), (124, 1)], kneel=[(0, 0), (14, 0), (30, .5), (54, .2)])


def arbalest_move(f):
    k, phase = blended(f)
    return arbalest(pitch=-5 * k, step=(k * stride(phase, .28, 0)[0], k * stride(phase + math.pi, .28, 0)[0]))


ARBALEST = dict(
    ortho=4.8,
    mirror=('R',),
    parts=[(n, 'box', 'metal') for n in ('hips', 'torso', 'chest', 'neck', 'head')] + [('lens', 'cyl', 'lamp'), ('shelf', 'box', 'wood'), ('rdoor', 'box', 'wood'), ('ldoor', 'box', 'wood'), ('stock', 'box', 'silver'), ('bow', 'box', 'silver'), ('bolt', 'box', 'lamp')]
    + [(f'{s}{p}', 'box', 'metal') for s in 'rl' for p in ('lega', 'legb', 'foot', 'arma', 'armb')],
    colours=dict(metal=(.3, .27, .34), wood=(.22, .18, .24), silver=(.55, .52, .46), lamp=(.9, .9, .84)),
    actions=dict(
        idle=dict(pose=lambda f: arbalest(pitch=1.5 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=arbalest_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda f: arbalest(**tracks(ARBALEST_ATTACK, f)), travel=0, keys=(0, 30, 50, 55, 70, 110)),
        **common(ARBALEST_HIT, ARBALEST_DEATH, arbalest),
    ),
)


# ---- E08 Index Thief: stooped and thin, a bookmark blade in each hand, a cape of stiff strips. ----
def thief(crouch=0., cross=0., slash=0., flare=0., air=0., forward=0., vanish=0., back=0., fall=0., step=(0, 0)):
    parts, z = {}, .92 - .48 * crouch + air - .7 * fall
    hips = C(0, forward - back, z)
    pitch = -26 - 24 * crouch + 60 * fall
    ground = forward - back
    feet = (C(.26, .2 + ground + step[0], .06 + air), C(-.26, -.2 + ground + step[1], .06 + air))
    on_body = stick_body(parts, hips, pitch, 0, feet, thigh=.52, shin=.54, torso=.66, thick=.08)
    hood = on_body(0, .06, .9)
    parts['hood'] = solid(hood, (.3, .34, .36), (pitch, 0, 0))
    parts['lamp'] = solid(hood + C(0, .17, -.02), (.08, .08, .08))
    for i in range(7):
        a = (i - 3) * .15
        root = on_body(a, -.14, .68)
        parts[f'strip{i}'] = solid(root + C(a * .5, -.26 - .35 * flare, -.4 + 1.0 * flare + (.14 if i % 2 else 0)), (.18, .03, .9 - .1 * (i % 3)), (pitch + 25 + 120 * flare, 0, a * 40 * (1 + flare)))
    for side, name in ((1, 'r'), (-1, 'l')):
        shoulder = on_body(side * .2, 0, .58)
        wide, low = C(side * .78, ground + .34, .26 + air), C(side * -.28, ground + .76, .36 + air)
        hit = C(side * .9, ground + .72 + .2 * slash, .4 + air)
        hand = wide.lerp(low, cross).lerp(hit, slash)
        end = limb(parts, f'{name}arm', shoulder, hand, .46, .46, C(side * .6, 0, .2), .07)
        d = (end - shoulder).normalized()
        parts[f'{name}blade'] = bar(end, end + d * .72 + C(0, .2, -.1), .06)
    return parts


THIEF_ATTACK = dict(crouch=[(0, 0), (10, 0), (30, 1, 'out'), (46, 1), (56, .35), (84, .2), (106, 0)], cross=[(0, 0), (10, 0), (30, 1, 'out'), (46, 1), (52, 0, 'in'), (106, 0)], slash=[(0, 0), (46, 0), (52, 1, 'in'), (70, 1), (106, 0)], flare=[(0, 0), (10, 0), (30, 1, 'out'), (46, 1), (56, .4), (84, 0)], forward=[(0, 0), (46, 0), (52, .4, 'out')])
THIEF_LEAP = dict(crouch=[(0, 0), (8, 0), (24, 1, 'out'), (36, .1, 'in'), (62, .1), (72, 1, 'out'), (88, 1), (108, 0)], air=[(0, 0), (34, 0), (50, .4, 'out'), (66, 0, 'in')], forward=[(0, 0), (34, 0), (68, .7)], flare=[(0, 0), (24, .6), (50, 1), (72, .8), (108, 0)], cross=[(0, 0), (24, .6), (72, .9), (108, 0)])
THIEF_HIT = dict(back=[(0, 0), (10, 0), (15, .24, 'out'), (46, 0)], crouch=[(0, 0), (10, 0), (15, .5, 'out'), (46, 0)])
THIEF_DEATH = dict(back=[(0, 0), (10, 0), (15, .2, 'out')], crouch=[(0, 0), (15, .5), (34, .9)], fall=[(0, 0), (16, 0), (52, 1, 'in'), (124, 1)], flare=[(0, 0), (20, .6), (52, 0)])


def thief_move(f):
    k, phase = blended(f)
    return thief(crouch=.15 * k, step=(k * stride(phase, .34, 0)[0], k * stride(phase + math.pi, .34, 0)[0]))


THIEF = dict(
    ortho=4.2,
    parts=[(n, 'box', 'plum') for n in ('hips', 'torso', 'chest')] + [('hood', 'box', 'ivory'), ('lamp', 'box', 'lamp')] + [(f'strip{i}', 'box', 'ivory') for i in range(7)] + [(f'{s}blade', 'box', 'silver') for s in 'rl']
    + [(f'{s}{p}', 'box', 'plum') for s in 'rl' for p in ('lega', 'legb', 'foot', 'arma', 'armb')],
    colours=dict(plum=(.14, .08, .13), ivory=(.56, .5, .38), silver=(.74, .74, .78), lamp=(.95, .95, .9)),
    actions=dict(
        idle=dict(pose=lambda f: thief(crouch=.05 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=thief_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda f: thief(**tracks(THIEF_ATTACK, f)), travel=.4, keys=(0, 30, 46, 52, 70, 110)),
        leap=dict(pose=lambda f: thief(**tracks(THIEF_LEAP, f)), travel=.7, keys=(0, 24, 50, 72, 88, 110)),
        **common(THIEF_HIT, THIEF_DEATH, thief),
    ),
)


# ---- E09 Overfit Knight: square shoulders, a slit helmet, cooling pipes on its back, a long thin lance. ----
def knight(forward=0., drive=0., draw=0., thrust=0., drop=0., lean=0., side=0., fall=0., back=0., step=(0, 0)):
    parts = {}
    hips = C(0, forward - back, 1.12 - drop - .92 * fall)
    pitch = lean + 78 * fall
    ground = forward - back
    feet = (C(.3, .34 * drive + ground + step[0], .1), C(-.3, -.44 * drive + ground + step[1], .1))
    tilt = Matrix.Rotation(math.radians(pitch), 4, 'X')
    on_body = lambda r, f, u: hips + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (pitch, 0, side)
    parts['hips'] = solid(hips, (.56, .36, .3), turn)
    parts['torso'] = solid(on_body(0, 0, .48), (.74, .5, .66), turn)
    parts['head'] = solid(on_body(0, .04, 1.02), (.34, .38, .42), turn)
    parts['visor'] = solid(on_body(0, .23, 1.04), (.24, .02, .05), turn)
    for s, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}pad'] = solid(on_body(s * .54, 0, .8), (.46, .48, .36), turn)
        end = limb(parts, f'{name}leg', hips + C(s * .22, 0, -.14), feet[0 if s > 0 else 1], .5, .5, C(s * .1, 1, 0), .22)
        parts[f'{name}foot'] = solid(end + C(0, .08, -.04), (.26, .46, .12))
    for k in (-1, 0, 1):
        parts[f'pipe{k + 1}'] = bar(on_body(k * .2, -.28, .86), on_body(k * .2, -.36, .24), .1)
    # The lance stands upright beside it at rest, and lies level along the facing direction when it fights.
    rest_grip, rest_low, rest_top = on_body(.6, .1, .45), C(.72, ground + .1, .05), C(.72, ground + .1, 2.9)
    level_grip = on_body(.34, -.3 * draw + .7 * thrust, .28)
    tail = level_grip + C(0, -.7, 0)
    tip = level_grip + C(0, 2.3, 0)
    fight = min(1., draw + thrust * 2 + .0) if draw or thrust else 0
    low, high = rest_low.lerp(tail, fight), rest_top.lerp(tip, fight)
    parts['lance'] = bar(low, high, .055)
    parts['point'] = bar(high, high + (high - low).normalized() * .3, .1)
    grip = low.lerp(high, .26)
    second = low.lerp(high, .05)
    limb(parts, 'rarm', on_body(.54, 0, .66), grip, .42, .42, C(.8, -.2, -.2), .16)
    if fight:
        limb(parts, 'larm', on_body(-.54, 0, .66), low.lerp(high, .42), .46, .46, C(-.8, 0, -.2), .16)
    else:
        limb(parts, 'larm', on_body(-.54, 0, .66), on_body(-.62, .1, -.08), .42, .42, C(-.8, 0, 0), .16)
    return parts


KNIGHT_STEP = .67  # One world unit a thrust, as in spec 8.6.
KNIGHT_ATTACK = dict(
    # Da, da, a long hold, da: two quick thrusts, the lance drawn right back, the last one. Then a long recovery where it stopped.
    draw=[(0, 0), (8, 0), (22, 1, 'out'), (30, 0, 'in'), (38, 1, 'out'), (42, 0, 'in'), (50, 1, 'out'), (76, 1), (82, 0, 'in'), (100, 0)],
    thrust=[(0, 0), (22, 0), (30, 1, 'in'), (36, 0), (38, 0), (42, 1, 'in'), (48, 0), (76, 0), (82, 1, 'in'), (100, 1), (118, 0)],
    drive=[(0, 0), (8, 0), (22, 1, 'out'), (110, 1), (118, 0)],
    drop=[(0, 0), (8, 0), (22, .14, 'out'), (100, .14), (118, 0)],
    forward=[(0, 0), (22, 0), (30, KNIGHT_STEP), (38, KNIGHT_STEP), (42, KNIGHT_STEP * 2), (76, KNIGHT_STEP * 2), (82, KNIGHT_STEP * 3, 'out')],
    lean=[(0, 0), (22, 6), (30, -8), (38, 4), (42, -8), (50, 8), (76, 10), (82, -14, 'in'), (100, -8), (118, 0)],
)
KNIGHT_HIT = dict(back=[(0, 0), (10, 0), (15, .12, 'out'), (44, 0)], lean=[(0, 0), (10, 0), (15, 10, 'out'), (44, 0)], drop=[(0, 0), (10, 0), (15, .06, 'out'), (44, 0)])
KNIGHT_DEATH = dict(back=[(0, 0), (10, 0), (16, .14, 'out')], lean=[(0, 0), (16, 12)], fall=[(0, 0), (18, 0), (54, 1, 'in'), (124, 1)])


def knight_move(f):
    k, phase = blended(f)
    return knight(drop=.04 * k, lean=-3 * k, step=(k * stride(phase, .28, 0)[0], k * stride(phase + math.pi, .28, 0)[0]))


KNIGHT = dict(
    ortho=5.4,
    mirror=('R',),
    parts=[(n, 'box', 'armour') for n in ('hips', 'torso', 'head', 'rpad', 'lpad', 'rfoot', 'lfoot')] + [('visor', 'box', 'void'), ('lance', 'cyl', 'dark'), ('point', 'cyl', 'amber')] + [(f'pipe{i}', 'cyl', 'pipe') for i in range(3)]
    + [(f'{s}{p}', 'box', 'armour') for s in 'rl' for p in ('lega', 'legb', 'arma', 'armb')],
    colours=dict(armour=(.32, .33, .36), void=(.01, .01, .02), dark=(.06, .06, .07), amber=(.8, .5, .08), pipe=(.2, .16, .13)),
    actions=dict(
        idle=dict(pose=lambda f: knight(drop=.012 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=knight_move, travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda f: knight(**tracks(KNIGHT_ATTACK, f)), travel=KNIGHT_STEP * 3, keys=(0, 22, 30, 42, 60, 82, 110)),
        **common(KNIGHT_HIT, KNIGHT_DEATH, knight),
    ),
)


# ---- E12 Oblivion Reaper: tall and thin in a coat of rigid panels, a blank mask, a scythe with one white crescent. ----
def reaper(wind=0., cut=0., hold=0., drop=0., lean=0., fall=0., back=0., sway=0.):
    parts = {}
    z = 1.5 - drop - 1.25 * fall
    base = C(0, -back, 0)
    tilt = Matrix.Rotation(math.radians(lean + 80 * fall), 4, 'X')
    centre = base + C(0, 0, z)
    on_body = lambda r, f, u: centre + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (lean + 80 * fall, 0, sway + (-40 * wind + 40 * cut))
    squash = 1 - .55 * fall
    for i, (r, wide) in enumerate(((-.2, .3), (0, .24), (.2, .3))):
        parts[f'coat{i}'] = solid(base + C(r, 0, .64 * squash), (wide * (1 + .5 * fall), .34, 1.3 * squash), (lean * .4 + 40 * fall, 0, sway * .3))
    parts['chest'] = solid(on_body(0, 0, .18), (.68, .36, .62), turn)
    parts['head'] = solid(on_body(0, .02, .74), (.3, .3, .42), turn)
    for s, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}pad'] = solid(on_body(s * .42, 0, .46), (.32, .34, .22), turn)
    # Upright beside it at rest. Wound far back and low, then swung through a wide arc in front.
    rest_low, rest_top = C(.6, 0, .08) + base, C(.6, 0, 2.8) + base
    a = math.radians(-120 * wind + 70 * cut)
    swing_dir = C(math.sin(a), math.cos(a), 0)
    hold_at = centre + C(0, .1, -.3) + swing_dir * .3
    low, top = rest_low.lerp(hold_at - swing_dir * .9, hold), rest_top.lerp(hold_at + swing_dir * 1.8 + C(0, 0, -.6), hold)
    if fall:
        low, top = low + C(.3 * fall, 0, -low.z * fall + .06 * fall), rest_top.lerp(C(1.8, 1.0, .08), fall)
    parts['snath'] = bar(low, top, .1)
    d = (top - low).normalized()
    out = d.cross(Vector((0, 0, 1)))
    # Standing upright there is no sideways to cross with, so the blade points the way it faces.
    out = out.normalized() if out.length > .2 else C(0, 1, 0)
    # One clean crescent from the head of the snath, curving out and back.
    points = [top + out * (.12 + k / 5 * 1.3) - d * (math.sin(k / 5 * math.pi) * -.28 + k / 5 * .5) for k in range(6)]
    for i in range(5):
        parts[f'edge{i}'] = bar(points[i], points[i + 1], .2 - .03 * i)
    limb(parts, 'rarm', on_body(.42, 0, .4), low.lerp(top, .42), .5, .5, C(.8, 0, -.2), .12)
    limb(parts, 'larm', on_body(-.42, 0, .4), low.lerp(top, .2), .5, .5, C(-.8, 0, -.2), .12)
    return parts


REAPER_ATTACK = dict(hold=[(0, 0), (10, 0), (28, 1), (92, 1), (116, 0)], wind=[(0, 0), (10, 0), (34, 1, 'out'), (54, 1), (60, 0, 'in')], cut=[(0, 0), (54, 0), (60, 1, 'in'), (80, 1), (100, .4), (112, 0)], drop=[(0, 0), (34, .28, 'out'), (54, .3), (60, .2), (80, .16), (112, 0)], lean=[(0, 0), (34, 8), (54, 8), (60, -14, 'in'), (80, -10), (112, 0)])
REAPER_HIT = dict(back=[(0, 0), (10, 0), (15, .18, 'out'), (46, 0)], lean=[(0, 0), (10, 0), (15, 12, 'out'), (46, 0)])
REAPER_DEATH = dict(back=[(0, 0), (10, 0), (15, .12, 'out')], lean=[(0, 0), (15, 10)], fall=[(0, 0), (18, 0), (58, 1, 'in'), (124, 1)])
REAPER = dict(
    ortho=5.8,
    mirror=('R',),
    parts=[(f'coat{i}', 'box', 'white' if i == 1 else 'black') for i in range(3)] + [('chest', 'box', 'black'), ('head', 'box', 'white'), ('rpad', 'box', 'white'), ('lpad', 'box', 'white'), ('snath', 'box', 'black')] + [(f'edge{i}', 'box', 'white') for i in range(5)] + [(f'{s}arm{p}', 'box', 'black') for s in 'rl' for p in 'ab'],
    colours=dict(black=(.02, .02, .025), white=(.82, .82, .84)),
    actions=dict(
        idle=dict(pose=lambda f: reaper(sway=1.5 * math.sin(2 * math.pi * f / BREATH), drop=.015 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=lambda f: reaper(lean=-5 * blended(f)[0], sway=6 * blended(f)[0] * math.sin(blended(f)[1])), travel=0, keys=(0, 48, 64, 80)),
        attack=dict(pose=lambda f: reaper(**tracks(REAPER_ATTACK, f)), travel=0, keys=(0, 34, 54, 60, 80, 110)),
        **common(REAPER_HIT, REAPER_DEATH, reaper),
    ),
)

# The elites are the same bodies, drawn from four sides.
CIRCULAR, RETRAINED, FORMATTER = dict(ARBALEST, ortho=5.2, mirror=()), dict(KNIGHT, ortho=5.8, mirror=('DR', 'UL')), dict(REAPER, ortho=6.2, mirror=('DR', 'UL'))

# ---- B02 Thousand-Faced Proofreader: a floating mask in a collar of stiff pages and mirror plates. No body. ----
def proofreader(float_z=0., fan=0., tilt=0., turn_fan=0., side=0., sag=0., back=0., shatter=0., shake=0., pulse=0.):
    parts = {}
    z = 2.1 + float_z - .9 * sag - 1.35 * shatter
    centre = C(shake, -back, z)
    parts['mask'] = solid(centre + C(0, .18, 0), (1.3, .45, 1.9), (tilt, 0, 0))
    for s, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}eye'] = solid(centre + C(s * .27, .42, .16), (.34, .03, .06), (tilt, 0, s * 8))
    for i in range(12):
        # A closed collar stands close behind the mask; open, it spreads out like a peacock's tail.
        a = math.radians(-105 + i * (210 / 11) + turn_fan)
        reach = (.55 + .95 * fan) * (1 + .5 * shatter)
        at = centre + C(math.sin(a) * reach, -.2 - .1 * (i % 2), math.cos(a) * reach * (1 - .1 * sag) - .1 - 1.1 * shatter * (.3 + abs(math.sin(a))))
        mirror = i % 3 == 1
        size = (.22 if mirror else .3, .05, (1.3 + .5 * fan) * (1 + .12 * pulse))
        parts[f'blade{i}'] = solid(at, size, (tilt * .6 + 40 * shatter * (i % 2), -math.degrees(a) * (.3 + .7 * fan), 0))
    if side > 0:
        for s, name in ((1, 'r'), (-1, 'l')):
            parts[f'{name}side'] = solid(centre + C(s * 2.1, .1, -.1), (.42 * side, .05, 1.9 * side), (0, 0, s * -12))
    return parts


PROOF_ACTIONS = dict(
    prism_lance=dict(fan=[(0, 0), (10, 0), (30, .7, 'out'), (72, .7), (100, 0)], tilt=[(0, 0), (10, 0), (30, -18, 'out'), (50, -18), (56, 8, 'in'), (72, 4), (100, 0)], pulse=[(0, 0), (30, 0), (50, 1), (60, 1), (72, 0)]),
    mirror_split=dict(fan=[(0, 0), (10, 0), (34, 1, 'out'), (60, 1), (70, .1, 'in'), (100, 0)], float_z=[(0, 0), (34, .2), (60, .2), (100, 0)], shake=[(0, 0), (124, 0)], pulse=[(0, 0), (34, 1), (60, 1), (70, 0)]),
    mirror_sweep=dict(fan=[(0, 0), (10, 0), (30, 1, 'out'), (84, 1), (106, 0)], turn_fan=[(0, 0), (30, -40, 'out'), (46, -40), (70, 40, 'in'), (84, 40), (106, 0)], tilt=[(0, 0), (30, 6), (70, -8), (106, 0)]),
    decoy_break=dict(shake=[(0, 0), (124, 0)], fan=[(0, 0), (10, 0), (20, .5, 'out'), (46, .2), (80, 0)], tilt=[(0, 0), (10, 0), (18, 14, 'out'), (60, 0)], back=[(0, 0), (10, 0), (18, .2, 'out'), (60, 0)]),
    stagger=dict(sag=[(0, 0), (10, 0), (24, .7, 'out'), (76, .7), (108, 0)], tilt=[(0, 0), (24, 22), (76, 22), (108, 0)], fan=[(0, 0), (24, .35), (76, .35), (108, 0)]),
    phase_change=dict(fan=[(0, 0), (12, 0), (40, 1, 'out'), (84, 1), (110, .1)], float_z=[(0, 0), (40, .3), (84, .3), (110, 0)], side=[(0, 0), (52, 0), (78, 1, 'out'), (124, 1)], pulse=[(0, 0), (40, 1), (84, 1), (110, 0)]),
    death=dict(fan=[(0, 0), (12, 0), (30, 1, 'out'), (70, 1)], shatter=[(0, 0), (26, 0), (70, 1, 'in'), (124, 1)], tilt=[(0, 0), (30, 20), (70, 50), (124, 50)]),
    enter=dict(shatter=[(0, 1), (14, 1), (60, 0, 'out')], fan=[(0, 1), (60, 1), (84, 1), (110, 0)], float_z=[(0, 0), (124, 0)]),
)


def proof_pose(name):
    channels = PROOF_ACTIONS[name]
    def pose(frame):
        p = tracks(channels, frame)
        if name in ('decoy_break', 'phase_change') and 14 < frame < 70:
            p['shake'] = .03 * math.sin(frame * 2.3)
        return proofreader(**p)
    return pose


PROOFREADER = dict(
    ortho=6.8,
    parts=[('mask', 'facet', 'ivory'), ('reye', 'box', 'void'), ('leye', 'box', 'void'), ('rside', 'box', 'mirror'), ('lside', 'box', 'mirror')] + [(f'blade{i}', 'box', 'mirror' if i % 3 == 1 else 'ivory') for i in range(12)],
    colours=dict(ivory=(.76, .7, .58), void=(.02, .02, .03), mirror=(.42, .38, .56)),
    actions=dict(
        idle=dict(pose=lambda f: proofreader(float_z=.07 * breath(f), fan=.04 * breath(f)), travel=0, keys=(0, 62, 93)),
        move=dict(pose=lambda f: proofreader(float_z=.08 * math.sin(blended(f)[1]) * blended(f)[0], tilt=-8 * blended(f)[0], fan=.1 * blended(f)[0]), travel=0, keys=(0, 48, 64, 80)),
        **{k: dict(pose=proof_pose(k), travel=0, keys=(0, 30, 50, 72, 100)) for k in PROOF_ACTIONS},
    ),
)


# ---- B03 Overfit Icon: a huge statue that never turns. Its left arm ends in a stamping hammer, its right in a long blade, and its chest is an empty ring. ----
def icon(left_up=0., left_down=0., right_back=0., right_cut=0., both=0., crack=0., sag=0., rise=0., lean=0., arm_off=0., ruin=0.):
    parts = {}
    pedestal = C(0, 0, .4)
    parts['ped0'] = solid(pedestal, (4.6, 3.2, .8))
    parts['ped1'] = solid(C(0, 0, 1.0), (3.6, 2.6, .5))
    z = 3.0 - .7 * sag - 1.2 * ruin + 2.6 * (rise - 1) * (rise < 1 and rise > 0)
    chest = C(0, 0, z + 1.3)
    tilt = Matrix.Rotation(math.radians(lean + 30 * ruin), 4, 'X')
    on_body = lambda r, f, u: chest + (tilt @ C(r, f, u).to_4d()).to_3d()
    turn = (lean + 30 * ruin, 0, 0)
    parts['skirt'] = solid(C(0, 0, 1.25 + .8 * (1 - ruin * .6)), (2.4, 1.6, 1.8 * (1 - .5 * ruin)))
    parts['torso'] = solid(on_body(0, -.1, 0), (2.6, 1.4, 2.3), turn)
    parts['ring'] = solid(on_body(0, .62, .02), (1.5, 1.5, 1.5), (90 + lean + 30 * ruin, 0, 0))
    parts['glass'] = solid(on_body(0, .58, .02), (1.3, 1.3, .03), (90 + lean + 30 * ruin, 0, 0))
    parts['head'] = solid(on_body(0, 0, 1.75), (1.0, .95, 1.05), turn)
    parts['visor'] = solid(on_body(0, .49, 1.78), (.66, .03, .12), turn)
    parts['crown'] = solid(on_body(0, 0, 2.5), (.3, .3, .5), turn)
    for s, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}pad'] = solid(on_body(s * 1.75, 0, .9), (1.2, 1.3, .9), turn)
    # Its right arm, on the viewer's left, carries the blade.
    r_shoulder = on_body(1.75, 0, .6)
    r_hand = C(2.9, 1.1, 2.0).lerp(C(4.0, -1.6, 3.2), right_back).lerp(C(-1.4, 3.4, 1.8), right_cut).lerp(C(2.9, 1.7, 5.9), both)
    if ruin:
        r_hand = r_hand.lerp(C(3.6, 1.8, .3), ruin)
    end = limb(parts, 'rarm', r_shoulder, r_hand, 1.7, 1.7, C(1, -.2, -.2), .62)
    sweep = (Vector((-.1, -.35, -.93)).lerp(Vector((-.3, 1, .18)), max(right_back, right_cut, both))).normalized()
    parts['blade'] = bar(end, end + sweep * 3.3, .24)
    # Its left arm, on the viewer's right, carries the hammer.
    l_shoulder = on_body(-1.75, 0, .6)
    l_hand = C(-2.9, 1.1, 2.2).lerp(C(-3.1, .9, 7.2), left_up).lerp(C(-1.8, 2.9, 1.2), left_down).lerp(C(-2.9, 1.7, 6.2), both)
    if ruin or arm_off:
        l_hand = l_hand.lerp(C(-3.8, 1.8, .4), max(ruin, arm_off))
    end = limb(parts, 'larm', l_shoulder, l_hand, 1.8, 1.8, C(-1, -.2, -.2), .68)
    parts['hammer'] = solid(end + C(0, 0, .3 * left_up - .1), (1.5, 1.5, 1.05))
    if crack > 0:
        for s, name in ((1, 'a'), (0, 'b'), (-1, 'c')):
            parts[f'chain{name}'] = bar(on_body(s * .7, .66, -.5), C(s * 2.2, 2.6, .1), .22 * crack)
    return parts


ICON_ACTIONS = dict(
    sweep=dict(right_back=[(0, 0), (10, 0), (36, 1, 'out'), (54, 1), (66, 0, 'in')], right_cut=[(0, 0), (54, 0), (66, 1, 'in'), (82, 1), (106, 0)], lean=[(0, 0), (36, 5), (54, 5), (66, -6), (106, 0)]),
    stamp=dict(left_up=[(0, 0), (10, 0), (38, 1, 'out'), (54, 1), (60, 0, 'in')], left_down=[(0, 0), (54, 0), (60, 1, 'in'), (84, 1), (108, 0)], lean=[(0, 0), (38, 5), (54, 5), (60, -8), (108, 0)]),
    ritual=dict(both=[(0, 0), (10, 0), (40, 1, 'out'), (84, 1), (110, 0)], lean=[(0, 0), (40, 4), (84, 4), (110, 0)]),
    arm_break=dict(arm_off=[(0, 0), (12, 0), (24, 1, 'out'), (76, 1), (108, 0)], lean=[(0, 0), (12, 0), (20, 6, 'out'), (76, 3), (108, 0)], sag=[(0, 0), (14, 0), (24, .2), (76, .2), (108, 0)]),
    stagger=dict(sag=[(0, 0), (10, 0), (24, .7, 'out'), (78, .7), (110, 0)], lean=[(0, 0), (24, 9), (78, 9), (110, 0)]),
    phase_change=dict(both=[(0, 0), (14, 0), (44, 1, 'out'), (124, 0)], crack=[(0, 0), (40, 0), (70, 1, 'out'), (124, 1)], lean=[(0, 0), (44, 4), (84, 4), (124, 0)]),
    death=dict(ruin=[(0, 0), (16, 0), (80, 1, 'in'), (124, 1)], crack=[(0, 0), (124, 0)], lean=[(0, 0), (16, 0), (80, 6), (124, 6)]),
    enter=dict(rise=[(0, 0.001), (10, .001), (70, 1, 'out'), (124, 1)], both=[(0, 0), (70, 0), (92, 1, 'out'), (108, 1), (124, 0)]),
)
ICON = dict(
    ortho=12.6,
    fixed=True,
    parts=[('ped0', 'box', 'stone'), ('ped1', 'box', 'stone'), ('skirt', 'box', 'iron'), ('torso', 'box', 'iron'), ('ring', 'ring', 'gold'), ('glass', 'cyl', 'glass'), ('head', 'box', 'iron'), ('visor', 'box', 'void'), ('crown', 'box', 'gold'), ('rpad', 'box', 'iron'), ('lpad', 'box', 'iron'), ('blade', 'box', 'steel'), ('hammer', 'box', 'iron')]
    + [(f'{s}arm{p}', 'box', 'iron') for s in 'rl' for p in 'ab'] + [(f'chain{n}', 'box', 'gold') for n in 'abc'],
    colours=dict(stone=(.1, .1, .11), iron=(.17, .17, .18), gold=(.7, .48, .12), glass=(.5, .55, .55), void=(.5, .03, .02), steel=(.42, .42, .44)),
    actions=dict(
        idle=dict(pose=lambda f: icon(sag=.03 * breath(f)), travel=0, keys=(0, 62, 93)),
        **{k: dict(pose=(lambda name: lambda f: icon(**tracks(ICON_ACTIONS[name], f)))(k), travel=0, keys=(0, 30, 54, 66, 84, 110)) for k in ICON_ACTIONS},
    ),
)


# ---- B04 NULL: a floating half-black half-white core inside a square, a hexagonal and a triangular frame of slabs. Never a ring with a line through it. ----
def null(spin=0., flat=0., open_frames=0., core=0., split=0., pulse=0., fall=0., gather=0.):
    parts = {}
    z = 3.0 - 2.5 * fall
    centre = C(0, 0, z)
    size = 2 * (1 + .2 * core - .4 * fall)
    parts['coreb'] = solid(centre + C(-size * .2 - split * .35, 0, 0), (size * .55, size, size))
    parts['corew'] = solid(centre + C(size * .2 + split * .35, 0, 0), (size * .55, size, size))
    frames = ((4, 2.35, 'black', (22, 18, 45)), (6, 2.75, 'white', (-30, 10, 0)), (3, 3.2, 'black', (12, -34, 90)))
    for f, (sides, radius, colour, (rx, ry, rz)) in enumerate(frames):
        r = radius * (1 + .35 * open_frames + .12 * pulse) * (1 - .86 * gather)
        tilt = Matrix.Rotation(math.radians(rx * (1 - flat) + 90 * flat), 4, 'X') @ Matrix.Rotation(math.radians(ry * (1 - flat)), 4, 'Y') @ Matrix.Rotation(math.radians(rz + spin * (1 if f % 2 else -1) * (1 + f * .3)), 4, 'Z')
        behind = C(0, -1.0 * flat, 0)
        for k in range(sides):
            a, b = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
            p, q = Vector((math.cos(a) * r, math.sin(a) * r, 0)), Vector((math.cos(b) * r, math.sin(b) * r, 0))
            pa, pb = (tilt @ p.to_4d()).to_3d() + centre + behind, (tilt @ q.to_4d()).to_3d() + centre + behind
            mid = pa.lerp(pb, .5)
            drop = C(0, 0, -mid.z + .1) * fall
            parts[f'frame{f}_{k}'] = bar(pa.lerp(pb, .07) + drop, pa.lerp(pb, .93) + drop, .34)
    return parts


NULL_ACTIONS = dict(
    ring_fire=dict(open_frames=[(0, 0), (10, 0), (30, .6, 'out'), (56, .6), (62, 0, 'in'), (100, 0)], pulse=[(0, 0), (30, 0), (50, 1), (60, 1), (72, 0)], spin=[(0, 0), (124, 90)]),
    sector_pulse=dict(spin=[(0, 0), (30, 40, 'out'), (54, 40), (70, 150, 'in'), (124, 180)], pulse=[(0, 0), (40, 1), (54, 1), (66, 0)]),
    core_beam=dict(flat=[(0, 0), (10, 0), (34, 1, 'out'), (90, 1), (112, 0)], split=[(0, 0), (34, 0), (46, 1, 'out'), (88, 1), (104, 0)]),
    collapse=dict(gather=[(0, 0), (10, 0), (40, 1, 'in'), (54, 1), (60, 0, 'out')], pulse=[(0, 0), (54, 0), (60, 2.4, 'out'), (84, 0)], spin=[(0, 0), (54, 200)]),
    expose=dict(open_frames=[(0, 0), (10, 0), (34, 1, 'out'), (86, 1), (110, 0)], core=[(0, 0), (34, 1, 'out'), (86, 1), (110, 0)], split=[(0, 0), (34, .4), (86, .4), (110, 0)]),
    stagger=dict(fall=[(0, 0), (10, 0), (26, .3, 'out'), (76, .3), (108, 0)], spin=[(0, 0), (26, 30), (76, 40), (108, 0)], open_frames=[(0, 0), (26, .3), (76, .3), (108, 0)]),
    phase_change=dict(open_frames=[(0, 0), (12, 0), (40, 1, 'out'), (80, 1), (110, 0)], spin=[(0, 0), (40, 120, 'out'), (80, 240), (110, 360)], core=[(0, 0), (40, 1), (80, 1), (110, 0)]),
    death=dict(split=[(0, 0), (20, 0), (60, 2.5, 'out'), (124, 2.5)], open_frames=[(0, 0), (20, 0), (60, .7, 'out')], fall=[(0, 0), (30, 0), (84, 1, 'in'), (124, 1)]),
    enter=dict(gather=[(0, 1), (14, 1), (70, 0, 'out')], spin=[(0, 240), (70, 0, 'out')], core=[(0, 1), (70, 0)]),
)
NULL_CORE = dict(
    ortho=9.5,
    parts=[('coreb', 'facet', 'black'), ('corew', 'facet', 'white')] + [(f'frame{f}_{k}', 'box', ('black', 'white', 'black')[f]) for f, n in enumerate((4, 6, 3)) for k in range(n)],
    colours=dict(black=(.03, .03, .035), white=(.8, .8, .82)),
    actions=dict(
        idle=dict(pose=lambda f: null(spin=f * .5, pulse=.2 * breath(f)), travel=0, keys=(0, 62, 93)),
        **{k: dict(pose=(lambda name: lambda f: null(**tracks(NULL_ACTIONS[name], f)))(k), travel=0, keys=(0, 30, 54, 66, 90, 110)) for k in NULL_ACTIONS},
    ),
)

# ---- Seed's decoy: a round plush doll that faces the camera and only hops. ----
def doll(z=0., squash=0., size=1., tilt=0., arms=0.):
    tall, wide = size * (1 - .5 * squash), size * (1 + .45 * squash)
    at = lambda r, u: C(r * wide, 0, z + u * tall)
    parts = dict(
        skirt=solid(at(0, .36), (1.0 * wide, 1.0 * wide, .72 * tall)),
        head=solid(at(0, 1.1), (1.08 * wide, 1.0 * wide, .98 * tall), (tilt, 0, 0)),
        hair=solid(at(0, 1.2) + C(0, -.05 * size, 0), (1.2 * wide, 1.05 * wide, .95 * tall), (tilt, 0, 0)),
    )
    for s, name in ((1, 'r'), (-1, 'l')):
        parts[f'{name}hand'] = solid(at(s * (.5 + .18 * arms), .55 + .2 * arms), (.28 * size, .28 * size, .28 * size))
        parts[f'{name}foot'] = solid(at(s * .22, .08), (.3 * size, .36 * size, .18 * tall))
    return parts


def doll_hop(f):
    hop = abs(math.sin(math.pi * f / 31))
    return doll(z=.5 * hop, squash=.25 * max(0, 1 - hop * 3.5), arms=hop)


DOLL_ACTIONS = dict(
    appear=dict(size=[(0, .25), (20, .25), (54, 1.12, 'out'), (72, .95), (90, 1)], arms=[(0, 0), (54, 1), (90, 0)]),
    hit=dict(squash=[(0, 0), (12, 0), (20, 1, 'out'), (46, 1), (66, -.15, 'out'), (84, 0)], arms=[(0, 0), (20, 1), (46, 1), (84, 0)], tilt=[(0, 0), (20, 10), (46, 10), (84, 0)]),
    disappear=dict(size=[(0, 1), (14, 1), (90, .04, 'in'), (124, .04)], z=[(0, 0), (14, 0), (90, .9), (124, .9)], arms=[(0, 0), (40, 1), (124, 1)]),
)
DOLL = dict(
    ortho=4.2,
    fixed=True,
    parts=[('skirt', 'cone', 'lilac'), ('rfoot', 'ball', 'lilac'), ('lfoot', 'ball', 'lilac'), ('rhand', 'ball', 'skin'), ('lhand', 'ball', 'skin'), ('head', 'ball', 'skin'), ('hair', 'ball', 'brown')],
    colours=dict(lilac=(.62, .5, .85), skin=(.9, .78, .72), brown=(.13, .08, .08)),
    actions=dict(
        idle=dict(pose=doll_hop, travel=0, keys=(0, 8, 15, 31, 46)),
        **{k: dict(pose=(lambda name: lambda f: doll(**tracks(DOLL_ACTIONS[name], f)))(k), travel=0, keys=(0, 20, 54, 72, 90)) for k in DOLL_ACTIONS},
    ),
)


CREATURES = dict(b01=CRAB, b02=PROOFREADER, b03=ICON, b04=NULL_CORE, decoy=DOLL, e01=WORM, e02=GUARD, e02e=VALIDATOR, e03=COURIER, e04=PRIEST, e05=PHANTOM, e06=ARBALEST, e06e=CIRCULAR, e07=JELLY, e08=THIEF, e09=KNIGHT, e09e=RETRAINED, e10=FURNACE, e11=SPIDER, e12=REAPER, e12e=FORMATTER)
