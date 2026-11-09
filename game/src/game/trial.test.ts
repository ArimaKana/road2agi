import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Game } from './simulation';
import { CAMPAIGN } from './level';
import { trialRoom } from './trial';

const FRAME = 1 / 60;
const named = (number: number, last = '') => { const r = trialRoom(CAMPAIGN, number, last); return CAMPAIGN[r.region].rooms[r.index]; };
test('a trial brought back after losing the graphics device carries on from the same room count', () => {
  const g = new Game(); g.startTrial(); g.trial!.room = 7; g.hero.hp = 44; const run = g.snapshot(), id = g.plan.id;
  const back = new Game(); back.restore(run, 7);
  assert.equal(back.trial?.room, 7); assert.equal(back.plan.id, id); assert.equal(back.hero.hp, 44); assert.equal(back.state, 'playing');
});
// Empties the room and takes whatever it offers, as far as the open door.
function finishRoom(g: Game) {
  g.hero.invulnerable = 1000; g.enemies = []; g.wave = g.plan.waves.length;
  for (let i = 0; i < 300 && !g.cleared; i++) g.update(FRAME);
  if (g.state === 'reward') g.chooseReward(0);
}
function walkOn(g: Game) {
  const room = g.trial!.room;
  if (g.room.exit) { g.hero.x = g.room.exit.center.x; g.hero.z = g.room.exit.center.z; }
  for (let i = 0; i < 120 && g.trial!.room === room; i++) g.update(FRAME);
}

test('trial rooms come in tens, with a supply room at the fifth and the boss at the tenth', () => {
  assert.deepEqual([5, 10, 15, 20, 25, 30, 40, 50].map(n => named(n).id), ['1-8', '1-9', '2-8', '2-9', '3-8', '3-9', '4-1', '1-9']);
  assert.equal(named(35).kind, 'shop');
  for (let n = 1; n < 50; n++) if (n % 5) { const room = named(n); assert.equal(room.kind, 'battle', `${n}`); assert.ok(room.waves.length, `${n}`); }
});
test('the trial never gives the same fight twice in a row', () => {
  for (let i = 0; i < 40; i++) assert.notEqual(named(3, '1-2').id, '1-2');
});
test('a trial goes on past every boss and the last room, and unlocks nothing', () => {
  const g = new Game(); g.startTrial(); const album = [...g.unlocked];
  for (let room = 1; room <= 45; room++) {
    assert.equal(g.trial!.room, room); assert.equal(g.state, 'playing', `room ${room}`);
    finishRoom(g); assert.equal(g.state, 'playing', `room ${room} once cleared`); walkOn(g);
  }
  assert.equal(g.trial!.room, 46); assert.deepEqual([...g.unlocked], album);
});
test('each room makes the enemies tougher and their hits harder, but not what is only a target', () => {
  const g = new Game(); g.startTrial();
  assert.equal(g.newEnemy({ hp: 100, maxHp: 100 }).maxHp, 100);
  g.trial!.room = 11; const late = g.newEnemy({ hp: 100, maxHp: 100 }); assert.equal(late.maxHp, 180); assert.equal(late.hp, 180);
  assert.equal(g.newEnemy({ kind: 'b02fake', hp: 1, maxHp: 1 }).maxHp, 1); assert.equal(g.newEnemy({ kind: 'chain', hp: 40, maxHp: 40 }).maxHp, 40);
  g.hero.hp = 100; g.hurtHero(10); assert.equal(g.hero.hp, 86);
  const run = new Game(); run.start(); assert.equal(run.newEnemy({ hp: 100, maxHp: 100 }).maxHp, 100); run.hero.hp = 100; run.hurtHero(10); assert.equal(run.hero.hp, 90);
});
test('moving on to the next room heals a little', () => {
  const g = new Game(); g.startTrial(); finishRoom(g); g.hero.hp = 40; walkOn(g); assert.equal(g.hero.hp, 55);
});
test('a trial reward can take a card to its top level from the very first region', () => {
  const g = new Game(); g.startTrial();
  for (const card of g.hero.cards) { card.level = 2; card.branch = 'A'; }
  g.hero.invulnerable = 1000; g.enemies = []; g.wave = g.plan.waves.length;
  for (let i = 0; i < 300 && !g.cleared; i++) g.update(FRAME);
  assert.ok(g.reward!.options.some(o => o.kind === 'upgrade' && o.level === 3));
});
test('falling ends the trial and a new one starts again from the first room', () => {
  const g = new Game(); g.startTrial(); g.trial!.room = 7; g.hero.hp = 0; g.update(FRAME); assert.equal(g.state, 'lost');
  g.startTrial(); assert.equal(g.trial!.room, 1); assert.equal(g.state, 'playing');
  g.start(); assert.equal(g.trial, null);
});
