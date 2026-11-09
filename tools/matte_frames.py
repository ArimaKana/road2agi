"""Key the H3 frames of one take into RGBA PNGs: python tools/matte_frames.py idle DL v4

Thin steel blades and hair strands survive a colour key far better than a segmentation model, so the alpha
comes from green dominance measured against this clip's own background, then edges are un-mixed from the green.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage


# The pose sheet given to H3 reads pinker than the official turnaround (whites at G-16 against G-8) and the takes
# inherit that faithfully (G-17), so green is lifted to land back on the turnaround.
WHITE_GAIN = np.array([1.0, 1.04, 1.0], dtype=np.float32)


def smooth_alpha(dominance, bg_dominance):
    hi, lo = bg_dominance * 0.62, bg_dominance * 0.14
    return np.clip((hi - dominance) / (hi - lo), 0, 1)


def key_frame(rgb, bg, min_island, reach):
    dominance = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    bg_dominance = bg[1] - max(bg[0], bg[2])
    alpha = smooth_alpha(dominance, bg_dominance)
    solid = alpha > 0.5
    labels, count = ndimage.label(solid, structure=np.ones((3, 3)))
    if count:
        sizes = ndimage.sum_labels(solid, labels, index=np.arange(1, count + 1))
        # Keep the character plus any detached piece big enough to be a real part such as a blade fragment.
        keep = np.isin(labels, np.flatnonzero(sizes >= max(min_island, sizes.max() * 0.002)) + 1)
        keep = ndimage.binary_dilation(keep, iterations=reach)
        alpha = alpha * keep
    # Pinholes inside the figure are compression noise. Real gaps between limbs are far larger.
    holes = ndimage.binary_fill_holes(alpha > 0.5) & ~(alpha > 0.5)
    hole_labels, hole_count = ndimage.label(holes)
    if hole_count:
        hole_sizes = ndimage.sum_labels(holes, hole_labels, index=np.arange(1, hole_count + 1))
        alpha = np.where(np.isin(hole_labels, np.flatnonzero(hole_sizes < 24) + 1), 1.0, alpha)
    a = alpha[..., None]
    unmixed = np.where(a > 0.02, (rgb - (1 - a) * bg) / np.maximum(a, 0.02), rgb)
    unmixed = np.clip(unmixed, 0, 255)
    low, high = np.minimum(unmixed[..., 0], unmixed[..., 2]), np.maximum(unmixed[..., 0], unmixed[..., 2])
    # Over-estimating the green share turns un-mixed edges magenta, so partial pixels get a floor as well.
    floor = np.where(alpha < 0.98, low * 0.94, 0)
    unmixed[..., 1] = np.clip(unmixed[..., 1], floor, high + 6)
    return np.dstack([np.clip(unmixed * WHITE_GAIN, 0, 255), alpha * 255]).round().astype(np.uint8)


def main():
    action, direction, tag = sys.argv[1:4]
    src = f'art-source/h3/{action}/{direction}/{tag}/frames'
    out = f'art-source/h3/{action}/{direction}/{tag}/rgba'
    os.makedirs(out, exist_ok=True)
    files = sorted(f for f in os.listdir(src) if f.endswith('.png'))
    first = np.asarray(Image.open(f'{src}/{files[0]}').convert('RGB'), dtype=np.float32)
    border = np.concatenate([first[:8].reshape(-1, 3), first[-8:].reshape(-1, 3), first[:, :8].reshape(-1, 3), first[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    min_island = int(first.shape[0] * first.shape[1] * 0.00004)
    # How far past the solid figure soft edges are kept, in pixels of an 896 take. Scaled, or a small take keeps a fringe of background.
    reach = max(1, round(3 * first.shape[0] / 896))
    report = []
    for name in files:
        rgb = np.asarray(Image.open(f'{src}/{name}').convert('RGB'), dtype=np.float32)
        rgba = key_frame(rgb, bg, min_island, reach)
        Image.fromarray(rgba, 'RGBA').save(f'{out}/{name}')
        solid = rgba[..., 3] > 128
        ys, xs = np.nonzero(solid)
        report.append(dict(frame=name, area=int(solid.sum()), bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None))
    areas = np.array([r['area'] for r in report], dtype=np.float64)
    jump = np.abs(np.diff(areas)) / np.maximum(areas[:-1], 1)
    summary = dict(background=[round(float(v), 1) for v in bg], size=list(first.shape[:2]), frames=len(files), meanArea=float(areas.mean()),
                   areaJumpMax=float(jump.max()), areaJumpFrame=int(jump.argmax()), frameStats=report)
    with open(f'{out}/matte.json', 'w', encoding='utf8') as fh:
        json.dump(summary, fh, indent=0)
    print(action, direction, tag, 'bg', summary['background'], 'frames', len(files), 'max area jump', round(summary['areaJumpMax'], 3), 'at', summary['areaJumpFrame'])


main()
