"""Flag takes that H3 drifted on: python tools/qa_takes.py <tag> <direction> [action ...]
Compares each keyed frame with the mannequin mask at the same frame, reporting scale jumps, drift and silhouettes cut by the frame edge.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

tag, direction = sys.argv[1:3]
actions = sys.argv[3:] or sorted(os.path.basename(p) for p in glob.glob('art-source/reference3d/*'))


def stats(path, threshold=128):
    a = np.asarray(Image.open(path).convert('RGBA'))[..., 3] > threshold
    ys, xs = np.nonzero(a)
    return a.shape[0], ys.min(), ys.max(), xs.min(), xs.max(), a.sum()


for action in actions:
    folder = f'art-source/h3/{action}/{direction}/{tag}/rgba'
    if not os.path.isdir(folder):
        continue
    heights, tops, bottoms, rows = [], [], [], []
    edge = []
    for f in range(0, 124, 4):
        size, y0, y1, x0, x1, area = stats(f'{folder}/{f:04d}.png')
        rs, ry0, ry1, rx0, rx1, _ = stats(f'art-source/reference3d/{action}/frames/{direction}/{f:04d}.png')
        k = size / rs
        heights.append((y1 - y0) / ((ry1 - ry0) * k))
        tops.append(y0 - ry0 * k)
        bottoms.append(y1 - ry1 * k)
        if y0 <= 1 or x0 <= 1 or y1 >= size - 2 or x1 >= size - 2:
            edge.append(f)
    h = np.array(heights)
    # The mannequin is the yardstick, so a jump relative to it is drift in the take rather than the pose changing.
    jump = np.abs(np.diff(h))
    print(f'{action:7s} {direction} height/ref {h.min():.2f}-{h.max():.2f} median {np.median(h):.2f} | biggest step {jump.max():.3f} near frame {int(jump.argmax()) * 4} | top offset {min(tops):.0f}..{max(tops):.0f}px bottom {min(bottoms):.0f}..{max(bottoms):.0f}px | touches frame edge at {edge if edge else "none"}')
