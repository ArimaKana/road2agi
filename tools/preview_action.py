"""QA video of clips played one after another at game speed and slowed down, in every direction they have.
python tools/preview_action.py qa/light-chain.mp4 light1 flurry
Forward travel carries over between clips, so a chain walks across its panel the way it does in the game.
"""
import json, subprocess, sys
from PIL import Image, ImageDraw

out, names = sys.argv[1], sys.argv[2:]
manifest = json.load(open('game/public/assets/hero.json', encoding='utf8'))
clips = [manifest['actions'][n] for n in names]
sheets = [{d: s for s in clip['sheets'] for d in s['directions']} for clip in clips]
directions = [d for d in manifest['directions'] if all(d in s for s in sheets)]
PX_PER_METRE = 118
# Screen direction of one metre of forward travel on the isometric camera.
FORWARD = {'UL': (-0.707, -0.408), 'UR': (0.707, -0.408), 'DL': (-0.707, 0.408), 'DR': (0.707, 0.408), 'U': (0, -0.577), 'D': (0, 0.577), 'L': (-1, 0), 'R': (1, 0)}
# Where a panel starts its figure, as a share of the panel: far enough back for a chain to walk forward into it.
START = {d: (0.5 - fx * 0.32, 0.67 - fy * 0.3) for d, (fx, fy) in FORWARD.items()}
quad_w, quad_h = 560, 500
columns = 2 if len(directions) <= 4 else 4
canvas_w, canvas_h = quad_w * columns, quad_h * ((len(directions) + columns - 1) // columns)
sprites = {}
for name, clip, by_direction in zip(names, clips, sheets):
    sprites[name] = {}
    for d in directions:
        sheet = by_direction[d]
        scale = PX_PER_METRE / sheet['masterPxPerMetre']
        w, h = int(sheet['masterCell'][0] * scale), int(sheet['masterCell'][1] * scale)
        sprites[name][d] = [Image.open(f"art-source/sequences/{clip['sequences']}/{d}/{i:03d}.png").convert('RGBA').resize((w, h), Image.LANCZOS) for i in range(clip['frames'])]


def compose(name, index, travelled):
    by_direction = sheets[names.index(name)]
    canvas = Image.new('RGB', (canvas_w, canvas_h), (35, 54, 71))
    draw = ImageDraw.Draw(canvas)
    for slot, d in enumerate(directions):
        ox, oy = (slot % columns) * quad_w, (slot // columns) * quad_h
        fx, fy = FORWARD[d]
        rx, ry = START[d][0] * quad_w + ox + fx * travelled * PX_PER_METRE, START[d][1] * quad_h + oy + fy * travelled * PX_PER_METRE
        draw.ellipse((rx - 24, ry - 12, rx + 24, ry + 12), outline=(120, 170, 190), width=2)
        draw.text((ox + 12, oy + 10), f'{d}  {name}', fill=(200, 225, 235))
        image = sprites[name][d][index]
        ax, ay = by_direction[d]['anchors'][d]
        px, py = int(rx - ax * image.width), int(ry - (1 - ay) * image.height)
        layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        left, top = max(-px, 0), max(-py, 0)
        layer.alpha_composite(image, (max(px, 0), max(py, 0)), (left, top))
        canvas.paste(layer.convert('RGB'), (0, 0), layer.getchannel('A'))
    return canvas


fps = 48
ffmpeg = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{canvas_w}x{canvas_h}', '-r', str(fps), '-i', '-',
                           '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
for slow, passes in ((1, 3), (4, 1)):
    frames = []
    travelled = 0.0
    for name, clip in zip(names, clips):
        order = clip.get('order') or list(range(clip['frames']))
        for i in order:
            frames.append((compose(name, i, travelled).tobytes(), round(fps / clip['fps']) * slow))
        travelled += clip['travel']
    for _ in range(passes):
        for data, hold in frames:
            for _ in range(hold):
                ffmpeg.stdin.write(data)
ffmpeg.stdin.close()
ffmpeg.wait()
print('preview', out)
