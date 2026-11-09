"""Pose data for every reference clip. Each attack leaves from and returns to IDLE, so any two actions join without a pop.

Positions are in the character's starting frame (see C), so a forward step simply lands further along. `travel` is the
total forward distance in metres the body ends up from where it started, which the game also moves the hero by.
"""
import math
from mathutils import Vector


def C(r, f, u):
    """Character axes (anatomical right, forward, up) to armature-space metres."""
    return Vector((-r, -f, u))


POSITIONS = ('hips', 'rfoot', 'lfoot', 'rhand', 'lhand')


def at(pose, distance):
    """The same pose standing further forward."""
    return dict(pose, **{k: pose[k] + C(0, distance, 0) for k in POSITIONS})


# Spec 3.1: upright with relaxed shoulders, rapier tip low and forward, left hand drawn back.
IDLE = dict(
    hips=C(-0.01, 0.0, 0.94), hips_yaw=16, hips_lean=1, chest_yaw=22, chest_lean=3, head_yaw=2, head_lean=6,
    rfoot=C(0.08, 0.20, 0.084), rfoot_yaw=6, rfoot_up=0, lfoot=C(-0.12, -0.18, 0.084), lfoot_yaw=36, lfoot_up=0,
    rhand=C(0.20, 0.34, 1.00), blade=C(0.14, 1, -0.42), rpole=C(0.4, -0.2, -1), lhand=C(-0.30, -0.18, 1.00), lpole=C(-0.5, -0.5, -0.6),
    lcurl=22)


def idle_pose(frame):
    # Full breath every 62 frames. Frame 0 is the shared hub pose, so idle starts exactly where attacks end.
    w = (1 - math.cos(2 * math.pi * frame / 62)) / 2
    return dict(IDLE, hips=IDLE['hips'] + C(0, 0, -0.012 * w), chest_lean=IDLE['chest_lean'] + 1.2 * w, head_lean=IDLE['head_lean'] + 1 * w,
                rhand=IDLE['rhand'] + C(0, 0, -0.012 * w), lhand=IDLE['lhand'] + C(0, -0.015 * w, -0.018 * w))


def turn_left(frame):
    # Degrees of camera swing still to come: the figure starts one facing round from the clip's own direction and pivots into it.
    t = max(0.0, min(1.0, (frame - 24) / 60))
    return 45 * (1 - t * t * (3 - 2 * t))


RUN_CYCLE = 48
RUN_BLEND = 36
# Tight framing makes H3 fall back to the scale of the design sheet instead of following the mannequin, so in-place clips
# use the same wide framing as the attacks. Takes then keep one figure size across every action.
WIDE_FRAME = 3.6


def sprint_pose(frame):
    # In place, the game supplies the speed. Six frames a cycle at 8 fps is 2.7 steps a second, so at the hero's speed a step covers about 1.6 m:
    # long bounding strides, the front knee driven up and the back leg stretched out, both feet off the floor between them.
    # A swordswoman's sprint: the torso leans in with the left shoulder leading, the empty left hand reaches out ahead and the rapier trails behind at the end of the right arm.
    phase = 2 * math.pi * frame / RUN_CYCLE
    stride, lift = 0.56, 0.34

    def foot(ph):
        ph %= 2 * math.pi
        swing = ph > math.pi
        rise = math.sin(ph - math.pi) if swing else 0.0
        return stride * math.cos(ph), lift * rise, -35 * rise

    rf, ru, rt = foot(phase)
    lf, lu, lt = foot(phase + math.pi)
    bob = math.cos(2 * phase)
    sway = math.cos(phase)
    return dict(IDLE, hips=C(-0.01, 0.10, 0.87 + 0.03 * bob), hips_yaw=-8 + 12 * sway, hips_lean=18, chest_yaw=-26 - 6 * sway, chest_lean=30, head_yaw=0, head_lean=-10,
                rfoot=C(0.09, rf + 0.08, 0.084 + ru), rfoot_yaw=4, rfoot_up=rt, lfoot=C(-0.09, lf + 0.08, 0.084 + lu), lfoot_yaw=8, lfoot_up=lt,
                rhand=C(0.36, -0.50 - 0.05 * sway, 1.00 + 0.02 * bob), blade=C(0.22, -1, -0.28), rpole=C(0.8, -0.2, -0.3),
                lhand=C(-0.16, 0.66 + 0.05 * sway, 1.14 + 0.02 * bob), lpole=C(-0.6, -0.1, -0.9), lcurl=14)


def run_pose(frame):
    # H3 follows the picture it starts from, and that shows the hub pose with the rapier in front. So the clip starts there too and swings into the sprint,
    # or half the directions keep the rapier in front. The game only picks frames after the blend.
    w = min(1.0, frame / RUN_BLEND)
    w = w * w * (3 - 2 * w)
    sprint = sprint_pose(frame)
    return {k: IDLE[k].lerp(v, w) if isinstance(v, Vector) else IDLE[k] + (v - IDLE[k]) * w for k, v in sprint.items()}


# Every attack opens the body up: a coil with the left hand reaching forward, then a long lunge with the sword arm at full stretch and the left arm flung back.
TH_COIL = dict(IDLE, hips=C(-0.03, -0.14, 0.85), hips_yaw=32, hips_lean=0, chest_yaw=48, chest_lean=-2, head_yaw=2, head_lean=8, rfoot=C(0.08, 0.22, 0.084), lfoot=C(-0.16, -0.30, 0.084), rhand=C(0.26, -0.02, 1.26), blade=C(0.02, 1, 0.12), rpole=C(0.5, -0.4, -0.8), lhand=C(-0.02, 0.42, 1.16), lpole=C(-0.4, -0.2, -1), lcurl=10)
TH_STEP = dict(TH_COIL, hips=C(-0.02, 0.22, 0.86), chest_lean=8, rfoot=C(0.07, 0.70, 0.20), rfoot_up=24, rhand=C(0.16, 0.72, 1.24), blade=C(0, 1, 0.03), rpole=C(0.3, -0.2, -1), lhand=C(-0.20, 0.02, 1.08))
TH_HIT = dict(IDLE, hips=C(-0.03, 0.60, 0.68), hips_yaw=30, hips_lean=8, chest_yaw=50, chest_lean=20, head_yaw=2, head_lean=12, rfoot=C(0.06, 1.18, 0.084), rfoot_up=0, lfoot=C(-0.16, -0.10, 0.084), lfoot_yaw=40, rhand=C(0.03, 1.62, 1.14), blade=C(0, 1, -0.02), rpole=C(0.2, 0, -1), lhand=C(-0.34, -0.40, 1.10), lpole=C(-0.7, -0.1, -0.5), lcurl=8)
TH_SETTLE = dict(TH_HIT, hips=C(-0.03, 0.62, 0.66), chest_lean=23, rhand=C(0.03, 1.66, 1.10), blade=C(0, 1, -0.05))

# Third light hit: into a lunge and four thrusts along it, level, high, low, then the deepest one, drawing the arm right back between them.
FL_BASE = dict(IDLE, hips=C(-0.03, 0.46, 0.72), hips_yaw=28, hips_lean=6, chest_yaw=44, chest_lean=15, head_yaw=2, head_lean=10, rfoot=C(0.07, 0.98, 0.084), lfoot=C(-0.16, -0.12, 0.084), lfoot_yaw=40, rpole=C(0.2, 0, -1), lhand=C(-0.36, -0.46, 1.08), lpole=C(-0.7, -0.1, -0.5), lcurl=8)
FL_OUT1 = dict(FL_BASE, chest_yaw=52, rhand=C(0.06, 1.50, 1.22), blade=C(0, 1, 0.02))
FL_BACK = dict(FL_BASE, hips=C(-0.03, 0.40, 0.73), chest_yaw=30, chest_lean=10, rhand=C(0.22, 0.62, 1.26), blade=C(0.03, 1, 0.08), rpole=C(0.5, -0.3, -0.8))
FL_OUT2 = dict(FL_BASE, chest_yaw=50, chest_lean=10, rhand=C(0.10, 1.46, 1.46), blade=C(0.02, 1, 0.20))
FL_OUT3 = dict(FL_BASE, chest_yaw=54, chest_lean=22, rhand=C(0.04, 1.54, 0.98), blade=C(-0.02, 1, -0.16))
FL_OUT4 = dict(FL_BASE, hips=C(-0.04, 0.70, 0.62), hips_yaw=30, chest_yaw=56, chest_lean=26, head_lean=14, rfoot=C(0.06, 1.30, 0.084), lfoot=C(-0.16, 0.02, 0.084), rhand=C(0.02, 1.92, 1.06), blade=C(0, 1, -0.05), lhand=C(-0.30, -0.40, 0.90))
FL_SETTLE = dict(FL_OUT4, chest_lean=28, rhand=C(0.02, 1.96, 1.02), blade=C(0, 1, -0.07))

# The charged thrust: wound right back low with the sword beside the head and the left hand aimed down the line, then a charge across the frame.
CH_DRAW = dict(IDLE, hips=C(-0.06, -0.24, 0.72), hips_yaw=46, hips_lean=2, chest_yaw=78, chest_lean=-6, head_yaw=0, head_lean=8, rfoot=C(0.06, 0.34, 0.084), lfoot=C(-0.18, -0.52, 0.084), lfoot_yaw=46, rhand=C(0.36, -0.34, 1.46), blade=C(0.06, 1, -0.02), rpole=C(0.7, -0.6, -0.4), lhand=C(0.06, 0.72, 1.30), lpole=C(-0.4, -0.1, -1), lcurl=6)
CH_STEP = dict(CH_DRAW, hips=C(-0.04, 0.40, 0.76), hips_yaw=44, chest_lean=14, rfoot=C(0.05, 1.10, 0.22), rfoot_up=28, rhand=C(0.12, 1.10, 1.26), blade=C(0, 1, 0.0), rpole=C(0.3, -0.2, -1), lhand=C(-0.10, 0.12, 1.00))
CH_HIT = dict(CH_STEP, hips=C(-0.04, 1.10, 0.60), chest_yaw=66, chest_lean=28, head_lean=16, rfoot=C(0.05, 1.82, 0.084), rfoot_up=0, lfoot=C(-0.16, 0.46, 0.084), rhand=C(0.02, 2.30, 1.00), blade=C(0, 1, -0.08), rpole=C(0.2, 0, -1), lhand=C(-0.30, 0.46, 0.90), lpole=C(-0.7, 0, -0.4))
CH_SETTLE = dict(CH_HIT, hips=C(-0.04, 1.14, 0.58), chest_lean=31, rhand=C(0.02, 2.36, 0.96), blade=C(0, 1, -0.10))

DASH_CROUCH = dict(IDLE, hips=C(-0.01, 0.02, 0.86), hips_yaw=10, chest_yaw=14, chest_lean=18, head_lean=14, rhand=C(0.18, 0.38, 0.92), blade=C(0.06, 1, -0.30), lhand=C(-0.30, -0.24, 0.94))
DASH_GLIDE = dict(DASH_CROUCH, hips=C(0.0, 0.10, 0.80), hips_yaw=6, chest_yaw=8, chest_lean=32, head_lean=22, rfoot=C(0.08, 0.52, 0.084), lfoot=C(-0.08, -0.40, 0.16), lfoot_yaw=10, lfoot_up=-20, rhand=C(0.12, 0.62, 0.84), blade=C(0, 1, -0.24), lhand=C(-0.26, -0.40, 0.96), lpole=C(-0.5, -0.4, -0.6))
DASH_BRAKE = dict(IDLE, hips=C(-0.02, -0.04, 0.84), hips_yaw=14, chest_yaw=18, chest_lean=6, rfoot=C(0.10, 0.30, 0.084), lfoot=C(-0.12, -0.20, 0.084), rhand=C(0.20, 0.34, 0.96), blade=C(0.12, 1, -0.36))

CAST_RAISE = dict(IDLE, hips=C(0.0, 0.0, 0.96), hips_yaw=10, chest_yaw=12, chest_lean=-4, head_yaw=2, head_lean=-2, rhand=C(0.30, 0.04, 0.96), blade=C(0.35, 0.55, -1), rpole=C(0.5, 0.2, -1), lhand=C(-0.46, 0.20, 1.72), lpole=C(-0.8, -0.3, -0.2), lcurl=8)
CAST_HOLD = dict(CAST_RAISE, hips=C(0.0, 0.0, 0.97), head_lean=-4, lhand=C(-0.46, 0.20, 1.76))

# The rest of the first playable set. A dash that ends in a thrust: stays low out of the glide, then straight into the lunge.
# Presenting a card and touching something both lower the sword to the right side and use the empty left hand. Hit reels back a little, death goes down on one knee and slumps.
SUM_RAISE = dict(CAST_RAISE, chest_yaw=20, chest_lean=2, head_lean=4, lhand=C(-0.24, 0.52, 1.38), lpole=C(-0.8, -0.2, -0.6), lcurl=4)
SUM_HOLD = dict(SUM_RAISE, lhand=C(-0.24, 0.56, 1.42))
TOUCH = dict(CAST_RAISE, hips=C(0.0, 0.04, 0.92), chest_yaw=10, chest_lean=12, head_lean=14, lhand=C(-0.12, 0.56, 1.02), lpole=C(-0.7, -0.1, -0.6), lcurl=6)
REEL = dict(IDLE, hips=C(-0.01, -0.12, 0.92), hips_lean=-4, chest_yaw=30, chest_lean=-12, head_lean=-8, rhand=C(0.28, 0.22, 1.06), lhand=C(-0.34, -0.06, 1.14))
REEL_BACK = dict(REEL, hips=C(-0.01, -0.08, 0.92), chest_lean=-6, head_lean=-2)
KNEEL = dict(IDLE, hips=C(-0.02, 0.06, 0.50), hips_yaw=10, hips_lean=8, chest_yaw=14, chest_lean=26, head_yaw=0, head_lean=30, rfoot=C(0.14, 0.38, 0.084), rfoot_yaw=6, lfoot=C(-0.14, -0.40, 0.10), lfoot_yaw=20, lfoot_up=-30, rhand=C(0.24, 0.52, 0.42), blade=C(0.06, 0.6, -1), rpole=C(0.7, -0.2, -0.6), lhand=C(-0.26, 0.30, 0.56), lpole=C(-0.7, -0.2, -0.3), lcurl=30)
SLUMP = dict(KNEEL, hips=C(-0.06, 0.02, 0.40), hips_yaw=16, hips_lean=14, chest_yaw=22, chest_lean=46, head_lean=44, rhand=C(0.30, 0.50, 0.26), lhand=C(-0.24, 0.46, 0.30), lcurl=40)
SALUTE = dict(IDLE, chest_lean=-2, head_lean=4, rhand=C(0.10, 0.26, 1.46), blade=C(0, 0.04, 1), rpole=C(0.6, -0.3, -0.7), lhand=C(-0.30, -0.26, 1.02), lpole=C(-0.7, -0.3, -0.5))
SALUTE_BOW = dict(SALUTE, chest_lean=6, head_lean=20)

ARM_LEAD = {'rhand': 3, 'blade': 3, 'rpole': 3, 'lhand': -2, 'lpole': -2, 'head_lean': -2}


def clip(timeline, travel=0.0, lead=ARM_LEAD, **extra):
    """timeline: (frame, pose, easing into that key). All clips run 124 frames, the shortest length H3 is trained on."""
    keys = [t[0] for t in timeline]
    return dict(frames=124, fps=24, timeline=timeline, travel=travel, lead=lead, keys=keys[1:], **extra)


ACTIONS = {
    'idle': dict(frames=124, fps=24, pose_fn=idle_pose, travel=0.0, keys=[0, 31, 62, 93], ortho=WIDE_FRAME),
    # Not a game action. It carries the character from a direction she is drawn in to one she is not, to get a pose picture for it.
    'turn': dict(frames=124, fps=24, pose_fn=idle_pose, travel=0.0, keys=[0, 24, 54, 84, 123], ortho=WIDE_FRAME, turn=turn_left),
    'run': dict(frames=124, fps=24, pose_fn=run_pose, travel=0.0, keys=[48, 56, 64, 72, 80, 88], ortho=WIDE_FRAME),
    'dash': clip([(0, IDLE, None), (10, IDLE, 'inout'), (30, DASH_CROUCH, 'inout'), (42, DASH_GLIDE, 'out'), (66, DASH_GLIDE, 'linear'), (84, DASH_BRAKE, 'inout'), (106, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    # Light chain: the same long lunge twice, then the flurry. The picks in tools/pack-r2v.mjs land on the peaks, three frames before each key because the arm leads.
    'light1': clip([(0, IDLE, None), (10, IDLE, 'inout'), (28, TH_COIL, 'inout'), (40, TH_STEP, 'in'), (46, TH_HIT, 'out'), (60, TH_SETTLE, 'out'), (106, at(IDLE, 0.60), 'inout'), (123, at(IDLE, 0.60), 'inout')], travel=0.60, margins=(0.40, 0.26)),
    'flurry': clip([(0, IDLE, None), (8, IDLE, 'inout'), (24, TH_COIL, 'inout'), (34, FL_OUT1, 'in'), (42, FL_BACK, 'inout'), (50, FL_OUT2, 'in'), (58, FL_BACK, 'inout'), (66, FL_OUT3, 'in'), (74, FL_BACK, 'inout'), (84, FL_OUT4, 'in'), (96, FL_SETTLE, 'out'), (114, at(IDLE, 0.85), 'inout'), (123, at(IDLE, 0.85), 'inout')], travel=0.85, margins=(0.40, 0.26)),
    'charge': clip([(0, IDLE, None), (8, IDLE, 'inout'), (36, CH_DRAW, 'inout'), (46, CH_DRAW, 'linear'), (50, CH_STEP, 'in'), (54, CH_HIT, 'out'), (66, CH_SETTLE, 'out'), (80, CH_HIT, 'inout'), (112, at(IDLE, 1.45), 'inout'), (123, at(IDLE, 1.45), 'inout')], travel=1.45, margins=(0.40, 0.26)),
    'cast': clip([(0, IDLE, None), (8, IDLE, 'inout'), (38, CAST_RAISE, 'inout'), (70, CAST_HOLD, 'linear'), (110, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    # Into the lunge straight from a low glide. Same stretch as a light hit, so it lands the same distance from where it started.
    'dash_attack': clip([(0, IDLE, None), (8, IDLE, 'inout'), (26, DASH_GLIDE, 'inout'), (38, TH_STEP, 'in'), (44, TH_HIT, 'out'), (58, TH_SETTLE, 'out'), (106, at(IDLE, 0.60), 'inout'), (123, at(IDLE, 0.60), 'inout')], travel=0.60, margins=(0.40, 0.26)),
    'summon': clip([(0, IDLE, None), (8, IDLE, 'inout'), (32, SUM_RAISE, 'inout'), (70, SUM_HOLD, 'linear'), (106, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    'interact': clip([(0, IDLE, None), (8, IDLE, 'inout'), (34, TOUCH, 'inout'), (70, TOUCH, 'linear'), (106, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    'hit': clip([(0, IDLE, None), (10, IDLE, 'inout'), (16, REEL, 'out'), (34, REEL_BACK, 'inout'), (72, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    # She does not get up in this one: revive picks up from where it ends.
    'death': clip([(0, IDLE, None), (10, IDLE, 'inout'), (18, REEL, 'out'), (46, KNEEL, 'inout'), (90, SLUMP, 'inout'), (123, SLUMP, 'linear')], ortho=WIDE_FRAME),
    # The stride that starts and ends these two is the sprint itself, so they join the run without a pop. Like the run, neither moves through the frame: the game supplies the speed.
    'run_start': clip([(0, IDLE, None), (10, IDLE, 'inout'), (34, DASH_CROUCH, 'inout'), (70, sprint_pose(0), 'out'), (123, sprint_pose(0), 'linear')], ortho=WIDE_FRAME),
    'run_stop': clip([(0, IDLE, None), (6, IDLE, 'linear'), (30, sprint_pose(0), 'inout'), (48, sprint_pose(0), 'linear'), (72, DASH_BRAKE, 'out'), (108, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    # The same fall as death but quicker, ending low for get_up. The knee lands first.
    'knockdown': clip([(0, IDLE, None), (8, IDLE, 'inout'), (15, REEL, 'out'), (34, KNEEL, 'in'), (56, SLUMP, 'out'), (123, SLUMP, 'linear')], ortho=WIDE_FRAME),
    'get_up': clip([(0, SLUMP, None), (12, SLUMP, 'linear'), (40, KNEEL, 'inout'), (76, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    'victory': clip([(0, IDLE, None), (10, IDLE, 'inout'), (40, SALUTE, 'inout'), (58, SALUTE, 'linear'), (70, SALUTE_BOW, 'inout'), (84, SALUTE, 'inout'), (112, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
    'revive': clip([(0, SLUMP, None), (16, SLUMP, 'linear'), (56, KNEEL, 'inout'), (100, IDLE, 'inout'), (123, IDLE, 'inout')], ortho=WIDE_FRAME),
}
