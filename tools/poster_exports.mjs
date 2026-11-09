// Render the game's real home-title fonts/CSS, then composite and crop the poster.
// Run from the repository root: node tools/poster_exports.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import sharp from './media-deps.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artwork = resolve(root, process.argv[2] ?? 'art/Road_to_AGI_横版海报_无字.png');
const output = join(root, 'art');
const [home, globalCss] = await Promise.all([
  readFile(join(root, 'game/src/components/HomeScreen.vue'), 'utf8'),
  readFile(join(root, 'game/src/style.css'), 'utf8'),
]);
const title = home.match(/<h1 class="home-title"[^>]*>[\s\S]*?<\/h1>/)?.[0];
let styles = home.match(/@font-face\{[^}]+\}|#home \.home-title(?: em)?\{[^}]+\}/g)?.join('\n');
const gold = globalCss.match(/--gold-hi:([^;]+);/)?.[1];
assert.ok(title && styles && gold, 'The game title markup, styles and color must exist.');
for (const name of ['r2a-title-capitals', 'r2a-title-script']) {
  const font = await readFile(join(root, `game/public/assets/fonts/${name}.woff2`));
  styles = styles.replace(`/assets/fonts/${name}.woff2`, `data:font/woff2;base64,${font.toString('base64')}`);
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}#home{display:inline-block;padding:12px;--gold-hi:${gold}}
#home h1{margin:0;white-space:nowrap}${styles}
#home .home-title{font-size:76px}
</style></head><body><div id="home">${title}</div></body></html>`;

const candidates = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch {}
}
assert.ok(executable, 'Install Chrome/Edge or set CHROME_PATH.');
const qa = join(root, 'qa/poster');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'chrome-'));
let browser, ws, next = 0, browserError;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
try {
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-sync', '--disable-background-networking', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => { browserError = error; });
  let port;
  for (let attempt = 0; attempt < 150 && !port; attempt++) {
    if (browserError) throw browserError;
    assert.equal(browser.exitCode, null, 'Browser must stay open until the logo is rendered.');
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
    if (!port) await wait(100);
  }
  assert.ok(port, 'Browser debugging port is available.');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data), job = pending.get(message.id);
    if (!job) return;
    clearTimeout(job.timer); pending.delete(message.id);
    message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result);
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 4, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const { frameTree } = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  const rendered = await send('Runtime.evaluate', { expression: `(async()=>{
    await document.fonts.ready;
    const title=document.querySelector('h1'), script=title.querySelector('em');
    const box=document.querySelector('#home').getBoundingClientRect();
    return { fonts:[document.fonts.check('76px "R2A Title Capitals"','ROADAGI'),document.fonts.check('52px "R2A Title Script"','to')],
      text:[...title.children].map(x=>x.textContent).join(' '), color:getComputedStyle(title).color,
      scriptColor:getComputedStyle(script).color, width:Math.ceil(box.width),height:Math.ceil(box.height) };
  })()`, awaitPromise: true, returnByValue: true });
  assert.ok(!rendered.exceptionDetails, 'Logo DOM renders without errors.');
  const info = rendered.result.value;
  assert.deepEqual(info.fonts, [true, true], 'Both original game fonts must be loaded.');
  assert.equal(info.text, 'ROAD to AGI');
  assert.equal(info.color, 'rgb(242, 220, 158)');
  assert.equal(info.scriptColor, 'rgb(255, 255, 255)');
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: info.width, height: info.height, scale: 1 } });
  const logo = await sharp(Buffer.from(data, 'base64')).trim({ threshold: 5 }).png().toBuffer();
  const logoPath = join(output, 'ui/game-logo.png');
  await mkdir(dirname(logoPath), { recursive: true });
  await writeFile(logoPath, logo);

  const width = 1920, height = 1080;
  const logoLayer = await sharp(logo).resize({ width: 1000 }).png().toBuffer();
  const logoSize = await sharp(logoLayer).metadata();
  const left = Math.round((width - logoSize.width) / 2), top = height - logoSize.height - 26;
  assert.ok(left >= 240 && left + logoSize.width <= 1680, 'Logo fits the central 4:3 safe area.');
  // A feathered navy oval separates the authentic title from bright fabric and hair.
  const vignette = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="logo-shade">
      <stop offset="0" stop-color="#050e22" stop-opacity=".92"/>
      <stop offset=".48" stop-color="#050e22" stop-opacity=".86"/>
      <stop offset=".76" stop-color="#050e22" stop-opacity=".48"/>
      <stop offset="1" stop-color="#050e22" stop-opacity="0"/>
    </radialGradient></defs>
    <ellipse cx="${width / 2}" cy="${top + logoSize.height * .62}" rx="750" ry="230" fill="url(#logo-shade)"/>
  </svg>`);
  const posterPath = join(output, 'Road_to_AGI_横版海报.png');
  await sharp(artwork).resize(width, height, { fit: 'cover', position: 'centre' })
    .composite([{ input: vignette, left: 0, top: 0 }, { input: logoLayer, left, top }]).png().toFile(posterPath);
  const cropPath = join(output, 'Road_to_AGI_海报_4比3.png');
  await sharp(posterPath).extract({ left: 240, top: 0, width: 1440, height: 1080 }).png().toFile(cropPath);
  const record = { artwork, logoSource: 'game/src/components/HomeScreen.vue', fontsLoaded: info.fonts,
    logoText: info.text, logoBox: { left, top, width: logoSize.width, height: logoSize.height },
    landscape: { width, height }, crop: { left: 240, top: 0, width: 1440, height: 1080 } };
  await writeFile(join(qa, 'export-check.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ ...record, files: [posterPath, cropPath, logoPath] }, null, 2));
} finally {
  for (const job of pending.values()) clearTimeout(job.timer);
  ws?.close();
  browser?.kill();
}
