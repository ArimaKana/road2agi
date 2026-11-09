// Record supplemental summon footage in an isolated, local browser.
// Usage: node tools/promo-capture.mjs [qwen seed gpt]
// Requires game/node_modules, Chrome (or CHROME_PATH), and ffmpeg.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from '../game/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'art-source/promo/clips');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen', 'seed', 'gpt'];
assert.ok(ids.every(id => ['qwen', 'seed', 'gpt'].includes(id)), 'Supported shots: qwen seed gpt');
const fps = 30, temporaryRoot = await realpath(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'r2a-promo-'));
await mkdir(output, { recursive: true });
let server, browser, ws, encoder, next = 0, browserLog = '';
const pending = new Map(), listeners = new Map(), problems = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(source) {
  const result = await send('Runtime.evaluate', { expression: `(async () => { ${source}\n})()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(predicate, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(100); }
  throw new Error(`Timed out: ${label}. ${browserLog.slice(-1000)}`);
}
const key = (type, code) => send('Input.dispatchKeyEvent', { type, code,
  key: code === 'KeyJ' ? 'j' : code.slice(-1), windowsVirtualKeyCode: code === 'KeyJ' ? 74 : code.charCodeAt(code.length - 1) });
async function tap(code) { await key('keyDown', code); await wait(45); await key('keyUp', code); }

async function record(id, action) {
  const file = join(output, `skill-${id}.mp4`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-an', file];
  encoder = spawn('ffmpeg', args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const done = once(encoder, 'close');
  let encoderError = '', pipeError, first = 0, nextAt = 0, last, captured = 0, frames = 0;
  encoder.stderr.on('data', chunk => { encoderError += chunk; });
  encoder.stdin.on('error', error => { pipeError = error; });
  const emit = buffer => { encoder.stdin.write(buffer); frames++; };
  const onFrame = params => {
    void send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    const timestamp = params.metadata.timestamp;
    if (!first) { first = timestamp; nextAt = timestamp; }
    while (last && nextAt < timestamp) { emit(last); nextAt += 1 / fps; }
    last = Buffer.from(params.data, 'base64'); captured++;
  };
  listeners.set('Page.screencastFrame', onFrame);
  await send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await until(() => !!first, 'first captured frame', 15000);
  const marks = await action(() => +(Date.now() / 1000 - first).toFixed(3));
  const end = Date.now() / 1000;
  await send('Page.stopScreencast'); listeners.delete('Page.screencastFrame');
  while (last && nextAt < end) { emit(last); nextAt += 1 / fps; }
  encoder.stdin.end();
  const [code] = await done; encoder = null;
  assert.equal(code, 0, encoderError); assert.ok(!pipeError, pipeError?.message);
  const report = { id, frames, captured, captureFps: +(captured / (end - first)).toFixed(1), marks };
  await writeFile(join(output, `skill-${id}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ id, frames, captureFps: report.captureFps, cast: marks.cast, events: marks.events.length }));
}

try {
  server = await createServer({ root: join(root, 'game'), server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' });
  await server.listen();
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { browserLog = (browserLog + chunk).slice(-3000); });
  let launchError, port;
  browser.on('error', error => { launchError = error; });
  await until(async () => {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error(browserLog);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return !!port; } catch { return false; }
  }, 'browser launch', 20000);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data), job = pending.get(message.id);
    if (job) { clearTimeout(job.timer); pending.delete(message.id); message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    listeners.get(message.method)?.(message.params);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${server.resolvedUrls.local[0]}?debug&unlock=all&nostory` });
  await until(() => evaluate(`return !!window.engine && [...document.querySelectorAll('.home-button')].some(b => !b.disabled);`).catch(() => false), 'game ready');
  // Load the same in-game figures and effects before recording, to avoid first-use stalls.
  await evaluate(`await window.engine.flips.loadAll(window.engine.track);`);
  for (const id of ids) {
    console.log(`Recording ${id}`);
    await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.loadout = ['${id}', 'kimi', 'minimax']; window.engine.jumpTo('1-7');`);
    await until(() => evaluate(`return window.game.state === 'playing' && !document.querySelector('#loading');`), 'room ready');
    await evaluate(`
      const e = window.engine, c = e.camera, g = window.game;
      if (!e.__promoCamera) e.__promoCamera = { left: c.left, right: c.right, top: c.top, bottom: c.bottom };
      for (const [key, value] of Object.entries(e.__promoCamera)) c[key] = value / 1.45;
      c.updateProjectionMatrix(); g.god = true;
      await e.view.load(['${id}', 'kimi', 'minimax']);
    `);
    await wait(1800);
    await evaluate(`
      const h = window.game.hero;
      if ('${id}' === 'seed') h.hp = 55;
      if ('${id}' === 'gpt') { h.cards[1].cooldown = 9; h.cards[2].cooldown = 8; h.dashCharges = 0; h.dashCooldown = 5; }
      window.__promoEvents = [];
      window.engine.__promoFeedback ??= window.engine.feedback.bind(window.engine);
      window.engine.feedback = event => { window.__promoEvents.push(event); window.engine.__promoFeedback(event); };
    `);
    await record(id, async elapsed => {
      await wait(700);
      const cast = elapsed(); await tap('Digit1');
      await until(() => evaluate('return window.game.hero.cards[0].cooldown > 0;'), `${id} confirmed`, 5000);
      if (id === 'qwen') {
        await wait(600); await key('keyDown', 'KeyJ'); await wait(1100); await key('keyUp', 'KeyJ'); await wait(1900);
      } else if (id === 'gpt') {
        const refreshed = await evaluate('return window.game.hero.cards.slice(1).every(c => c.cooldown === 0) && window.game.hero.dashCharges === 2;');
        assert.ok(refreshed, 'GPT visibly resets both other cards and dash charges'); await wait(3500);
      } else {
        assert.ok(await evaluate('return window.game.hero.hp >= 70 && !!window.game.decoy;'), 'Seed heals and creates the decoy'); await wait(3500);
      }
      return { cast, events: await evaluate('return window.__promoEvents;') };
    });
  }
  assert.deepEqual(problems, [], 'Browser exceptions');
} finally {
  encoder?.kill();
  for (const job of pending.values()) clearTimeout(job.timer);
  ws?.close(); browser?.kill(); await server?.close(); await wait(800);
  const child = relative(temporaryRoot, resolve(profile));
  if (child && !child.startsWith('..') && !isAbsolute(child)) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
