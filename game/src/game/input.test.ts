import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { Input } from './input';
import { Game } from './simulation';
import { GameLoop } from './gameLoop';
import { openMap } from './room';
import { PORT_THEME } from './level';

class ElementStub extends EventTarget {
  style = {};
  dataset: { slot?: string } = {};
  classList = { add() {} };
  querySelector() { return new ElementStub(); }
  closest() { return this.dataset.slot === undefined ? null : this; }
  setPointerCapture() {}
  focus() {}
}
function setup() {
  const row = new ElementStub(), card = new ElementStub(), attack = new ElementStub(), canvas = new ElementStub(); card.dataset.slot = '0';
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { body: new ElementStub(), querySelector: (selector: string) => selector === '#card-row' ? row : selector === '#attack-button' ? attack : new ElementStub(), elementFromPoint: () => null as ElementStub | null });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const pause = vi.fn(), god = vi.fn(), input = new Input(canvas as unknown as HTMLElement, pause, () => {}, () => {}, god);
  const press = (code: string) => win.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code, key: code, repeat: false }));
  const release = (code: string) => win.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  const attackPointer = (type: string, pointerType: 'mouse' | 'touch') => {
    const target = pointerType === 'touch' ? attack : type === 'pointerdown' ? canvas : win;
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, pointerType, button: 0, clientX: 100, clientY: 100 }));
  };
  const pointer = (type: string, x: number, y: number, pointerType = 'mouse') => {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, pointerType, clientX: x, clientY: y });
    Object.defineProperty(event, 'target', { value: card }); row.dispatchEvent(event);
  };
  return { input, press, release, attackPointer, canvas, win, pause, god, pointer, card, doc };
}
afterEach(() => vi.unstubAllGlobals());

test('keyboard, mouse and touch taps between renders each reach combat exactly once', () => {
  for (const source of ['keys', 'mouse', 'touch'] as const) for (const fps of [15, 30, 60, 144]) {
    const { input, press, release, attackPointer } = setup();
    const game = new Game({ name: '输入', theme: PORT_THEME, rooms: [{ id: 'T', name: '输入', kind: 'boss', map: openMap(), waves: [{ count: 1, hp: 1000 }] }] });
    game.start(); game.enemies = [game.newEnemy({ x: 40, z: 40, speed: 0, hp: 1000, maxHp: 1000 })];
    const loop = new GameLoop(game), attacks: string[] = [];
    if (source === 'keys') { press('KeyJ'); release('KeyJ'); }
    else { attackPointer('pointerdown', source); attackPointer('pointerup', source); }
    for (let frame = 0; frame < fps; frame++) loop.advance(1 / fps, input.sample(null), e => { if (e.type === 'attack' || e.type === 'chargeStart') attacks.push(e.type); });
    assert.deepEqual(attacks, ['attack'], `${source} at ${fps} FPS`);
    assert.equal(game.hero.attackHeld, false);
  }
});

test('a release and repress between renders is retained without duplicating held inputs', () => {
  const { input, press, release } = setup();
  press('KeyJ'); assert.deepEqual(input.sample(null).attackEdges, [true]);
  release('KeyJ'); press('KeyJ');
  assert.deepEqual(input.sample(null).attackEdges, [false, true]);
  assert.deepEqual(input.sample(null).attackEdges, []);
});

test('releasing one device does not release an attack held by another', () => {
  const { input, press, release, attackPointer } = setup();
  press('KeyJ'); attackPointer('pointerdown', 'mouse');
  assert.deepEqual(input.sample(null).attackEdges, [true]);
  release('KeyJ'); assert.equal(input.sample(null).attack, true);
  attackPointer('pointerup', 'mouse'); assert.deepEqual(input.sample(null).attackEdges, [false]);
});

test('clearing or losing focus discards unsampled attack edges', () => {
  for (const blur of [false, true]) {
    const { input, press, release, win } = setup(); press('KeyJ'); release('KeyJ');
    if (blur) win.dispatchEvent(new Event('blur')); else input.clear();
    const sample = input.sample(null); assert.equal(sample.attack, false); assert.deepEqual(sample.attackEdges, []);
  }
});

test('cards rebound to 4, 5 and 6 work in combat and panels retain numbered choices', () => {
  const { input, press } = setup();
  Object.assign(input.binds.keys, { card1: 'Digit4', card2: 'Digit5', card3: 'Digit6' });
  for (let n = 4; n <= 6; n++) { press(`Digit${n}`); assert.equal(input.sample(null).card, n - 4); }
  input.modal = true; input.choiceCount = 6;
  for (let n = 1; n <= 6; n++) { press(`Digit${n}`); assert.equal(input.sample(null).card, n - 1); }
  input.modal = false; input.choiceCount = 0;
  press('Digit4'); assert.equal(input.sample(null).card, 0);
});

test('capture rejects fixed keys without invoking them and Escape cancels capture', () => {
  const { input, press, pause, god } = setup(), done = vi.fn(); input.notify = vi.fn();
  input.startCapture('keys', done);
  for (const code of ['F8', 'Backquote', 'ArrowDown']) press(code);
  assert.equal(done.mock.calls.length, 0); assert.equal(god.mock.calls.length, 0); assert.equal(input.capture, 'keys');
  press('Digit4'); assert.deepEqual(done.mock.calls, [['Digit4']]);
  input.startCapture('keys', done); press('Escape');
  assert.deepEqual(done.mock.calls[1], [null]); assert.equal(pause.mock.calls.length, 0);
});

test('the gamepad pause button cannot be rebound to a combat action', () => {
  const { input, pause } = setup(), done = vi.fn();
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, axes: [], buttons }] });
  input.startCapture('pad', done); buttons[9].pressed = true; input.sample(null);
  assert.equal(done.mock.calls.length, 0); assert.equal(pause.mock.calls.length, 0); assert.equal(input.capture, 'pad');
  buttons[9].pressed = false; buttons[4].pressed = true; input.sample(null);
  assert.deepEqual(done.mock.calls, [[4]]);
});

test('clearing input also clears a pending interaction', () => {
  const { input, press } = setup(); press('KeyE'); input.clear();
  assert.equal(input.sample(null).interact, false);
});

test('clicking a card ignores the stale mouse aim over the bottom HUD', () => {
  const { input, pointer } = setup(); input.mouse.active = true;
  pointer('pointerdown', 500, 650); pointer('pointerup', 500, 650);
  const cast = input.sample({ x: 1, z: 1 });
  assert.equal(cast.card, 0); assert.equal(cast.aimX, 0); assert.equal(cast.aimZ, 0);
  assert.equal(input.sample({ x: 1, z: 1 }).aimX, 1, 'ordinary mouse aim resumes after the click');
});

test('only live mouse aiming carries the hovered target identity', () => {
  const { input, press, pointer } = setup(); input.mouse.active = true;
  assert.equal(input.sample({ x: 1, z: 0 }, 42).aimTargetId, 42);
  pointer('pointerdown', 500, 650); pointer('pointerup', 500, 650);
  assert.equal(input.sample({ x: 1, z: 0 }, 42).aimTargetId, undefined);
  press('KeyJ'); assert.equal(input.sample({ x: 1, z: 0 }, 42).aimTargetId, undefined);
});

test('the first pointer move activates aiming even when the browser reports zero movement', () => {
  const { input, canvas, press } = setup();
  const move = () => canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 600, clientY: 400, movementX: 0, movementY: 0 }));
  move(); assert.equal(input.sample({ x: 1, z: 0 }, 42).aimTargetId, 42);
  press('KeyJ'); move(); assert.equal(input.mouse.active, false, 'an unchanged position must not steal keyboard auto aim');
});

test('mouse and touch card drags preserve all screen directions and can be cancelled', () => {
  for (const pointerType of ['mouse', 'touch']) for (const [dx, dy] of [[0, -80], [80, 0], [0, 80], [-80, 0]]) {
    const { input, pointer, doc, card } = setup(); input.mouse.active = true;
    pointer('pointerdown', 500, 500, pointerType); pointer('pointermove', 500 + dx, 500 + dy, pointerType);
    const preview = input.sample(null);
    pointer('pointerup', 500 + dx, 500 + dy, pointerType);
    const cast = input.sample({ x: 1, z: 1 }); assert.equal(cast.card, 0);
    assert.equal(cast.aimX, preview.aimX); assert.equal(cast.aimZ, preview.aimZ);
    assert.ok(Math.hypot(cast.aimX!, cast.aimZ!) > .9);
    pointer('pointerdown', 500, 500, pointerType); pointer('pointermove', 500 + dx, 500 + dy, pointerType);
    doc.elementFromPoint = () => card; pointer('pointermove', 500, 500, pointerType); pointer('pointerup', 500, 500, pointerType);
    assert.equal(input.sample(null).card, -1);
  }
});
