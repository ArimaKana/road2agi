"""Render the 60-second gameplay trailer. Run from any directory; see docs/宣传片制作.md."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FPS, SR, END = 30, 48000, 60
BEAT = 60 / 152.14
SPLICE = 80 * BEAT + .040
FINAL_HIT = 87.315 - SPLICE


def beat(index):
    return .283 + .394370 * index


def frame(seconds):
    return round(seconds * FPS)


def run(args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-5000:])
    return result.stdout


def ffmpeg(*args):
    return run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args])


# Every partner gets a separate shot, including the three support skills.
# Cuts include each portrait entrance and the corresponding gameplay effect.
SKILLS = [
    ('kimi', 'Kimi · 月棱折光', 23, 29, 'skill-kimi', .40),
    ('minimax', 'MiniMax · 万象片场', 29, 33, 'skill-minimax', .40),
    ('gemini', 'Gemini · 双星闪袭', 33, 38, 'skill-gemini', .40),
    ('grok', 'Grok · 绯月惑心', 38, 43, 'skill-grok', .40),
    ('glm', 'GLM · 狐影渗透', 43, 49, 'skill-glm', .40),
    ('qwen', 'Qwen · 千问无界', 49, 57, 'skill-qwen', .40),
    ('seed', 'Seed · 豆包应援', 57, 65, 'skill-seed', .40),
    ('gpt', 'GPT · 重置会话', 65, 71, 'skill-gpt', .40),
    ('claude', 'Claude · 封禁裁决', 71, 77, 'skill-claude', .40),
]


def timeline(clips=None):
    shots = []

    def add(name, start, end, source, source_in, **extra):
        shots.append(dict(name=name, start=frame(start), end=frame(end), source=source,
                          source_in=frame(source_in), **extra))

    add('opening-strike', 0, beat(5), 'opening-strike', .40)
    add('opening-dash', beat(5), beat(9), 'opening-dash', .40)
    add('opening-charge', beat(9), beat(17), 'opening-charge', .40)
    add('partners', beat(17), beat(23), 'partners', .40)
    for card, caption, start, end, source, source_in in SKILLS:
        add('skill-' + card, beat(start), beat(end), source, source_in, card=card)
    add('story-system', beat(77), beat(85), 'story-system', .40)
    add('story-deepseek', beat(85), beat(93), 'story-deepseek', .40)
    for index in range(4):
        source = 'region-' + str(index + 1)
        add(source, beat(93 + 4 * index), beat(97 + 4 * index), source, .40)
    add('trial', beat(109), beat(117), 'trial', .40)
    for index in range(4):
        source = 'boss-' + str(index + 1)
        add(source, beat(117 + 4 * index), beat(121 + 4 * index), source, .40)
    add('ultimate', beat(133), FINAL_HIT, 'ultimate', .40)
    add('poster', FINAL_HIT, END, 'Road_to_AGI_横版海报.png', 0, poster=True)
    assert shots[0]['start'] == 0 and shots[-1]['end'] == END * FPS
    assert all(a['end'] == b['start'] for a, b in zip(shots, shots[1:]))
    card_source = (ROOT / 'game/src/game/cards.ts').read_text(encoding='utf-8')
    card_ids = set(re.findall(r"^  (\w+): \{ id:", card_source, re.M))
    assert {s['card'] for s in shots if 'card' in s} == card_ids
    assert len(SKILLS) == len(card_ids)
    if clips is not None:
        revision = run(['git', '-C', ROOT, 'log', '-1', '--format=%H', '--', 'game']).decode().strip()
        hero_hash = hashlib.sha256((ROOT / 'game/public/assets/hero.json').read_bytes()).hexdigest()
        required = {
            'opening-strike': 'attack', 'opening-dash': 'dash', 'opening-charge': 'chargeFull',
            'skill-kimi': 'kimiBolt', 'skill-minimax': 'trainStart', 'skill-gemini': 'geminiDash',
            'skill-grok': 'grokWave', 'skill-glm': 'glmThread', 'skill-qwen': 'qwenOff',
            'skill-seed': 'seedHeal', 'skill-gpt': 'gptReset', 'skill-claude': 'claudeStrike',
            'ultimate': 'ultPunch',
        }
        for shot in shots:
            if shot.get('poster'):
                continue
            report = json.loads((clips / (shot['source'] + '.json')).read_text(encoding='utf-8'))
            assert report['gameRevision'] == revision, f"Stale game footage: {shot['name']}"
            assert report['heroSha256'] == hero_hash, f"Stale hero artwork: {shot['name']}"
            shot['source_in'] = frame(report['marks']['in'])
            assert report['frames'] >= shot['source_in'] + shot['end'] - shot['start'], f"Short footage: {shot['name']}"
            if shot['name'] in required:
                start = shot['source_in'] / FPS
                end = start + (shot['end'] - shot['start']) / FPS
                assert any(e['type'] == required[shot['name']] and start <= e['time'] < end
                           for e in report['marks']['events']), f"Edit misses the action: {shot['name']}"
            shot['recordedAt'] = report['recordedAt']
            shot['gameRevision'] = report['gameRevision']
            shot['heroSha256'] = report['heroSha256']
    return shots


def captions():
    result = []

    def add(start, end, text, size=64, x=960, y=902, halo=True):
        result.append(dict(start=start, end=end, text=text, size=size, x=x, y=y, halo=halo))

    add(.25, beat(17) - .12, '刺剑连击 · 滑步 · 蓄力突刺')
    add(beat(17) + .08, beat(23) - .08, '九位 AI 伙伴 · 三卡出战', size=56, x=600)
    for _, text, start, end, _, _ in SKILLS:
        add(beat(start) + .04, beat(end) - .04, text)
    add(beat(93) + .08, beat(109) - .10, '四大区 · 二十八间房', size=32, y=807, halo=False)
    for index, name in enumerate(['缓存废港', '镜像书库', '梯度熔炉', '零域']):
        add(beat(93 + index * 4) + .04, beat(97 + index * 4) - .04, name)
    add(beat(109) + .10, beat(117) - .10, '无尽试炼 · 冲击排行榜')
    add(beat(117) + .08, beat(133) - .10, '四大 Boss', size=32, y=807, halo=False)
    for index, name in enumerate(['缓存典狱长', '千面校对官', '过拟合圣像', '归零之心 NULL']):
        add(beat(117 + index * 4) + .04, beat(121 + index * 4) - .04, name)
    # The ultimate has no promotional text; the landscape poster contains its own logo.
    return result


def prepare_font(work, source):
    # Existing local art tooling can be reused without installing into global Python.
    if (ROOT / 'qa/font-tools').is_dir():
        sys.path.insert(0, str(ROOT / 'qa/font-tools'))
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    font = TTFont(source, recalcTimestamp=False)
    chars = ''.join(item['text'] for item in captions())
    points = set(map(ord, chars)) | set(range(32, 127))
    missing = points - set(font.getBestCmap())
    if missing:
        raise ValueError(f'Font lacks: {sorted(missing)}')
    options = subset.Options()
    options.name_IDs = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=points)
    sub.subset(font)
    if 'fvar' in font:
        instantiateVariableFont(font, {'wght': 800}, inplace=True)
    font['OS/2'].usWeightClass = 800
    font['OS/2'].fsSelection = (font['OS/2'].fsSelection | 32) & ~64
    font['head'].macStyle |= 1
    for platform, encoding, language in [(3, 1, 0x409), (1, 0, 0)]:
        for name_id, value in {1: 'R2A Promo Serif', 2: 'ExtraBold', 4: 'R2A Promo Serif ExtraBold',
                               6: 'R2APromoSerif-ExtraBold', 16: 'R2A Promo Serif', 17: 'ExtraBold'}.items():
            font['name'].setName(value, name_id, platform, encoding, language)
    fonts = work / 'fonts'
    fonts.mkdir(exist_ok=True)
    font.save(fonts / 'R2APromoSerif-ExtraBold.ttf')
    return fonts


def ass_time(seconds):
    value = round(seconds * 100)
    return f'{value // 360000}:{value // 6000 % 60:02d}:{value // 100 % 60:02d}.{value % 100:02d}'


def build_captions(work):
    header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Gold,R2A Promo Serif,64,&H009AD5F0,&H000000FF,&H00201509,&H80000000,-1,0,0,0,100,100,3,0,1,1,1,2,40,40,178,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    lines = []

    def line(layer, item, content):
        lines.append(f"Dialogue: {layer},{ass_time(item['start'])},{ass_time(item['end'])},Gold,,0,0,0,,{content}")

    for item in captions():
        text, size, x, y = (item[key] for key in ('text', 'size', 'x', 'y'))
        common = rf'\an2\pos({x},{y})\fs{size}\fad(120,120)'
        if item['halo']:
            # A blurred navy ellipse behind the line, with no rectangular box edges.
            width = min(1420, max(700, sum(1 if ord(c) > 127 else .58 for c in text) * size + 180))
            middle = width / 2
            ellipse = f'm 0 54 b 0 24 {middle * .45:.1f} 0 {middle:.1f} 0 b {width - middle * .45:.1f} 0 {width:.1f} 24 {width:.1f} 54 b {width:.1f} 84 {width - middle * .45:.1f} 108 {middle:.1f} 108 b {middle * .45:.1f} 108 0 84 0 54'
            line(0, item, rf'{{\an5\pos({x},{y - 37})\fad(120,120)\p1\c&H201207&\alpha&H68&\bord0\shad0\blur28}}' + ellipse)
        line(1, item, '{' + common + r'\c&H201207&\3c&H201207&\bord5\blur7\shad0\alpha&H20&}' + text)
        line(2, item, '{' + common + r'\c&H78B9ED&\3c&H78B9ED&\bord1.2\blur4\shad0\alpha&H98&}' + text)
        line(3, item, '{' + common + r'\c&H9AD5F0&\3c&H201509&\bord.8\blur.2\shad1}' + text)
    path = work / 'captions.ass'
    path.write_text(header + '\n'.join(lines) + '\n', encoding='utf-8-sig')
    return path


def build_music(work):
    # Keep the original bar-aligned soundtrack edit and natural ending.
    raw = run(['ffmpeg', '-v', 'error', '-i', ROOT / '当然可以好问题.m4a', '-ac', 2, '-ar', SR, '-f', 'f32le', '-'])
    samples = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    a = round((.29 + 81 * BEAT) * SR)
    b = round((.29 + 81 * BEAT + SPLICE) * SR)
    crossfade = int(.030 * SR)
    half = crossfade // 2
    t = np.linspace(0, 1, crossfade)[:, None]
    mix = samples[a-half:a-half+crossfade] * np.cos(t * np.pi / 2) + samples[b-half:b-half+crossfade] * np.sin(t * np.pi / 2)
    music = np.concatenate([samples[:a-half], mix, samples[b-half+crossfade:]])[:END * SR]
    music = np.pad(music, ((0, max(0, END * SR - len(music))), (0, 0)))
    music[:int(.05 * SR)] *= np.linspace(0, 1, int(.05 * SR))[:, None]
    start, end = int(58.4 * SR), int(59.5 * SR)
    music[start:end] *= (.5 + .5 * np.cos(np.linspace(0, np.pi, end-start)))[:, None]
    music[end:] = 0
    raw_path, path = work / 'music-raw.wav', work / 'music.wav'
    pcm = (np.clip(music, -1, 1) * 32767).astype('<i2').tobytes()
    run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', SR, '-ac', 2, '-i', '-', raw_path], input=pcm)
    measurement = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(raw_path), '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, check=True).stderr.decode()
    data = json.loads(measurement[measurement.rindex('{'):measurement.rindex('}') + 1])
    normalise = 'loudnorm=I=-14:TP=-1:LRA=11:linear=true:' + ':'.join([
        f"measured_I={data['input_i']}", f"measured_TP={data['input_tp']}", f"measured_LRA={data['input_lra']}",
        f"measured_thresh={data['input_thresh']}", f"offset={data['target_offset']}"])
    ffmpeg('-i', raw_path, '-af', normalise, '-ar', SR, '-c:a', 'pcm_s16le', path)


def build_shots(work, clips):
    files = []
    # Browser JPEG captures are full-range BT.601; the PNG poster is RGB.
    # Normalize every source before concat, which otherwise inherits the first
    # clip's full-range tag and washes out the limited-range poster.
    colors = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
    scale = 'scale=1920:1080:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1'
    encode = ['-c:v', 'libx264', '-preset', 'fast', '-crf', 13, '-threads', 6, '-pix_fmt', 'yuv420p', *colors, '-r', FPS, '-an']
    shots = timeline(clips)
    for index, shot in enumerate(shots):
        count = shot['end'] - shot['start']
        output = work / f'shot-{index:02d}.mp4'
        if shot.get('poster'):
            # Full 16:9 artwork and its authentic logo, no duplicate title or crop.
            ffmpeg('-loop', 1, '-framerate', FPS, '-i', ROOT / 'art' / shot['source'],
                   '-vf', scale + ',fade=t=in:d=0.18:color=white',
                   '-frames:v', count, *encode, output)
        else:
            source = clips / (shot['source'] + '.mp4')
            if not source.is_file():
                raise FileNotFoundError(f'Missing original footage: {source}')
            start = shot['source_in']
            end = shot.get('source_out', start + count)
            vf = f'trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS'
            if shot.get('stretch'):
                vf += f',setpts=PTS*{count}/{end-start},fps={FPS},tpad=stop_mode=clone:stop=3'
            vf += ',' + scale
            ffmpeg('-i', source, '-vf', vf, '-frames:v', count, *encode, output)
        actual = int(run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', output]))
        assert actual == count, f"{shot['name']}: expected {count} frames, got {actual}"
        files.append(output)
        print(f"{index:02d} {shot['name']:18s} {shot['start']/FPS:6.2f}-{shot['end']/FPS:6.2f}s", flush=True)
    (work / 'timeline.json').write_text(json.dumps(shots, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    listing = work / 'shots.txt'
    listing.write_text(''.join("file '" + path.as_posix().replace("'", "'\\''") + "'\n" for path in files), encoding='utf-8')
    ffmpeg('-f', 'concat', '-safe', 0, '-i', listing, '-c', 'copy', work / 'video.mp4')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clips', type=Path, default=ROOT / 'art-source/promo/current/clips')
    parser.add_argument('--work', type=Path, default=ROOT / 'qa/video-revision/build')
    parser.add_argument('--out', type=Path, default=ROOT / 'art/Road_to_AGI_游戏介绍.mp4')
    parser.add_argument('--font', type=Path, default=ROOT / 'qa/font-source/NotoSerifSC.ttf')
    parser.add_argument('--steps', default='music,shots,final', help='Comma-separated music,shots,final; captions/font are always updated')
    args = parser.parse_args()
    args.work = args.work.resolve()
    args.work.mkdir(parents=True, exist_ok=True)
    timeline()
    fonts = prepare_font(args.work, args.font)
    ass = build_captions(args.work)
    steps = args.steps.split(',')
    if 'music' in steps:
        build_music(args.work)
    if 'shots' in steps:
        build_shots(args.work, args.clips)
    if 'final' in steps:
        saved_timeline = json.loads((args.work / 'timeline.json').read_text(encoding='utf-8'))
        assert saved_timeline == timeline(args.clips), 'Footage or edit points changed; rebuild with --steps shots,final'
        args.out.parent.mkdir(parents=True, exist_ok=True)
        escape = lambda path: path.as_posix().replace(':', r'\:').replace("'", r"\'")
        vf = f"subtitles='{escape(ass)}':fontsdir='{escape(fonts)}'"
        with tempfile.NamedTemporaryFile(prefix='.promo-', suffix='.tmp', dir=args.out.parent, delete=False) as pending:
            rendered = Path(pending.name)
        try:
            ffmpeg('-i', args.work / 'video.mp4', '-i', args.work / 'music.wav', '-vf', vf, '-map', '0:v', '-map', '1:a',
                   '-c:v', 'libx264', '-preset', 'slow', '-crf', 19, '-threads', 8, '-profile:v', 'high', '-level', '4.1',
                   '-pix_fmt', 'yuv420p', '-r', FPS, '-g', 60, '-maxrate', '12M', '-bufsize', '24M',
                   '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                   '-c:a', 'aac', '-b:a', '256k', '-ar', SR, '-movflags', '+faststart', '-t', END,
                   '-metadata', 'title=Road to AGI 游戏介绍', '-f', 'mp4', rendered)
            probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', rendered]))
            video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
            assert (video['width'], video['height'], video['r_frame_rate']) == (1920, 1080, '30/1')
            assert int(video['nb_frames']) == END * FPS
            assert (video['pix_fmt'], video['color_range'], video['color_space']) == ('yuv420p', 'tv', 'bt709')
            assert (audio['codec_name'], audio['sample_rate'], audio['channels']) == ('aac', '48000', 2)
            assert abs(float(probe['format']['duration']) - END) < .04
            (args.work / 'export-check.json').write_text(json.dumps(probe, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            rendered.replace(args.out)
        finally:
            rendered.unlink(missing_ok=True)
        print(f'Final: {args.out}', flush=True)


if __name__ == '__main__':
    main()
