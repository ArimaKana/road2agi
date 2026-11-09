"""Generate the effect flipbooks of bosses, enemies and mechanisms that the painted set did not cover: python tools/vfx_batch.py [ids...]
Each becomes art-source/vfx/vfx-<id>.png, and tools/vfx_exports.py turns it into game/public/assets/vfx/fx-<id>.webp. A picture that exists is skipped. Several run at once, since codex does the work elsewhere.
"""
import os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HEAD = """Use your image generation tool to create exactly one image. Do not write or edit any files in this directory. In your final message, give the full path of the generated PNG.

Asset: one effect flipbook for Road to AGI, a 2D anime action game seen from a fixed high angle. SQUARE 1254x1254 with a real TRANSPARENT background (alpha channel, no background colour, no checkerboard). A strict invisible 2x2 grid of four frames, played in the order top left, top right, bottom left, bottom right. In each frame the effect stays inside its own cell with clear empty space around it, centred on the same point.

Style: clean anime game effect, bold simple shapes with crisp cel-shaded edges and a soft glow, readable at 96 pixels. Effect only: no characters, no faces, no floor, no background, no text, no letters, no numbers, no logos, no photographic smoke. Never a circle or ring with a straight line through it, and no hexagon with a bar in it. No bright green, unless green is named below.

Effect: """
TAIL = """

After generating, check that the PNG really has an alpha channel with transparent corners. Clean edges with no halo.
"""
EFFECTS = {
    '301': 'a heavy charge setting off: a burst of slate-blue grit kicked up behind, then thick straight speed streaks in cyan-white stretching across the cell, fading to thin lines. Frame one is the burst, frame four the last thin streaks.',
    '302': 'a cache tank bursting open to release small creatures: round pale cyan liquid splashes with rusty metal rivets flung outward from the centre, growing then scattering into droplets.',
    '303': 'mirror plates assembling: sharp violet and ivory glass shards flying inward from all sides, meeting at the centre in a bright flash, then a clean diamond of light that fades.',
    '304': 'one thing splitting into three: a bright ivory flash at the centre with torn stiff paper pages and violet glass shards fanning out to the left and right, leaving two faint violet afterimage trails.',
    '305': 'three heavy gold chains made of stiff gold-edged pages bursting up from below: frame one three gold cracks, frame two chains shooting upward, frame three chains at full height with gold sparks, frame four chains settled and glowing softly.',
    '306': 'a summoning from the floor: concentric thin cyan ripples opening outward on a low flat ellipse, with small teal square data sparks rising from them, then fading.',
    '307': 'a figure splitting apart into copies: loose ivory paper pages flutter out to both sides from a pale violet flash, each trailing a dashed thin outline, and dissolve.',
    '308': 'a hard landing: a plum-dark ring of dust flattened on a low ellipse, with sharp ivory paper strips and two thin silver slash glints snapping outward, then dissipating.',
    '309': 'a furnace venting: rising bands of orange and amber heat shimmer from a low ellipse, with bright ember sparks and a white-hot core that swells then cools to dull red.',
    '310': 'a thread of light being pulled tight: a thin amber line with glowing beads travelling along it from left to right across the cell, ending in a small six-spark starburst.',
    '311': 'a fuse burning down: small hot red-orange sparks spitting from a point with quick thin spark trails, getting faster and brighter in each frame, ending in a bright white flash.',
    '312': 'a soft comic hit on a plush toy: lilac and pink rounded stars and small puffs of stuffing popping outward, with a squashed lilac impact shape in the middle, cheerful and light.',
    '313': 'speed being stolen: cyan chevron streaks and small wisps torn away and sucked sideways toward the right edge of the cell in a plum-coloured swirl, thinning out to nothing.',
    '321': 'a heavy press slamming down: a flat wide impact shape with rust-brown grit and teal metal sparks bursting outward along a low ellipse, with a pale shock line, then settling dust.',
    '322': 'a pressure valve firing: a thick cone-shaped jet of pale cyan steam shooting from the centre to the right of the cell, turbulent at the edge, then thinning into wisps.',
    '323': 'a mirror reflecting a bolt: a bright violet-white starburst at the centre with sharp straight rays and glass glints, the rays shortening over the frames.',
    '324': 'a heavy bookcase scraping along the floor: a low arc of ivory dust and torn paper scraps thrown out to the right, with small violet sparks.',
    '325': 'a hot vent blast: a wide flat ring of orange fire expanding outward on a low ellipse, with a clear gap on its right side, bright white-orange at its leading edge and dull red behind, ember sparks above it.',
    '326': 'a stamping machine striking: a heavy square impact shape in amber and charcoal with hard radial cracks and bright molten sparks, then cooling to dull red.',
    '327': 'a scanning line passing: a straight vertical pure white and cold blue bar with thin horizontal glitch ticks and small black square fragments streaming off it to the left.',
    '328': 'a block of the world being erased: a square area breaking into small black and white pixels-like squares with cold blue crack lines, the squares drifting upward and vanishing.',
    '329': 'a beacon switching on: a cold blue and white diamond flare with a thin vertical pillar of light and two expanding thin rings on a low ellipse.',
    '330': 'a machine-like enemy coming apart: small hard grey and pale blue plates and square fragments flying a short way outward from the centre, with a thin white flash that is gone by the second frame, the pieces shrinking to nothing. Small and quick, leaving nothing that hides the floor.',
    '331': 'a weak point laid bare: four sharp pale gold brackets closing in on the centre from the four diagonal corners around a thin bright gold diamond, which pulses and then holds, with no fill in the middle so that what is behind it stays visible.',
    '332': 'a screen-wide formatting shield forming: thin black and white geometric lines and cold blue grid squares sweeping outward from the centre in a large thin ring, with the middle left completely empty so that nothing behind it is hidden.',
    '333': 'nine bright streaks of light in nine different colours, gold, blue, violet, cyan, coral, white, orange, pink and purple, spiralling inward from the edges of the cell to meet at one point at the centre, ending in one clean white star.',
}


def make(key):
    tag = f'vfx-{key}'
    folder = Path('art-source/vfx')
    if (folder / f'{tag}.png').exists():
        return f'{tag} exists'
    (folder / f'{tag}.prompt.txt').write_text(HEAD + EFFECTS[key] + TAIL, encoding='utf8')
    done = subprocess.run(['bash', 'tools/card-gen.sh', tag], env=dict(os.environ, OUT=str(folder).replace('\\', '/')), capture_output=True, text=True, encoding='utf8', errors='replace')
    return (done.stdout.strip().splitlines() or done.stderr.strip().splitlines() or [f'{tag}: nothing'])[-1]


with ThreadPoolExecutor(4) as pool:
    for line in pool.map(make, sys.argv[1:] or list(EFFECTS)):
        print(line, flush=True)
print('VFX_DONE', flush=True)
