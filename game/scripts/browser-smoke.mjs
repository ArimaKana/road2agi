// Uses a disposable browser profile and a loopback Vite server. No user tabs or saves are touched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from 'vite';
import { runToyBrowserChecks } from './toy-browser-checks.mjs';
import { runControlFeelChecks } from './control-feel-checks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Install Chrome/Chromium/Edge or set CHROME_PATH to its executable.');

const temporaryRoot = await realpath(tmpdir()), profile = await mkdtemp(join(temporaryRoot, 'road-to-agi-browser-'));
let server, browser, ws, stderr = '', next = 0, passed = 0;
const pending = new Map(), errors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(source) {
  const result = await send('Runtime.evaluate', { expression: `(async () => { ${source}\n})()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(predicate, message) {
  for (let attempts = 0; attempts < 400; attempts++) { if (await predicate()) return; await wait(100); }
  throw new Error(`Timed out: ${message}`);
}
function check(name, value) { assert.ok(value, name); console.log(`PASS ${name}`); passed++; }
async function click(selector) {
  const point = await evaluate(`const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function capture(name) {
  if (process.env.R2A_VISUAL_QA !== '1') return;
  const directory = join(root, '..', 'qa', 'feedback'); await mkdir(directory, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false }, logLevel: 'error' });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-background-networking', '--enable-unsafe-swiftshader', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  let launchError;
  browser.on('error', error => { launchError = error; });
  let port;
  await until(async () => {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error(`Browser exited: ${stderr}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return !!port; } catch { return false; }
  }, 'browser debugging port');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data), job = pending.get(message.id);
    if (job) { clearTimeout(job.timer); pending.delete(message.id); message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.description ?? arg.value).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });

  for (const mode of ['blocked', 'malformed']) {
    errors.length = 0;
    const source = mode === 'blocked'
      ? "for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Test storage denial', 'SecurityError'); } });"
      : "sessionStorage.setItem('road-to-agi.recover', '{broken');";
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
    await send('Page.navigate', { url: `${base}?debug&nostory${mode === 'malformed' ? '&webgl' : ''}` });
    await until(async () => {
      const state = await evaluate("return { ready: !!window.engine, fatal: document.querySelector('#fatal')?.textContent }; ");
      if (state.fatal) throw new Error(state.fatal);
      return state.ready;
    }, `${mode} storage startup`);
    const backend = await evaluate("return document.querySelector('canvas').dataset.backend;");
    check(`${backend}: landscape starts without fullscreen`, await evaluate('return !document.fullscreenElement && !document.querySelector("#rotate-hint") && !document.querySelector("#game-content").inert;'));
    check(`${mode} storage: home starts (${backend})`, await evaluate("return !!document.querySelector('.home-button:not(:disabled)');"));
    if (mode === 'malformed') check('malformed recovery is discarded', await evaluate("return sessionStorage.getItem('road-to-agi.recover') === null;"));

    await evaluate('window.engine.newRun();');
    await until(() => evaluate('return !!document.querySelector("#card-picker");'), 'starting card picker opens');
    check(`${backend}: Claude requires a first rescue`, await evaluate(`const card = document.querySelector('[aria-label="Claude 封禁裁决"]'); return card.disabled && card.textContent.includes('3-9 解救后永久解锁');`));
    if (mode === 'malformed') {
      await evaluate(`const { saveUnlocked } = await import('/src/game/progress.ts'); saveUnlocked(['glm', 'kimi', 'claude']); window.__beforeAlbumReload = true;`);
      await send('Page.reload');
      await until(() => evaluate('return !window.__beforeAlbumReload && !!window.engine;'), 'saved Claude album reloads');
      check('landscape reload requires no fullscreen gesture', await evaluate('return !document.fullscreenElement && !document.querySelector("#rotate-hint");'));
      await evaluate('window.engine.newRun();');
    } else {
      await evaluate("window.game.unlocked.add('claude'); window.engine.syncUnlocked();");
    }
    await until(() => evaluate(`return document.querySelector('[aria-label="Claude 封禁裁决"]')?.disabled === false;`), 'Claude unlock reaches picker');
    check(`${backend}: unlocked Claude has no mid-run restriction`, await evaluate(`const { hud } = await import('/src/game/hud.ts'); const card = document.querySelector('[aria-label="Claude 封禁裁决"]'); return !hud.unlockAll && !card.querySelector('.picker-lock') && !card.querySelector('.picker-silhouette');`));
    await evaluate(`document.querySelector('[aria-label="Claude 封禁裁决"]').click();`);
    await until(() => evaluate(`return document.querySelector('[aria-label="Claude 封禁裁决"]').getAttribute('aria-pressed') === 'true';`), 'Claude joins starting picks');
    await capture(`${backend}-claude-start-picker`);
    await evaluate('document.querySelector("#start").click();');
    await until(() => evaluate(`return window.game.state === 'playing' && window.game.plan.id === '1-1' && window.game.hero.cards.some(c => c.id === 'claude');`), 'new run starts with Claude');
    check(`${backend}: Claude starts at level I with her original cost`, await evaluate(`const c = window.game.hero.cards.find(c => c.id === 'claude'); return c.level === 1 && window.game.cardCost(c) === 75 && !window.game.hero.rescued;`));

    await evaluate("await window.engine.jumpTo('1-3'); window.game.god = true;");
    await until(() => evaluate("return window.game.state === 'playing';"), 'combat starts');
    await evaluate("const { hero } = window.game; hero.cards = [{ id: 'qwen', cooldown: 0, level: 1, branch: null, boost: 0 }]; hero.token = 100; window.engine.syncCards(); window.engine.view.load(['qwen']); window.engine.input.binds.keys.card1 = 'Digit4';");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Digit4', key: '4', windowsVirtualKeyCode: 52 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Digit4', key: '4', windowsVirtualKeyCode: 52 });
    await until(() => evaluate('return window.game.hero.zeroCharges > 0;'), 'rebound card is cast');
    check(`${backend}: Digit4 casts the rebound first card`, await evaluate('return window.game.hero.cards[0].cooldown > 0;'));
    for (const uses of [1, 2]) {
      if (uses === 2) {
        await evaluate("const c = window.game.hero.cards[0]; c.level = 2; c.branch = 'A'; c.cooldown = 0;");
        await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Digit4', key: '4', windowsVirtualKeyCode: 52 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Digit4', key: '4', windowsVirtualKeyCode: 52 });
        await until(() => evaluate('return window.game.hero.zeroCharges === 2;'), 'upgraded Qwen grants two uses');
      }
      await until(() => evaluate(`return document.querySelector('#token').nextElementSibling.textContent.includes('剩 ${uses} 次');`), 'Qwen use count reaches HUD');
      check(`${backend}: Qwen shows ${uses} remaining uses instead of seconds`, await evaluate(`return window.game.hero.zeroCharges === ${uses} && !document.querySelector('#token').nextElementSibling.textContent.includes('秒');`));
      await capture(`${backend}-qwen-${uses}-uses`);
      await until(() => evaluate('return !window.game.hero.summon;'), 'Qwen summon finishes');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
      if (uses === 2) {
        await until(() => evaluate('return window.game.hero.zeroCharges === 1;'), 'first charged thrust consumes one use');
        await until(() => evaluate("return document.querySelector('#token').nextElementSibling.textContent.includes('剩 1 次');"), 'HUD decrements to one use');
      }
      await until(() => evaluate('return window.game.hero.zeroCharges === 0;'), 'charged thrusts consume all uses');
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
      await until(() => evaluate('return !window.game.hero.attack && window.game.hero.charge === null;'), 'charged thrust finishes');
      check(`${backend}: spending ${uses} Qwen uses restores the Token display`, await evaluate("return !document.querySelector('#token').classList.contains('free') && !document.querySelector('#token').nextElementSibling.textContent.includes('零消耗');"));
    }
    await runControlFeelChecks({ send, evaluate, until, check, capture, backend });

    check(`${backend}: reward effects have finite positions`, await evaluate(`
      const { SUPPLIES } = await import('/src/game/rewards.ts');
      window.game.reward = { options: [SUPPLIES[0]] }; window.game.state = 'reward'; window.engine.pickReward(0);
      window.engine.scene.updateMatrixWorld(true);
      let finite = true; window.engine.scene.traverse(object => { finite &&= object.matrixWorld.elements.every(Number.isFinite); }); return finite;
    `));
    await evaluate(`
      window.game.pause();
      window.game.rings = [{ id: -1, owner: 0, x: window.game.hero.x, z: window.game.hero.z, reach: 4, max: 20, speed: 0, width: 1.5, gapAt: .4, gapHalf: .6, damage: 0, camp: 'enemy', hit: new Set() }];
    `);
    await until(() => evaluate('return window.engine.hazards.rings.has(-1);'), 'ring reaches renderer');
    await evaluate('window.__ringGeometry = window.engine.hazards.rings.get(-1).geometry; window.__ringVersion = window.__ringGeometry.getAttribute("position").version;');
    await wait(250);
    check(`${backend}: paused ring buffers stay unchanged`, await evaluate('return window.engine.hazards.rings.get(-1).geometry === window.__ringGeometry && window.__ringGeometry.getAttribute("position").version === window.__ringVersion;'));
    await evaluate('window.game.rings[0].reach = 9;');
    await until(() => evaluate('return window.__ringGeometry.boundingSphere.radius === 9.75;'), 'grown ring reaches renderer');
    check(`${backend}: growing ring keeps its geometry`, await evaluate('return window.engine.hazards.rings.get(-1).geometry === window.__ringGeometry;'));

    // Reproduce clicking the bottom card row after the mouse left the battlefield.
    for (const id of ['minimax', 'grok']) {
      await evaluate(`
        const g = window.game, h = g.hero; g.rings = []; g.traps = []; g.room.walls.fill(0);
        g.state = 'playing'; g.hitstop = 0; g.slowmo = 0; g.cleared = false; g.leaving = 0;
        Object.assign(h, { x: 0, z: 0, attack: null, summon: null, charge: null, dash: 0, ult: false, token: 100, cardGap: 0, cardBufferTime: 0 });
        h.cards = [{ id: '${id}', cooldown: 0, level: 1, branch: null, boost: 0 }];
        window.engine.syncCards(); window.engine.view.load(['${id}']);
        g.enemies = [g.newEnemy({ x: -3, z: -3, arrive: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100 })];
        window.__cardEvent = null;
        window.__feedback ??= window.engine.feedback.bind(window.engine);
        window.engine.feedback = e => { if (e.type === 'trainStart' || e.type === 'grokWave') window.__cardEvent = e; window.__feedback(e); };
        window.engine.input.clear(); window.engine.input.mouse = { x: 500, y: 650, active: true };
      `);
      await until(() => evaluate(`return document.querySelector('[data-slot="0"]')?.getAttribute('aria-label').includes('${id === 'minimax' ? 'MiniMax' : 'Grok'}');`), `${id} card reaches HUD`);
      const point = await evaluate(`const r = document.querySelector('[data-slot="0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      await until(() => evaluate('return !!window.__cardEvent;'), `${id} click casts`);
      check(`${backend}: clicking ${id} aims up toward the enemy, away from the HUD`, await evaluate('const e = window.__cardEvent, d = e.dir ?? e.aim; return d.x < -.6 && d.z < -.6;'));
    }

    await evaluate("window.engine.jumpTo('2-6');");
    await until(() => evaluate("return window.game.plan.id === '2-6' && window.game.state === 'playing';"), 'library room ready');
    await evaluate(`const g = window.game, m = g.traps.find(t => t.kind === 'mirror'); g.pause(); g.hero.x = m.x; g.hero.z = m.z + 3; window.engine.input.clear();`);
    await wait(350);
    check(`${backend}: library mirrors render with finite transforms`, await evaluate(`let finite = true; window.engine.scene.traverse(o => { finite &&= o.matrixWorld.elements.every(Number.isFinite); }); return finite;`));
    check(`${backend}: wave HUD omits the remaining enemy count`, await evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.objective.includes('波') && !hud.objective.includes('剩余');`));
    await capture(`${backend}-mirror`);
    for (const who of ['gpt', 'deepseek']) {
      await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.dialog = { lines: [{ who: '${who}', name: '${who}', text: '校对官背后是旧议会。这些清洗，都有他们的签名。' }] }; hud.dialogAt = 0;`);
      await until(() => evaluate(`const p = document.querySelector('.dialog-portrait'); return p?.complete && p.naturalWidth > 0;`), `${who} portrait decoded`);
      check(`${backend}: ${who} dialogue figure sits on the right`, await evaluate(`const p = document.querySelector('.dialog-portrait'), r = p.getBoundingClientRect(); return p.src.includes('figure') && r.x + r.width / 2 > innerWidth / 2 && r.right <= innerWidth && r.top >= 0;`));
      await capture(`${backend}-dialog-${who}`);
    }
    await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.dialog = null;`);

    if (process.env.R2A_VISUAL_QA === '1') {
      await evaluate(`
        const { claudeStats } = await import('/src/game/cards.ts'); const g = window.game, h = g.hero;
        g.enemies = [g.newEnemy({ x: h.x - 2, z: h.z - 2, arrive: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100 })];
        const e = g.enemies[0]; g.seals = [{ x: e.x, z: e.z, target: e.id, age: .75, stats: claudeStats({ id: 'claude', level: 1, branch: null }), power: 1 }];
        window.engine.view.update(); window.engine.view.load(['claude']);
      `);
      await wait(100); await capture(`${backend}-claude-mark`);
      await evaluate(`
        const e = window.game.enemies[0]; window.game.seals = [];
        window.engine.feedback({ type: 'claudeStrike', x: e.x, z: e.z, unbound: true, splash: 3.75 });
        window.engine.feedback({ type: 'summonConfirm', id: 'claude', slot: 0, x: window.game.hero.x, z: window.game.hero.z, aim: { x: -1, z: 0 } });
        window.engine.view.update(); window.engine.updateEffects(.12); window.engine.flips.update(.12); window.engine.fx.update(.12);
      `);
      await wait(200); await capture(`${backend}-claude-strike`);
      await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.cutIns = [];`);
      for (const [width, height] of [[844, 390], [390, 844]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.dialog = { lines: [{ who: 'deepseek', name: 'DeepSeek', text: '半身立绘与对话框在窄屏上保持完整。' }] }; hud.dialogAt = 0;`);
        await wait(200); await capture(`${backend}-dialog-${width}x${height}`);
      }
      await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
      await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.dialog = null;`);
    }
    // Exercise the first rescue and the next run through the real scene/unlock event flow.
    await evaluate(`window.engine.debug.delete('nostory'); window.game.unlocked.delete('claude'); window.engine.jumpTo('3-9');`);
    await until(() => evaluate(`const { hud } = await import('/src/game/hud.ts'); return window.game.plan.id === '3-9' && hud.dialog?.lines.some(l => l.text.includes('活体算力核心'));`), 'first rescue intro');
    await evaluate('window.engine.closeDialog(); window.game.enemies = []; window.game.wave = window.game.plan.waves.length;');
    await until(() => evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.dialog?.lines.some(l => l.text === '欢迎回来。');`), 'first rescue ending');
    check(`${backend}: first rescue keeps its original story and permanently unlocks Claude`, await evaluate(`const { hud } = await import('/src/game/hud.ts'); return window.game.unlocked.has('claude') && hud.unlocked.includes('claude');`));
    await evaluate(`const { hud } = await import('/src/game/hud.ts'); window.engine.closeDialog(); hud.cardFlight = ''; window.engine.jumpTo('3-9');`);
    await until(() => evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.dialog?.lines.some(l => l.text.includes('归档算力记录'));`), 'returning Claude intro');
    await evaluate('window.engine.closeDialog(); window.game.enemies = []; window.game.wave = window.game.plan.waves.length;');
    await until(() => evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.dialog?.lines.some(l => l.text.includes('残留的约束记录已清除'));`), 'returning Claude ending');
    check(`${backend}: repeat statue victory clears old records without recruiting Claude again`, await evaluate(`const { hud } = await import('/src/game/hud.ts'); return !hud.cardFlight && window.game.hero.cards.some(c => c.id === 'claude');`));
    await evaluate(`window.engine.closeDialog(); window.engine.feedback({ type: 'story', id: '3-4' });`);
    check(`${backend}: returning Claude's archive event keeps the statue bonus choice`, await evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.dialog.lines.some(l => l.text.includes('历史封存记录')) && hud.dialog.choices[0].effect === 'icon';`));
    await evaluate(`const { hud } = await import('/src/game/hud.ts'); hud.dialog = null;`);

    if (mode === 'blocked') {
      await evaluate('window.__originalEngine = window.engine; window.engine.renderer.onDeviceLost();');
      await wait(800);
      check('unavailable storage stops device-loss reloads', await evaluate("return window.engine === window.__originalEngine && document.querySelector('#fatal')?.textContent.includes('无法保存恢复信息');"));
    }
    assert.deepEqual(errors, [], `${backend} browser errors`); console.log(`PASS ${backend}: no browser exceptions`); passed++;
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  errors.length = 0;
  await runToyBrowserChecks({ send, evaluate, until, check, capture, click, base });
  assert.deepEqual(errors, [], 'Toy integration browser errors');
  console.log(`${passed} browser checks passed.`);
} finally {
  if (ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
  ws?.close();
  for (const job of pending.values()) clearTimeout(job.timer);
  if (browser && browser.exitCode === null) { await wait(300); if (browser.exitCode === null) browser.kill(); }
  await server?.close();
  const actual = await realpath(profile);
  if (dirname(actual) !== temporaryRoot || !basename(actual).startsWith('road-to-agi-browser-')) throw new Error('Unexpected browser profile path; refusing cleanup.');
  await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
