// Record every gameplay shot in an isolated, local browser.
// Usage: node tools/promo-capture.mjs [shot ...] [--out directory]
// Requires game/node_modules, Chrome (or CHROME_PATH), and ffmpeg.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from '../game/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cards = ['kimi', 'minimax', 'gemini', 'grok', 'glm', 'qwen', 'seed', 'gpt', 'claude'];
const shots = [
  { id: 'opening-strike', room: '1-2', seconds: 5, mode: 'strike', zoom: 1.4 },
  { id: 'opening-dash', room: '1-6', seconds: 4, mode: 'dash', zoom: 1.3 },
  { id: 'opening-charge', room: '1-7', seconds: 5, mode: 'charge', zoom: 1.4 },
  { id: 'partners', room: '1-9', seconds: 4, mode: 'partners', zoom: 1 },
  ...cards.map(card => ({ id: `skill-${card}`, room: '1-7', seconds: 5, mode: 'skill', card, zoom: 1.45 })),
  { id: 'story-system', room: '1-1', seconds: 4.5, mode: 'story', line: 0, zoom: 1 },
  { id: 'story-deepseek', room: '1-1', seconds: 4.5, mode: 'story', line: 3, zoom: 1 },
  ...['1-6', '2-2', '3-1', '4-1'].map((room, i) => ({ id: `region-${i + 1}`, room, seconds: 5, mode: 'fight', zoom: 1.1 })),
  { id: 'trial', seconds: 6, mode: 'trial', zoom: 1.25 },
  ...['1-9', '2-9', '3-9', '4-1'].map((room, i) => ({ id: `boss-${i + 1}`, room, seconds: 9, mode: 'boss', zoom: i > 1 ? 1 : 1.15 })),
  { id: 'ultimate', room: '2-3', seconds: 6, mode: 'ultimate', zoom: 1.1 },
];
const args = process.argv.slice(2), outputAt = args.indexOf('--out');
let output = join(root, 'art-source/promo/current/clips');
if (outputAt >= 0) {
  assert.ok(args[outputAt + 1], '--out requires a directory');
  output = resolve(args[outputAt + 1]); args.splice(outputAt, 2);
}
const ids = args.map(id => cards.includes(id) ? `skill-${id}` : id);
assert.ok(ids.every(id => shots.some(s => s.id === id)), `Supported shots: ${shots.map(s => s.id).join(' ')}`);
const selected = ids.length ? shots.filter(s => ids.includes(s.id)) : shots;
const gameRevision = execFileSync('git', ['log', '-1', '--format=%H', '--', 'game'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'game'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Commit game changes before recording');
const heroSha256 = createHash('sha256').update(await readFile(join(root, 'game/public/assets/hero.json'))).digest('hex');
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
  key: code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(-1).toLowerCase() : code.slice(-1),
  windowsVirtualKeyCode: code === 'Space' ? 32 : code.charCodeAt(code.length - 1) });
async function tap(code) { await key('keyDown', code); await wait(45); await key('keyUp', code); }
const held = new Set();
async function hold(code, on) {
  if (on === held.has(code)) return;
  if (on) held.add(code); else held.delete(code);
  await key(on ? 'keyDown' : 'keyUp', code);
}
async function release() { for (const code of [...held]) await hold(code, false); }

// Read the real room and steer through its walkable tiles with keyboard/mouse input.
async function steer(attack = false, preferBoss = false) {
  const state = await evaluate(`
    const g = window.game, h = g.hero, e = window.engine, r = window.__promoRoom;
    const foes = g.enemies.filter(o => o.hp > 0 && o.allied <= 0 && o.arrive <= 0);
    foes.sort((a, b) => (${preferBoss} ? Number(b.boss) - Number(a.boss) : 0)
      || Math.hypot(a.x-h.x, a.z-h.z) - Math.hypot(b.x-h.x, b.z-h.z));
    const target = foes[0];
    if (g.state !== 'playing' || !target) return { playing: false };
    const distance = Math.hypot(target.x-h.x, target.z-h.z) - target.radius;
    let dx = target.x-h.x, dz = target.z-h.z;
    if (distance > 3 && !r.lineClear(g.room, h, target)) {
      const field = r.distanceField(g.room, target), tile = r.tileOf(g.room, h.x, h.z);
      const neighbors = [[1,0],[-1,0],[0,1],[0,-1]].map(([x,z]) => ({c:tile.c+x,r:tile.r+z}))
        .filter(p => !r.wallAtTile(g.room,p.c,p.r) && field[p.r*g.room.cols+p.c] >= 0)
        .sort((a,b) => field[a.r*g.room.cols+a.c] - field[b.r*g.room.cols+b.c]);
      if (neighbors[0]) { const p = r.tileCenter(g.room,neighbors[0].c,neighbors[0].r); dx=p.x-h.x; dz=p.z-h.z; }
    }
    const length = Math.hypot(dx,dz) || 1, move = distance > 3 ? 1 : 0;
    const p = e.aimPoint.clone().set(target.x,.6,target.z).project(e.camera);
    return { playing: true, distance, sx:(dx-dz)/length*move, sy:(dx+dz)/length*move,
      point:{x:(p.x*.5+.5)*innerWidth,y:(-p.y*.5+.5)*innerHeight}, boss:target.boss };
  `);
  if (!state.playing) { await release(); return state; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...state.point });
  for (const [code, on] of [['KeyW', state.sy < -.25], ['KeyS', state.sy > .25], ['KeyA', state.sx < -.25], ['KeyD', state.sx > .25]]) await hold(code, on);
  if (attack && state.distance < 4) await tap('KeyJ');
  return state;
}

async function approach(distance = 3.2, boss = false) {
  await until(async () => { const s = await steer(false, boss); return s.playing && s.distance <= distance; }, 'approach target', 20000);
  await release(); await wait(350);
}

async function prepare(shot) {
  await release();
  const loadout = shot.card ? [shot.card, ...cards.filter(id => id !== shot.card).slice(0, 2)] : ['glm', 'kimi', 'qwen'];
  await evaluate(`
    const { hud } = await import('/src/game/hud.ts');
    window.__promoRoom = await import('/src/game/room.ts');
    hud.loadout = ${JSON.stringify(loadout)}; hud.inTrial = ${shot.mode === 'trial'};
    window.engine.debug.set('nostory', ''); window.game.god = true;
    ${shot.mode === 'trial' ? 'await window.engine.runTrial();' : `await window.engine.run('${shot.room}');`}
    await window.engine.view.load(${JSON.stringify(loadout)});
  `);
  await until(() => evaluate(`return window.game.state === 'playing' && !document.querySelector('#loading');`), 'room ready');
  await evaluate(`
    const e = window.engine, c = e.camera;
    e.__promoCamera ??= { left:c.left, right:c.right, top:c.top, bottom:c.bottom };
    for (const [key,value] of Object.entries(e.__promoCamera)) c[key] = value / ${shot.zoom};
    c.updateProjectionMatrix();
  `);
  await wait(1000);
  if (shot.mode === 'partners') {
    // Use the actual three-slot preparation panel and its unlocked card album.
    await evaluate(`const e=window.engine,g=window.game; g.state='prep'; e.feedback({type:'prep',next:'镜像书库'});`);
    await until(() => evaluate(`return document.querySelectorAll('#prep .picker-card').length === 9;`), 'nine partner cards');
    await wait(700);
  } else if (shot.mode === 'story') {
    await evaluate(`window.engine.debug.delete('nostory'); window.engine.tellStory('enter-1-1');
      const { hud } = await import('/src/game/hud.ts'); hud.dialogAt = ${shot.line};`);
    await wait(600);
  } else {
    if (shot.mode === 'boss') {
      // Skip only the preceding waves; the boss itself retains its normal rules and health.
      await until(async () => {
        await evaluate(`const g=window.game; if (!g.enemies.some(e=>e.boss && e.hp>0))
          for (const e of g.enemies) if (e.hp>0 && e.arrive<=0) g.damage(e,99999,0,0,0);`);
        return evaluate('return window.game.enemies.some(e=>e.boss && e.hp>0 && e.arrive<=0);');
      }, 'boss entrance', 45000);
    }
    await approach(shot.mode === 'boss' ? 4.2 : 3.1, shot.mode === 'boss');
    if (shot.card === 'seed') await evaluate('window.game.hero.hp=55;');
    if (shot.card === 'gpt') await evaluate('const h=window.game.hero; h.cards[1].cooldown=9; h.cards[2].cooldown=8; h.dashCharges=0; h.dashCooldown=5;');
  }
  await evaluate(`window.__promoEvents=[];
    window.engine.__promoFeedback ??= window.engine.feedback.bind(window.engine);
    window.engine.feedback=event=>{window.__promoEvents.push({...event,time:performance.now()/1000});window.engine.__promoFeedback(event);};`);
}

async function perform(shot, elapsed) {
  const marks = { in: .4 };
  await wait(700);
  marks.action = elapsed();
  if (shot.mode === 'skill') {
    await tap('Digit1');
    await until(() => evaluate(`return window.__promoEvents.some(e=>e.type==='summonConfirm' && e.id==='${shot.card}');`), `${shot.card} confirmed`, 5000);
    if (shot.card === 'qwen') { await wait(450); await hold('KeyJ', true); await wait(1100); await hold('KeyJ', false); }
    if (shot.card === 'gpt') assert.ok(await evaluate('return window.game.hero.cards.slice(1).every(c=>c.cooldown===0) && window.game.hero.dashCharges===2;'), 'GPT refreshes cards and dash');
    if (shot.card === 'seed') assert.ok(await evaluate('return window.game.hero.hp>=70 && !!window.game.decoy;'), 'Seed heals and creates decoy');
  } else if (shot.mode === 'ultimate') {
    await tap('KeyF');
  } else if (shot.mode === 'dash') {
    await hold('KeyD', true); await tap('Space'); await wait(250); await hold('KeyD', false); await tap('KeyJ');
  } else if (shot.mode === 'charge') {
    await hold('KeyJ', true); await wait(1250); await hold('KeyJ', false);
  }
  while (elapsed() < shot.seconds) {
    if (['strike', 'fight', 'boss', 'trial', 'dash'].includes(shot.mode)) await steer(true, shot.mode === 'boss');
    await wait(110);
  }
  await release();
  marks.events = await evaluate('return window.__promoEvents;');
  if (shot.mode === 'skill') {
    const effects = {kimi:'kimiBolt',minimax:'trainStart',gemini:'geminiDash',grok:'grokWave',glm:'glmThread',qwen:'qwenOff',seed:'seedHeal',gpt:'gptReset',claude:'claudeStrike'};
    assert.ok(marks.events.some(e=>e.type===effects[shot.card]), `${shot.card} gameplay effect`);
  }
  for (const [mode, event] of [['strike','attack'],['dash','dash'],['charge','chargeFull'],['ultimate','ultPunch']]) {
    if (shot.mode === mode) assert.ok(marks.events.some(e=>e.type===event), `${mode} happened`);
  }
  return marks;
}

async function record(shot) {
  const { id } = shot, file = join(output, `${id}.pending.mp4`);
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
  const performanceStart = await evaluate('return performance.now()/1000;');
  const wallStart = Date.now()/1000;
  const marks = await perform(shot, () => +(Date.now() / 1000 - first).toFixed(3));
  marks.events = marks.events.map(e => ({...e,time:+(e.time-performanceStart+wallStart-first).toFixed(3)}));
  // Put boss signature actions inside their short cuts and align the final punch to the music.
  const anchors = { 'boss-1':['bossRush',.35], 'boss-2':['bossMirrorSplit',.2],
    'boss-3':['iconCounter',.25], 'boss-4':['bossExpose',.35], 'ultimate':['ultPunch',4*.394370] };
  if (anchors[id]) {
    const [type, lead] = anchors[id], event = marks.events.find(e => e.type === type);
    if (event) marks.in = +Math.max(0,event.time-lead).toFixed(3);
  }
  const end = Date.now() / 1000;
  await send('Page.stopScreencast'); listeners.delete('Page.screencastFrame');
  while (last && nextAt < end) { emit(last); nextAt += 1 / fps; }
  encoder.stdin.end();
  const [code] = await done; encoder = null;
  assert.equal(code, 0, encoderError); assert.ok(!pipeError, pipeError?.message);
  assert.deepEqual(problems, [], 'Browser exceptions');
  const report = { id, recordedAt:new Date().toISOString(), gameRevision, heroSha256, shot,
    frames, captured, captureFps: +(captured / (end - first)).toFixed(1), marks };
  await rename(file, join(output, `${id}.mp4`));
  await writeFile(join(output, `${id}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ id, frames, captureFps: report.captureFps, action: marks.action, events: marks.events.length }));
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
  for (const shot of selected) {
    console.log(`Preparing ${shot.id}`);
    await prepare(shot);
    console.log(`Recording ${shot.id}`);
    await record(shot);
    assert.deepEqual(problems, [], 'Browser exceptions');
  }
  assert.deepEqual(problems, [], 'Browser exceptions');
} finally {
  encoder?.kill();
  for (const job of pending.values()) clearTimeout(job.timer);
  ws?.close(); browser?.kill(); await server?.close(); await wait(800);
  const child = relative(temporaryRoot, resolve(profile));
  if (child && !child.startsWith('..') && !isAbsolute(child)) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
