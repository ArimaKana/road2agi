"""Make every missing reference and take of the enemies, bosses and creations named in tools/h3-prompts/enemies.json.

python tools/enemy_batch.py refs [entities...]          render the blocking model, encode it and place the first picture
python tools/enemy_batch.py takes [entities...]         generate and key each take, skipping those already keyed
python tools/enemy_batch.py takes b03 --only idle --dirs D --tag v2 --seed 5       one sample or a retake

BLENDER gives the path to blender. An entity with no names means all of them, in the order below. Takes are 480 except the statue, whose picture is drawn large.
"""
import argparse, json, os, shutil, subprocess, sys
from pathlib import Path

ORDER = ['b01', 'e02e', 'e05', 'e06', 'e08', 'e09', 'e12', 'b03', 'b02', 'b04', 'e06e', 'e09e', 'e12e', 'decoy']
SIZE = {'b03': 768}
SEED = 20261103
words = json.loads(Path('tools/h3-prompts/enemies.json').read_text(encoding='utf8'))


def directions(entity):
    return ['D'] if entity in ('b03', 'decoy') else ['UL', 'UR', 'DL', 'DR'] if entity.endswith('e') else ['L', 'R']


def run(*command):
    done = subprocess.run(command, capture_output=True, text=True, encoding='utf8', errors='replace')
    return done.returncode, (done.stdout + done.stderr).strip().splitlines()


def refs(entity, only, dirs):
    blender = os.environ.get('BLENDER') or shutil.which('blender') or 'blender'
    for action in only or words[entity]['motions']:
        missing = [d for d in dirs if not Path(f'art-source/reference3d/{entity}_{action}/{entity}_{action}_{d}_512.mp4').exists()]
        if missing:
            code, lines = run(blender, '-b', '--factory-startup', '-noaudio', '--python', 'tools/reference3d/build_creature.py', '--', '--entity', entity, '--action', action, '--dirs', ','.join(missing))
            notes = [l for l in lines if any(k in l for k in ('WARNING', 'Error', 'Traceback'))]
            print(f'{entity}_{action} {",".join(missing)} rendered, exit {code}', *notes[-2:], flush=True)
            code, lines = run('node', 'tools/reference3d/encode-clips.mjs', f'{entity}_{action}', ','.join(missing))
            if code:
                print('ENCODE FAILED', entity, action, lines[-1:], flush=True)
                continue
        for d in dirs:
            code, lines = run(sys.executable, '-I', 'tools/fit_enemy_pose.py', entity, action, d)
            if code:
                print('POSE FAILED', entity, action, d, lines[-1:], flush=True)
    print(f'REFS_DONE {entity}', flush=True)


def takes(entity, only, dirs, tag, seed, size=None):
    for action in only or words[entity]['motions']:
        for d in dirs:
            name = f'{entity}_{action}'
            if tag == 'v1' and list(Path(f'art-source/h3/{name}/{d}').glob('*/rgba/matte.json')):
                continue
            if Path(f'art-source/h3/{name}/{d}/{tag}/rgba/matte.json').exists():
                continue
            code, lines = run('node', 'tools/comfy-r2v.mjs', name, d, '--tag', tag, '--seed', str(seed), '--size', str(size or SIZE.get(entity, 480)))
            print(lines[-1][:200] if lines else f'{name} {d}: no output', flush=True)
            if code:
                continue
            code, lines = run(sys.executable, '-I', 'tools/matte_frames.py', name, d, tag)
            if code:
                print('MATTE FAILED', name, d, lines[-1:], flush=True)
    print(f'TAKES_DONE {entity}', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('step', choices=('refs', 'takes'))
    parser.add_argument('entities', nargs='*')
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--dirs', nargs='*')
    parser.add_argument('--tag', default='v1')
    parser.add_argument('--seed', type=int, default=SEED)
    parser.add_argument('--size', type=int)
    args = parser.parse_args()
    for entity in args.entities or ORDER:
        dirs = args.dirs or directions(entity)
        if args.step == 'refs':
            refs(entity, args.only, dirs)
        else:
            takes(entity, args.only, dirs, args.tag, args.seed, args.size)
    print('BATCH_DONE', flush=True)


main()
