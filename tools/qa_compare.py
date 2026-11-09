"""Side-by-side QA of a take: reference mannequin, key result on a dark plate, and the two overlaid.
python tools/qa_compare.py idle DL v4 out.png [frame ...]"""
import json, sys
from PIL import Image
action, direction, tag, out = sys.argv[1:5]
meta = json.load(open(f'art-source/reference3d/{action}/frames/reference.json', encoding='utf8'))
frames = [int(f) for f in sys.argv[5:]] or list(range(0, 124, 12))
cell = 360
sheet = Image.new('RGB', (cell * len(frames), cell * 3), (24, 34, 46))
for x, f in enumerate(frames):
    ref = Image.open(f'art-source/reference3d/{action}/frames/{direction}/{f:04d}.png').convert('RGBA').resize((cell, cell), Image.LANCZOS)
    gen = Image.open(f'art-source/h3/{action}/{direction}/{tag}/rgba/{f:04d}.png').convert('RGBA').resize((cell, cell), Image.LANCZOS)
    plate = Image.new('RGBA', (cell, cell), (24, 34, 46, 255))
    sheet.paste(Image.alpha_composite(plate, ref).convert('RGB'), (x * cell, 0))
    sheet.paste(Image.alpha_composite(plate, gen).convert('RGB'), (x * cell, cell))
    over = Image.alpha_composite(plate, gen)
    tint = ref.copy(); tint.putalpha(ref.getchannel('A').point(lambda v: int(v * 0.6)))
    sheet.paste(Image.alpha_composite(over, tint).convert('RGB'), (x * cell, cell * 2))
sheet.save(out)
print(sheet.size, 'frames', frames)
