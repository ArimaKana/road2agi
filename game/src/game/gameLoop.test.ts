import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Game, type GameEvent } from './simulation';
import { GameLoop, FIXED_STEP, MAX_FRAME_TIME } from './gameLoop';
import { openMap } from './room';
import { PORT_THEME } from './level';

function arena() {
  const game = new Game({ name: '测试', theme: PORT_THEME, rooms: [{ id: 'T', name: '测试', kind: 'battle', map: openMap(), waves: [{ count: 1, hp: 1000 }] }] });
  game.start(); game.hero.x = 0; game.hero.z = 0;
  game.enemies = [game.newEnemy({ x: 40, z: 40, hp: 1000, maxHp: 1000, speed: 0, cooldown: 1000 })];
  return { game, loop: new GameLoop(game) };
}

test('movement and cooldowns progress equally at 15, 30, 60, 120 and 144 FPS', () => {
  const results = [15, 30, 60, 120, 144].map(fps => {
    const { game, loop } = arena(); game.hero.cards[0].cooldown = 10;
    for (let frame = 0; frame < fps * 2; frame++) loop.advance(1 / fps, { moveX: 1 }, () => {});
    assert.ok(Math.abs(game.time - 2) < 1e-8);
    assert.ok(Math.abs(game.hero.cards[0].cooldown - 8) < 1e-8);
    return game.hero.x;
  });
  for (const x of results) assert.ok(Math.abs(x - results[0]) < 1e-8);
});

test('a slow frame consumes a dash press once and delivers events from every step', () => {
  const { game, loop } = arena(), seen: GameEvent[] = [], feedback = (e: GameEvent) => seen.push(e);
  loop.advance(1 / 15, { dash: true, moveX: 1 }, feedback);
  for (let i = 0; i < 8; i++) loop.advance(1 / 15, {}, feedback);
  assert.equal(seen.filter(e => e.type === 'dash').length, 1);
  assert.equal(game.hero.dashCharges, 1);
});

test('a tap shorter than a fixed step is retained without turning into a held charge', () => {
  const { game, loop } = arena(), seen: GameEvent[] = [], feedback = (e: GameEvent) => seen.push(e);
  loop.advance(1 / 144, { attack: true }, feedback);
  loop.advance(1 / 144, { attack: false }, feedback);
  assert.equal(seen.length, 0);
  for (let i = 0; i < 144; i++) loop.advance(1 / 144, {}, feedback);
  assert.equal(seen.filter(e => e.type === 'attack').length, 1);
  assert.equal(seen.filter(e => e.type === 'chargeStart').length, 0);
  assert.equal(game.hero.attackHeld, false);
});

test('a buffered card retains the aim from the touch release until it is cast', () => {
  const { game, loop } = arena(), seen: GameEvent[] = [], feedback = (e: GameEvent) => seen.push(e);
  game.hero.cards = [{ ...game.hero.cards[0], id: 'minimax' }];
  loop.advance(1 / 144, { card: 0, aimX: 0, aimZ: -1 }, feedback);
  for (let frame = 0; frame < 60; frame++) loop.advance(1 / 144, {}, feedback);
  const train = seen.find(e => e.type === 'trainStart');
  assert.ok(train); assert.deepEqual(train.dir, { x: 0, z: -1 });
  assert.equal(seen.filter(e => e.type === 'summonConfirm').length, 1);
});

test('pausing during feedback stops catch-up and drops pending time and inputs', () => {
  const { game, loop } = arena();
  loop.advance(1 / 15, { attack: true }, e => { if (e.type === 'attack') game.pause(); });
  assert.equal(game.time, FIXED_STEP);
  loop.advance(5, { dash: true }, () => {}); game.resume();
  loop.advance(FIXED_STEP, {}, () => {});
  assert.equal(game.time, FIXED_STEP * 2); assert.equal(game.hero.dashCharges, 2);
});

test('a long suspension has a bounded catch-up cost', () => {
  const { game, loop } = arena(); loop.advance(60, {}, () => {});
  assert.ok(Math.abs(game.time - MAX_FRAME_TIME) < 1e-8);
  loop.advance(FIXED_STEP, {}, () => {});
  assert.ok(Math.abs(game.time - MAX_FRAME_TIME - FIXED_STEP) < 1e-8);
});
