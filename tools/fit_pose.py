"""Re-place a pose picture on the first frame of one clip: python tools/fit_pose.py <action> <direction> [--hub <take action>]
H3 starts the figure where the picture shows it, and pose_small_* sits on the idle clip's framing. When a clip frames the
mannequin elsewhere the figure can slide across to it during the first frames, which shows up as a drifting take.
Writes refs/pose_small_<action>_<direction>.png, used with: comfy-r2v.mjs <action> <direction> --pose small_<action>

On small motions H3 also keeps the picture's stance instead of the mannequin's, and the design sheet does not hold the rapier
in the hub pose. --hub takes the figure from the settled last frames of a finished take of that action, which every action
starts and ends on, and writes refs/pose_hub_<action>_<direction>.png, used with: --pose hub_<action>

--from <direction> takes that figure from another direction's take. The turn clip starts from a direction she is already drawn
in, so its picture comes from there: fit_pose.py turn D --hub light1 --from DL. The directions with no design sheet then take
every picture from their own turn take: fit_pose.py run D --hub turn"""
import json, os, sys
import numpy as np
from PIL import Image

action, direction = sys.argv[1:3]
options = dict(zip(sys.argv[3::2], sys.argv[4::2]))
hub, source = options.get('--hub'), options.get('--from', direction)
SIZE = 896
HUB_FRAME = 120


def feet(mask):
    ys, xs = np.nonzero(mask)
    band = ys >= ys.max() - (ys.max() - ys.min()) * 0.06
    return (np.percentile(xs[band], 10) + np.percentile(xs[band], 90)) / 2, ys.max()


def metres(name, side):
    meta = json.load(open(f'art-source/reference3d/{name}/frames/reference.json', encoding='utf8'))
    return meta['directions'][side].get('pxPerMeter', meta['pxPerMeter'])


if hub:
    # The raw frame's colours, not the keyed ones: the matte's white gain would be applied a second time to the new take.
    # The hubs were all v4 until revive and get_up started from the end of a later take.
    take = next(t for t in (f'art-source/h3/{hub}/{source}/{tag}' for tag in ('v4', 'v10')) if os.path.exists(f'{t}/frames/{HUB_FRAME:04d}.png'))
    raw = Image.open(f'{take}/frames/{HUB_FRAME:04d}.png').convert('RGB')
    alpha = Image.open(f'{take}/rgba/{HUB_FRAME:04d}.png').convert('RGBA').getchannel('A')
    k = metres(action, direction) / metres(hub, source)
    out = f'art-source/h3/refs/pose_hub_{action}_{direction}.png'
else:
    raw = Image.open(f'art-source/h3/refs/pose_small_{direction}.png').convert('RGB')
    a = np.asarray(raw).astype(int)
    alpha = Image.fromarray((((a[..., 1] - np.maximum(a[..., 0], a[..., 2])) < 60) * 255).astype(np.uint8))
    k = metres(action, direction) / metres('idle', direction)
    out = f'art-source/h3/refs/pose_small_{action}_{direction}.png'
box = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
cut, mask = raw.crop(box), alpha.crop(box)
size = (round(cut.width * k), round(cut.height * k))
cut, mask = cut.resize(size, Image.LANCZOS), mask.resize(size, Image.LANCZOS)
first = np.asarray(Image.open(f'art-source/reference3d/{action}/frames/{direction}/0000.png').convert('RGBA'))[..., 3] > 128
fx, fy = feet(np.asarray(mask) > 128)
rx, ry = feet(first)
scale = SIZE / first.shape[1]
canvas = Image.new('RGB', (SIZE, SIZE), (0, 255, 0))
canvas.paste(cut, (round(rx * scale - fx), round(ry * scale - fy)), mask)
canvas.save(out)
print(out, 'scale', round(k, 3), 'shoes at', round(rx * scale), round(ry * scale))
