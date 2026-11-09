// Run from any directory with Node.js and FFmpeg installed.
// Reuses project artwork, original gameplay clips and sourced game covers; does not generate artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'game/package.json'));
const sharp = require('sharp');
const out = path.join(root, 'docs/presentations/assets');
await fs.mkdir(out, { recursive: true });
const images = [
  ['hero', 'art/hero/deepseek-figure-v001.png', 900],
  ['hero-standing-rapier', 'art/hero/deepseek-standing-rapier-v002.png', 900],
  ['rapier', 'art-source/references/DeepSeek_刺剑结构_v001.png', 600],
  ['partners', 'art-source/cards/final/all-cards-contact.png', 1000],
  ['gpt', 'art-source/cards/final/gpt-figure.png', 700],
  ['minimax', 'art-source/cards/final/minimax-figure.png', 700],
  ['claude', 'art-source/cards/final/claude-figure.png', 700],
  ['xbot', 'art-source/reference3d/light1/frames/DL/0030.png', 600],
  ['generated', 'art-source/h3/light1/DL/v6/rgba/0030.png', 600],
  ['keyposes', 'art/hero/keypose/sheet.png', 1400],
  ['ultimate', 'qa/video-revision/ultimate-hit.png', 1440],
  ['gpt-skill', 'qa/video-revision/final-skill-gpt.png', 1440],
];
const manifest = [];
for (const [name, source, width] of images) {
  const output = `docs/presentations/assets/${name}.webp`;
  let image = sharp(path.join(root, source));
  // Crop only the blank margins of the supplied weapon sheet, retaining the whole weapon.
  const crop = name === 'rapier' ? { left: 330, top: 0, width: 380, height: 1536 } : null;
  if (crop) image = image.extract(crop);
  await image.resize({ width, withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(root, output));
  manifest.push({ output, source, ...(crop ? { crop } : {}), operation: 'Proportional resize and WebP encoding' });
}
const clips = [
  ['combat', 'combat-a', 1.2],
  ['environment', 'lib', 3.2],
  ['loop', 'combat-b', 4.0],
  ['qwen', 'skill-qwen', 1.8],
];
for (const [name, clip, seconds] of clips) {
  const source = `art-source/promo/clips/${clip}.mp4`;
  const output = `docs/presentations/assets/${name}.webp`;
  const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', path.join(root, source), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 16 * 1024 * 1024 });
  await sharp(frame).resize({ width: 1440 }).webp({ quality: 89 }).toFile(path.join(root, output));
  manifest.push({ output, source, seconds, operation: 'Single uncaptioned gameplay frame, proportionally resized' });
}
const animations = [
  ['xbot', 'art-source/reference3d/light1/frames/DL'],
  ['generated', 'art-source/h3/light1/DL/v6/rgba'],
  ['enemy-reference', 'art-source/reference3d/e11_attack/frames/L'],
  ['enemy-generated', 'art-source/h3/e11_attack/L/v1/rgba'],
];
for (const [name, dir] of animations) {
  const output = `docs/presentations/assets/${name}.gif`;
  const filter = "[1:v]select='not(mod(n\\,4))',scale=360:360:flags=lanczos,setpts=N/(10*TB),format=rgba[fg];"
    + "[0:v][fg]overlay=shortest=1,split[a][b];[a]palettegen=max_colors=220:stats_mode=diff[p];"
    + "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x08182D:s=360x360:r=10',
    '-framerate', '10', '-i', path.join(root, dir, '%04d.png'), '-filter_complex', filter,
    '-shortest', '-loop', '0', path.join(root, output)], { stdio: 'inherit' });
  manifest.push({ output, source: dir, frameStep: 4, fps: 10, operation: 'Animated GIF loop composited on the slide background' });
}
const { inspirationGames = [] } = JSON.parse(await fs.readFile(path.join(root, 'docs/presentations/road2agi-retrospective.json'), 'utf8'));
for (const game of inspirationGames) {
  const response = await fetch(game.imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not fetch ${game.name} cover: ${response.status}`);
  await sharp(Buffer.from(await response.arrayBuffer())).resize({ width: 600, withoutEnlargement: true })
    .webp({ quality: 90 }).toFile(path.join(root, game.cover));
  manifest.push({ output: game.cover, source: game.imageUrl, sourcePage: game.sourceUrl, subject: game.name, operation: 'Proportional resize and WebP encoding of the complete game cover' });
}
await fs.writeFile(path.join(root, 'docs/presentations/assets.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${manifest.length} presentation images.`);
