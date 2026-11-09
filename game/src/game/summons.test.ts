import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Game, CHARGE, type Enemy, type GameInput } from './simulation';
import { CARDS, CLAUDE, GEMINI, GLM, GROK, KIMI, MINIMAX, SEED, STAGGER, SUMMON, TOKEN, type CardId } from './cards';
import { WALL, openMap, tileOf } from './room';
import { CACHE_PORT, type Level } from './level';
import { armorAgainst, makeEnemy } from './enemies';

const FRAME = 1 / 60;
const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) g.update(FRAME, input); };
const level = (): Level => ({ ...CACHE_PORT, name: '测试', rooms: [{ id: 'A', kind: 'battle', name: '甲', map: openMap(24), waves: [{ count: 1, hp: 48 }] }, { id: 'B', kind: 'battle', name: '乙', map: openMap(24), waves: [{ count: 1, hp: 48 }] }] });
let template: Enemy;
const arena = (...loadout: CardId[]) => {
  const g = new Game(level()); g.loadout = loadout.length ? loadout : ['glm', 'kimi', 'seed']; g.start();
  template = g.enemies[0]; g.enemies = [foe(g, { x: 30, z: 30 })]; g.hero.x = 0; g.hero.z = 0; g.hero.token = TOKEN.max; g.hero.invulnerable = 1000;
  return g;
};
// A still target with plenty of health that will not swing unless told to. The far one in each arena keeps the room from ending.
const foe = (g: Game, over: Partial<Enemy>): Enemy => ({ ...template, arrive: 0, id: g.nextId++, z: 0, vx: 0, vz: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, windup: 0, stun: 0, weak: [], ...over });
const put = (g: Game, ...over: Partial<Enemy>[]) => { const list = over.map(o => foe(g, o)); g.enemies.push(...list); return list; };
const press = (g: Game, slot: number, input: GameInput = {}) => g.update(FRAME, { ...input, card: slot });
const cast = (g: Game, slot: number, input: GameInput = {}) => {
  press(g, slot, input);
  for (let i = 0; i < 60 && !g.hero.summon?.confirmed; i++) g.update(FRAME, input);
  assert.ok(g.hero.summon?.confirmed, 'the card went off');
  for (let i = 0; i < 60 && g.hitstop > 0; i++) g.update(FRAME, input);
};
const events = (g: Game, seconds: number, input: GameInput = {}) => { const seen: string[] = []; for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(FRAME, input); seen.push(...g.events.map(e => e.type)); } return seen; };
const wall = (g: Game, x: number, z: number) => { const t = tileOf(g.room, x, z); g.room.walls[t.r * g.room.cols + t.c] = WALL; };
const tap = (g: Game, input: GameInput = {}) => { g.update(FRAME, { ...input, attack: true }); g.update(FRAME, input); };

test('a run starts on 60 Token, and only the first hit of each attack pays', () => {
  const g = arena(); g.hero.token = TOKEN.start; const [e] = put(g, { x: 2 });
  tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 }); assert.equal(g.hero.token, TOKEN.start + TOKEN.perHit); assert.ok(e.hp < 1000);
  const flurry = arena(); flurry.hero.token = 0; put(flurry, { x: 2 }); flurry.hero.combo = 'light'; flurry.hero.comboIndex = 1; flurry.hero.comboTimer = .3;
  tap(flurry, { aimX: 1 }); assert.equal(flurry.hero.action, 'flurry'); while (flurry.hero.attack) flurry.update(FRAME, { aimX: 1 });
  assert.equal(flurry.hero.token, TOKEN.perHit);
});
test('a kill by the hero pays extra, and at most 12 Token comes in a second', () => {
  const g = arena(); g.hero.token = 0; put(g, { x: 2, hp: 1 }); tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 });
  assert.equal(g.hero.token, TOKEN.perHit + TOKEN.perKill);
  const capped = arena(); capped.hero.token = 0; capped.gainToken(40); assert.equal(capped.hero.token, TOKEN.rate);
});
test('the charge costs 12 Token and will not start without it', () => {
  const g = arena(); g.hero.token = 40; const held = { attack: true, aimX: 1 };
  while (g.hero.charge === null) g.update(FRAME, held);
  step(g, .2, held); g.update(FRAME, { aimX: 1 }); assert.equal(g.hero.action, 'charge_release'); assert.equal(g.hero.token, 40 - CHARGE.cost);
  const broke = arena(); broke.hero.token = CHARGE.cost - 1; step(broke, CHARGE.holdAfter + .3, held); assert.equal(broke.hero.charge, null);
});
test('a card is paid for on its second frame, and goes on cooldown then', () => {
  const g = arena('grok', 'kimi', 'seed'); const cost = CARDS.grok.cost;
  press(g, 0, { aimX: 1 }); assert.ok(g.hero.summon); assert.equal(g.hero.summon!.confirmed, false); assert.equal(g.hero.token, TOKEN.max); assert.equal(g.hero.action, 'summon');
  step(g, SUMMON.confirmAt + .02, { aimX: 1 }); assert.equal(g.hero.token, TOKEN.max - cost); assert.ok(Math.abs(g.hero.cards[0].cooldown - CARDS.grok.cooldown) < .1);
});
test('a dash or a hit before the second frame calls the card off for free', () => {
  const g = arena('grok', 'kimi', 'seed'); press(g, 0, { aimX: 1 }); g.update(FRAME, { dash: true });
  assert.equal(g.hero.summon, null); step(g, .3); assert.equal(g.hero.token, TOKEN.max); assert.equal(g.hero.cards[0].cooldown, 0);
  const h = arena('grok', 'kimi', 'seed'); press(h, 0, { aimX: 1 }); h.hurtHero(1); step(h, .3); assert.equal(h.hero.token, TOKEN.max); assert.equal(h.hero.cards[0].cooldown, 0);
});
test('a card on cooldown or out of reach of the purse is refused and costs nothing', () => {
  const g = arena('grok', 'kimi', 'seed'); g.hero.cards[0].cooldown = 3; press(g, 0); assert.equal(g.hero.summon, null); assert.ok(g.events.some(e => e.type === 'cardDenied' && e.reason === '冷却中'));
  const poor = arena('grok', 'kimi', 'seed'); poor.hero.token = 10; press(poor, 0); assert.equal(poor.hero.summon, null); assert.ok(poor.events.some(e => e.type === 'cardDenied' && e.reason === 'Token 不足')); assert.equal(poor.hero.token, 10);
});
test('a card going off holds the fight for a moment', () => {
  const g = arena('grok', 'seed', 'minimax'); press(g, 1, { aimX: 1 });
  for (let i = 0; i < 60 && !g.hero.summon?.confirmed; i++) g.update(FRAME, { aimX: 1 });
  assert.equal(g.hitstop, SUMMON.freeze); const age = g.hero.summon!.age;
  for (let i = 0; i < 3; i++) g.update(FRAME); assert.equal(g.hero.summon!.age, age, 'nothing moves');
  for (let i = 0; i < 10; i++) g.update(FRAME); assert.ok(g.hero.summon!.age > age, 'and then it goes on');
});
test('two cards are at least 0.35 seconds apart even if a dash cuts the first one short', () => {
  const g = arena('grok', 'seed', 'minimax'); cast(g, 0, { aimX: 1 }); g.update(FRAME, { dash: true }); assert.equal(g.hero.summon, null);
  press(g, 1, { aimX: 1 }); assert.equal(g.hero.summon, null); assert.ok(g.hero.cardGap > 0);
});
test('the next room readies cards and discards unused Qwen charges without a refund', () => {
  const g = arena('grok', 'seed', 'minimax'); g.hero.cards[0].cooldown = 9; g.hero.token = 33; g.hero.zeroCharges = 2; g.hero.zeroRefund = 10;
  g.enterRoom(1); assert.equal(g.hero.cards[0].cooldown, 0); assert.equal(g.hero.token, 33); assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.zeroRefund, 0);
});
test('summon damage feeds neither Token nor the awakening gauge', () => {
  const g = arena('kimi', 'seed', 'grok'); put(g, { x: 4, hp: 10 }, { x: 5 }); g.hero.awaken = 0; cast(g, 0, { aimX: 4 }); const token = g.hero.token; step(g, KIMI.life);
  assert.equal(g.hero.token, token); assert.equal(g.hero.awaken, 0);
});

test('GLM turns the two nearest ordinary enemies within 4 metres, and no more', () => {
  const g = arena('glm', 'kimi', 'seed'); const [a, b, c, far] = put(g, { x: 2 }, { x: 3 }, { x: 4 }, { x: GLM.radius + 3 });
  cast(g, 0, { aimX: 1 }); assert.ok(a.allied > 0); assert.ok(b.allied > 0); assert.equal(c.allied, 0); assert.equal(far.allied, 0);
});
test('GLM only weakens an elite, only staggers a boss, and is refused with no one near', () => {
  const g = arena('glm', 'kimi', 'seed'); const [elite, boss] = put(g, { x: 2, elite: true }, { x: -2, boss: true, radius: .8 });
  cast(g, 0, { aimX: 1 }); assert.equal(elite.allied, 0); assert.equal(elite.weak[0].pct, GLM.eliteWeaken); assert.equal(boss.allied, 0); assert.equal(boss.stagger, GLM.bossStagger);
  const none = arena('glm', 'kimi', 'seed'); press(none, 0); assert.equal(none.hero.summon, null); assert.equal(none.hero.token, TOKEN.max);
});
test('a turned enemy attacks its old friends and the hero will not hit it', () => {
  const g = arena('glm', 'kimi', 'seed'); const [traitor, friend] = put(g, { x: 3, z: 0, cooldown: 0 }, { x: GLM.radius + 3, z: 0 });
  cast(g, 0, { aimX: 1 }); assert.ok(traitor.allied > 0); assert.equal(friend.allied, 0);
  traitor.x = friend.x - 1.2; step(g, 1.3); assert.equal(friend.hp, 1000 - GLM.allyDamage); assert.equal(g.hero.hp, 100);
  const hit = arena('glm', 'kimi', 'seed'); const [turned] = put(hit, { x: 2 }, { x: 28 }); cast(hit, 0, { aimX: 1 }); step(hit, SUMMON.duration); tap(hit, { aimX: 1 }); step(hit, .3, { aimX: 1 }); assert.equal(turned.hp, 1000);
});
test('a turned enemy comes round after 6 seconds, then cannot be turned again for 6', () => {
  const g = arena('glm', 'kimi', 'seed'); const [e] = put(g, { x: 2 }); e.speed = 0; cast(g, 0, { aimX: 1 });
  step(g, GLM.time + .1); assert.equal(e.allied, 0); assert.ok(e.alliedImmune > 5);
  g.hero.cards[0].cooldown = 0; press(g, 0); assert.equal(g.hero.summon, null);
});
test('with only turned enemies left they wake up early', () => {
  const g = arena('glm', 'kimi', 'seed'); g.enemies = []; const [e] = put(g, { x: 2 }); cast(g, 0, { aimX: 1 }); assert.ok(e.allied > 0 && e.allied <= GLM.wake);
  step(g, GLM.wake + .1); assert.equal(e.allied, 0); assert.equal(g.enemies.length, 1);
});

test('Qwen grants one free cast that survives waiting for cooldown and cannot be refreshed', () => {
  const g = arena('qwen', 'grok', 'minimax'); g.hero.token = 50; cast(g, 0); step(g, SUMMON.duration);
  assert.equal(g.hero.token, 5); assert.equal(g.hero.zeroCharges, 1); assert.equal(g.cardCost(g.hero.cards[0]), CARDS.qwen.cost);
  g.hero.cards[1].cooldown = 8; press(g, 1); assert.ok(g.events.some(e => e.type === 'cardDenied' && e.reason === '冷却中'));
  step(g, 9); assert.equal(g.hero.zeroCharges, 1); assert.equal(g.hero.token, 5);
  g.hero.token = 50; g.hero.cards[0].cooldown = 0; press(g, 0);
  assert.equal(g.hero.summon, null); assert.ok(g.events.some(e => e.type === 'cardDenied' && e.reason === '零消耗次数尚未用尽')); assert.equal(g.hero.token, 50);
  g.hero.token = 5; cast(g, 1, { aimX: 1 });
  assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.token, 5); assert.ok(g.hero.cards[1].cooldown > 0, 'free, but the cooldown still runs');
  assert.equal(g.cardCost(g.hero.cards[2]), CARDS.minimax.cost);
  step(g, SUMMON.duration); press(g, 2); assert.equal(g.hero.summon, null); assert.ok(g.events.some(e => e.type === 'cardDenied' && e.reason === 'Token 不足'));
});
test('refused and cancelled summons do not spend a Qwen charge', () => {
  const g = arena('qwen', 'kimi', 'grok'); cast(g, 0); step(g, SUMMON.duration);
  press(g, 1); assert.equal(g.hero.summon, null); assert.equal(g.hero.zeroCharges, 1, 'no target');
  put(g, { x: 4 }); press(g, 1); assert.equal(g.hero.action, 'summon'); assert.equal(g.hero.zeroCharges, 1);
  g.enemies = g.enemies.filter(e => e.x !== 4); step(g, SUMMON.confirmAt + .02);
  assert.equal(g.hero.summon, null); assert.equal(g.hero.cards[1].cooldown, 0); assert.equal(g.hero.zeroCharges, 1, 'target gone before confirmation');
  press(g, 2); g.update(FRAME, { dash: true }); step(g, .3);
  assert.equal(g.hero.summon, null); assert.equal(g.hero.cards[2].cooldown, 0); assert.equal(g.hero.zeroCharges, 1, 'cancelled before confirmation');
  assert.equal(g.hero.token, TOKEN.max - CARDS.qwen.cost);
});
test('Qwen charges ignore light attacks and cancelled charges, and pay once on charge release', () => {
  const g = arena('qwen'); g.hero.token = 50; cast(g, 0); step(g, SUMMON.duration);
  tap(g, { aimX: 1 }); step(g, 1); assert.equal(g.hero.zeroCharges, 1, 'light attacks are already free');
  const held = { attack: true, aimX: 1 };
  for (let i = 0; i < 120 && g.hero.charge === null; i++) g.update(FRAME, held);
  assert.notEqual(g.hero.charge, null); assert.equal(g.hero.zeroCharges, 1, 'not paid at charge start');
  g.update(FRAME, { dash: true }); step(g, .3); assert.equal(g.hero.charge, null); assert.equal(g.hero.zeroCharges, 1);
  for (let i = 0; i < 120 && g.hero.charge === null; i++) g.update(FRAME, held);
  assert.notEqual(g.hero.charge, null); g.update(FRAME, { aimX: 1 });
  assert.equal(g.hero.action, 'charge_release'); assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.token, 5);
  assert.equal(g.events.filter(e => e.type === 'qwenOff').length, 1);
  step(g, 2); assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.token, 5);
  step(g, 1, held); assert.equal(g.hero.charge, null, 'the next charge needs Token again');
});
test('GPT resets Qwen cooldown without adding uses, and Qwen still pays for her next cast', () => {
  const g = arena('qwen', 'gpt', 'minimax'); g.hero.cards[0].level = 2; g.hero.cards[0].branch = 'A';
  cast(g, 0); step(g, SUMMON.duration); cast(g, 1);
  assert.equal(g.hero.zeroCharges, 1); assert.equal(g.hero.cards[0].cooldown, 0); assert.equal(g.hero.token, 55);
  assert.equal(g.cardRefusal(0), '零消耗次数尚未用尽'); assert.ok(g.hero.cards[1].cooldown > 0);
  step(g, SUMMON.duration); cast(g, 2); assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.token, 55);
  step(g, SUMMON.duration); cast(g, 0); assert.equal(g.hero.zeroCharges, 2); assert.equal(g.hero.token, 10);
});

test('Kimi lands three bolts on three different enemies', () => {
  const g = arena('kimi', 'seed', 'grok'); const [a, b, c] = put(g, { x: 5 }, { x: 6, z: 3 }, { x: 6, z: -3 });
  cast(g, 0, { aimX: 5 }); step(g, KIMI.life); assert.deepEqual([a.hp, b.hp, c.hp], [1000 - KIMI.damage, 1000 - KIMI.damage, 1000 - KIMI.damage]);
  assert.equal(g.prisms.length, 0);
});
test('a lone enemy takes one full bolt and two halves from Kimi', () => {
  const g = arena('kimi', 'seed', 'grok'); g.enemies = []; const [e] = put(g, { x: 5 }); cast(g, 0, { aimX: 5 }); step(g, KIMI.life);
  assert.equal(e.hp, 1000 - KIMI.damage - 2 * KIMI.repeat); assert.equal(e.hp, 1000 - 48); assert.equal(e.stun, 0);
});
test('Kimi goes for the enemy she can see, whichever way she is aiming and however far the cursor is', () => {
  const g = arena('kimi', 'seed', 'grok'); g.enemies = []; const [e] = put(g, { x: -6 });
  cast(g, 0, { aimX: 40 }); assert.equal(g.prisms[0].x, -3); step(g, KIMI.life); assert.equal(e.hp, 1000 - KIMI.damage - 2 * KIMI.repeat);
  const near = arena('kimi', 'seed', 'grok'); near.enemies = []; put(near, { x: 4 }); cast(near, 0, { aimX: .8 }); const close = near.prisms[0].x;
  const far = arena('kimi', 'seed', 'grok'); far.enemies = []; put(far, { x: 4 }); cast(far, 0, { aimX: 80 }); assert.equal(far.prisms[0].x, close, 'how far the aim reaches makes no difference');
});
test('Seed drops the decoy the same way ahead however far the aim reaches', () => {
  const place = (aimX: number) => { const g = arena('seed', 'kimi'); g.enemies = g.enemies.slice(0, 1); cast(g, 0, { aimX }); return g.decoy!.x; };
  assert.equal(place(1), SEED.reach / 2); assert.equal(place(40), SEED.reach / 2);
});
test('Kimi cannot shine through a wall and costs nothing with no one to hit', () => {
  const g = arena('kimi', 'seed', 'grok'); g.enemies = []; put(g, { x: 7 }); wall(g, 4, 0); press(g, 0, { aimX: 2.5 }); assert.equal(g.hero.summon, null); assert.equal(g.hero.token, TOKEN.max);
});

test('Seed heals 15 and spends her budget only on health actually restored', () => {
  const g = arena('seed', 'kimi', 'grok'); g.hero.hp = 50; cast(g, 0); assert.equal(g.hero.hp, 65); assert.equal(g.hero.healBudget, SEED.budget - 15);
  const full = arena('seed', 'kimi', 'grok'); cast(full, 0); assert.equal(full.hero.hp, 100); assert.equal(full.hero.healBudget, SEED.budget);
  const low = arena('seed', 'kimi', 'grok'); low.hero.hp = 50; low.hero.healBudget = 5; cast(low, 0); assert.equal(low.hero.hp, 55); assert.equal(low.hero.healBudget, 0); assert.ok(low.decoy, 'the decoy still lands');
  const next = new Game(); next.loadout = ['seed']; next.start('1-9'); next.hero.healBudget = 0; next.state = 'prep'; next.confirmPrep(); assert.equal(next.hero.healBudget, SEED.budget, 'each region has its own');
});
test('ordinary enemies swing at the decoy, an elite only for 2 seconds, and it is gone after 5', () => {
  const g = arena('seed', 'kimi', 'grok'); const [e] = put(g, { x: 5, cooldown: 0, speed: 2 }); cast(g, 0, { aimX: 1 }); assert.equal(g.decoy!.x, SEED.reach / 2);
  step(g, 1); assert.ok(e.windup > 0 || e.attackX === g.decoy!.x); assert.equal(e.attackX, g.decoy!.x); assert.equal(g.hero.hp, 100);
  const elite = arena('seed', 'kimi', 'grok'); const [v] = put(elite, { x: 7, elite: true }); cast(elite, 0, { aimX: 5 }); assert.ok(v.lured > 1.5); step(elite, SEED.eliteTaunt + .1); assert.equal(v.lured, 0);
  assert.ok(g.decoy); assert.ok(events(g, SEED.life).includes('decoyEnd')); assert.equal(g.decoy, null);
});
test('a boss is not pulled to the decoy but hits softer for 2 seconds', () => {
  const g = arena('seed', 'kimi', 'grok'); g.hero.invulnerable = 0; const [boss] = put(g, { x: 1.5, boss: true, radius: .8, cooldown: 0 }); cast(g, 0, { aimX: 5 });
  assert.equal(boss.weak[0].pct, SEED.bossWeaken); assert.equal(boss.attackX, 0); g.hero.hp = 100; boss.windup = .01; g.update(FRAME); assert.equal(g.hero.hp, 100 - Math.round(22 * (1 - SEED.bossWeaken)));
});

test('the MiniMax train hits each enemy once and shoves it along', () => {
  const g = arena('minimax', 'kimi', 'grok'); const [e] = put(g, { x: 3 }); cast(g, 0, { aimX: 1 }); step(g, 1.2);
  assert.equal(e.hp, 1000 - MINIMAX.damage); assert.ok(e.x > 4); assert.equal(g.trains.length, 0);
});
test('a boss takes more from the train but does not move, an elite barely moves', () => {
  const g = arena('minimax', 'kimi', 'grok'); const [boss] = put(g, { x: 3, boss: true, radius: .8 }); cast(g, 0, { aimX: 1 }); step(g, 1.2); assert.equal(boss.hp, 1000 - MINIMAX.bossDamage); assert.equal(boss.x, 3);
  const h = arena('minimax', 'kimi', 'grok'); const [elite] = put(h, { x: 3, elite: true }); cast(h, 0, { aimX: 1 }); step(h, 1.2); assert.ok(elite.x < 4);
});
test('shoved into a wall an enemy takes one extra hit', () => {
  const g = arena('minimax', 'kimi', 'grok'); const [e] = put(g, { x: 5 }); wall(g, 7, 0); cast(g, 0, { aimX: 1 }); const seen = events(g, 1.2);
  assert.equal(e.hp, 1000 - MINIMAX.damage - MINIMAX.wallDamage); assert.equal(seen.filter(t => t === 'trainWall').length, 1);
});
test('a wall stops the train', () => {
  const g = arena('minimax', 'kimi', 'grok'); const [e] = put(g, { x: 8 }); wall(g, 4, 0); cast(g, 0, { aimX: 1 }); step(g, 1.2); assert.equal(e.hp, 1000); assert.equal(g.trains.length, 0);
});

test('GPT refills the dash and the other two cards but not herself, health or Token', () => {
  const g = arena('gpt', 'kimi', 'grok'); g.hero.cards[1].cooldown = 7; g.hero.cards[2].cooldown = 3; g.hero.dashCharges = 0; g.hero.hp = 40; g.hero.zeroCharges = 0; cast(g, 0);
  assert.equal(g.hero.dashCharges, 2); assert.equal(g.hero.cards[1].cooldown, 0); assert.equal(g.hero.cards[2].cooldown, 0); assert.ok(g.hero.cards[0].cooldown > 27); assert.equal(g.hero.hp, 40); assert.equal(g.hero.token, TOKEN.max - CARDS.gpt.cost);
});

test('Claude strikes one second after the mark and seals the target', () => {
  const g = arena('claude', 'kimi', 'grok'); const [e] = put(g, { x: 5 }); cast(g, 0, { aimX: 1 }); step(g, CLAUDE.delay - .2); assert.equal(e.hp, 1000); assert.equal(g.seals.length, 1);
  step(g, .3); assert.equal(e.hp, 1000 - CLAUDE.damage); assert.ok(e.sealed > 0); assert.equal(g.seals.length, 0);
});
test('Claude executes under 25% except on a boss, which takes more and gains stagger', () => {
  const g = arena('claude', 'kimi', 'grok'); const [e] = put(g, { x: 5, hp: 420 }); cast(g, 0, { aimX: 1 }); const seen = events(g, CLAUDE.delay + .1); assert.ok(seen.includes('claudeExecute')); assert.ok(!g.enemies.includes(e));
  const h = arena('claude', 'kimi', 'grok'); const [boss] = put(h, { x: 5, boss: true, radius: .8, hp: 250, maxHp: 1000 }); cast(h, 0, { aimX: 1 }); step(h, CLAUDE.delay + .1); assert.equal(boss.hp, 10); assert.ok(h.enemies.includes(boss)); assert.equal(boss.stagger, CLAUDE.bossStagger);
});

test('Claude executes real armoured enemies and pays the kill exactly once', () => {
  for (const kind of ['e09', 'e09e', 'e12e'] as const) {
    const g = arena('claude'), e = makeEnemy(g, kind, { x: 5, z: 0 }, { cooldown: 100, speed: 0 });
    e.hp = Math.round(CLAUDE.damage * (1 - armorAgainst(e, 'claude', g.hero))) + Math.floor(e.maxHp * .1);
    cast(g, 0, { aimX: 1 }); const seen = events(g, CLAUDE.delay + .1);
    assert.ok(seen.includes('claudeExecute'), kind);
    assert.equal(e.hp, 0, kind); assert.ok(!g.enemies.includes(e), kind);
    assert.equal(seen.filter(t => t === 'kill').length, 1);
    assert.equal(g.kills, 1); assert.equal(g.hero.coins, e.elite ? 5 : 1);
    assert.equal(g.hero.awaken, 0); assert.equal(g.hero.token, TOKEN.max - CARDS.claude.cost);
    g.executeEnemy(e); assert.equal(g.kills, 1, 'a dead target cannot pay again');
  }
});
test('executing the last chain still frees the statue without awarding a kill', () => {
  const g = arena('claude'), boss = makeEnemy(g, 'b03', { x: 10, z: 0 });
  const chain = makeEnemy(g, 'chain', { x: 5, z: 0 }, { hp: 4, maxHp: 40 });
  chain.ai.owner = boss.id; boss.ai.chains = 1;
  g.executeEnemy(chain);
  assert.equal(chain.hp, 0); assert.equal(boss.ai.chains, 0); assert.equal(boss.ai.final, true);
  assert.equal(g.prompt?.id, boss.id); assert.ok(g.events.some(e => e.type === 'chainCut'));
  assert.equal(g.kills, 0); assert.equal(g.hero.coins, 0); assert.equal(g.hero.token, TOKEN.max);
});
test('Claude turns on the nearest enemy if the target dies first, and never refunds', () => {
  const g = arena('claude', 'kimi', 'grok'); const [e, near] = put(g, { x: 5 }, { x: 6, z: 1 }); cast(g, 0, { aimX: 1 }); const paid = g.hero.token; e.hp = 0; step(g, CLAUDE.delay + .1);
  assert.equal(near.hp, 1000 - CLAUDE.damage); assert.equal(g.hero.token, paid);
  const miss = arena('claude', 'kimi', 'grok'); const [only] = put(miss, { x: 5 }); cast(miss, 0, { aimX: 1 }); const left = miss.hero.token; only.hp = 0; const seen = events(miss, CLAUDE.delay + .1); assert.ok(seen.includes('claudeStrike')); assert.equal(miss.hero.token, left);
});
test('Claude needs a target in sight', () => {
  const g = arena('claude', 'kimi', 'grok'); press(g, 0); assert.equal(g.hero.summon, null); assert.equal(g.hero.token, TOKEN.max);
});

test('base Claude seals shields before impact and splashes nearby enemies without executing them', () => {
  const g = arena('claude');
  const [target, nearby, far] = put(g, { x: 5, shieldHp: 500 }, { x: 5, z: 2, hp: 100, shieldHp: 500 }, { x: 5, z: 7 });
  cast(g, 0, { aimX: 1 }); step(g, CLAUDE.delay + .1);
  assert.equal(target.hp, 820); assert.equal(target.shieldHp, 500, 'the verdict bypasses the sealed shield');
  assert.equal(nearby.hp, 10); assert.ok(g.enemies.includes(nearby), 'splash never executes');
  assert.ok(target.sealed > 2.5 && nearby.sealed > 2.5); assert.equal(far.hp, 1000); assert.equal(far.sealed, 0);
  assert.equal(g.hero.token, 25, 'Claude still costs 75'); assert.equal(CARDS.claude.cooldown, 26);
});

test('Claude splash respects walls and cannot seal an invulnerable target', () => {
  const g = arena('claude'); const [target, blocked, immune] = put(g, { x: 5 }, { x: 5, z: 3 }, { x: 6, z: -1 });
  wall(g, 5, 1.5); immune.ai = { ...immune.ai, invuln: 10 };
  cast(g, 0, { aimX: 1 }); step(g, CLAUDE.delay + .1);
  assert.ok(target.hp < 1000); assert.equal(blocked.hp, 1000); assert.equal(blocked.sealed, 0);
  assert.equal(immune.hp, 1000); assert.equal(immune.sealed, 0);
});

test('Grok stops the ordinary enemies in front from attacking, and cancels a swing in progress', () => {
  const g = arena('grok', 'kimi', 'seed'); const [front, back] = put(g, { x: 1.2, cooldown: 0, windup: .4, attackX: 0, attackZ: 0 }, { x: -1.2, cooldown: 100 }); g.hero.invulnerable = 0;
  cast(g, 0, { aimX: 1 }); assert.ok(front.charm > 2.5); assert.equal(front.windup, 0); assert.equal(back.charm, 0);
  step(g, GROK.time - .3); assert.equal(front.windup, 0); assert.equal(g.hero.hp, 100); assert.equal(front.hp, 1000);
  step(g, .5); assert.equal(front.charm, 0); assert.ok(front.charmImmune > 3);
  g.hero.cards[0].cooldown = 0; g.hero.summon = null; front.cooldown = 100; cast(g, 0, { aimX: 1 }); assert.equal(front.charm, 0, 'immune for 4 seconds after');
});
test('Grok stops a line of worms as one, and a projection with its images', () => {
  const g = arena('grok', 'kimi', 'seed');
  const [lead, last, other] = put(g, { x: 1.2, kind: 'e01', cooldown: 100 }, { x: -3, kind: 'e01', cooldown: 100 }, { x: -3, z: 3, kind: 'e01', cooldown: 100 });
  lead.ai = { ...lead.ai, team: 7 }; last.ai = { ...last.ai, team: 7 }; other.ai = { ...other.ai, team: 8 }; g.hero.invulnerable = 0;
  cast(g, 0, { aimX: 1 }); assert.ok(lead.charm > 2.5); assert.ok(last.charm > 2.5, 'behind her, but in the same line'); assert.equal(other.charm, 0);
  const h = arena('grok', 'kimi', 'seed'); const [body, image] = put(h, { x: 1.2, kind: 'e05', cooldown: 100 }, { x: -3, kind: 'phantom', cooldown: 100 }); image.ai = { ...image.ai, owner: body.id };
  cast(h, 0, { aimX: 1 }); assert.ok(body.charm > 2.5); assert.ok(image.charm > 2.5);
});
test('a charmed enemy still walks and can still be hurt', () => {
  const g = arena('grok', 'kimi', 'seed'); const [e] = put(g, { x: 5, speed: 2, cooldown: 0 }); cast(g, 0, { aimX: 1 }); const from = e.x; step(g, .5, { aimX: 1 }); assert.ok(e.x < from);
  g.damage(e, 10, 0, 0, 0); assert.ok(e.charm > 0);
});
test('Grok holds an elite half as long and a boss not at all', () => {
  const g = arena('grok', 'kimi', 'seed'); const [elite] = put(g, { x: 3, elite: true }); cast(g, 0, { aimX: 1 }); assert.ok(elite.charm <= GROK.eliteTime && elite.charm > 1);
  const h = arena('grok', 'kimi', 'seed'); const [boss] = put(h, { x: 3, boss: true, radius: .8 }); cast(h, 0, { aimX: 1 }); assert.equal(boss.charm, 0); assert.equal(boss.weak[0].pct, GROK.bossWeaken); assert.equal(boss.stagger, GROK.bossStagger);
});
test('a boss reels at 100 stagger and then shrugs it off for 8 seconds', () => {
  const g = arena('grok', 'kimi', 'seed'); const [boss] = put(g, { x: 3, boss: true, radius: .8, stagger: STAGGER.full - 5, cooldown: 0 }); const seen: string[] = [];
  press(g, 0, { aimX: 1 }); for (let i = 0; i < 20; i++) { g.update(FRAME, { aimX: 1 }); seen.push(...g.events.map(e => e.type)); }
  assert.ok(seen.includes('bossStagger')); assert.ok(boss.staggered > 1); assert.equal(boss.stagger, 0); assert.equal(boss.windup, 0);
  const before = boss.stagger; g.hero.cards[0].cooldown = 0; step(g, SUMMON.duration); cast(g, 0, { aimX: 1 }); assert.equal(boss.stagger, before);
});

test('Gemini never hits one target more than four times and adds the finisher', () => {
  const g = arena('gemini', 'kimi', 'seed'); const [e] = put(g, { x: 3 }); g.enemies = g.enemies.filter(o => o === e); cast(g, 0, { aimX: 1 }); const seen = events(g, GEMINI.gap * (GEMINI.hits + 3));
  assert.equal(e.hp, 1000 - 4 * GEMINI.damage - GEMINI.finisher); assert.equal(seen.filter(t => t === 'geminiDash').length, 4); assert.ok(seen.includes('geminiEnd')); assert.equal(g.blitzes.length, 0);
});
test('Gemini weaves between at most four enemies for six hits and a finisher', () => {
  const g = arena('gemini', 'kimi', 'seed'); const list = put(g, { x: 3 }, { x: 4, z: 2 }, { x: 4, z: -2 }, { x: 5, z: 3 }, { x: 5, z: -3 }); cast(g, 0, { aimX: 1 }); step(g, GEMINI.gap * (GEMINI.hits + 3));
  const hurt = list.filter(e => e.hp < 1000), dealt = list.reduce((sum, e) => sum + 1000 - e.hp, 0);
  assert.equal(hurt.length, GEMINI.targets); assert.equal(dealt, GEMINI.hits * GEMINI.damage + GEMINI.finisher);
});
test('Gemini will not pass through a wall', () => {
  const g = arena('gemini', 'kimi', 'seed'); g.enemies = []; put(g, { x: 6 }); wall(g, 3, 0); press(g, 0, { aimX: 1 }); assert.equal(g.hero.summon, null);
});

test('GLM and Grok: whoever comes out of it hesitates longer', () => {
  const free = (...team: CardId[]) => { const g = arena(...team); const [e] = put(g, { x: 20, allied: .001, cooldown: 0 }); g.update(FRAME); return e.cooldown; };
  assert.ok(free('glm', 'grok') > 1.5); assert.ok(free('glm', 'kimi') < 1);
});
test('Kimi and GPT: a reset makes the next first bolt stronger, once', () => {
  const reset = arena('gpt', 'kimi'); cast(reset, 0); assert.equal(reset.hero.refractReady, true);
  const bolts = (...team: CardId[]) => { const g = arena(...team); g.enemies = []; const [e] = put(g, { x: 5 }); g.hero.refractReady = true; cast(g, team.indexOf('kimi'), { aimX: 5 }); step(g, KIMI.life); return [e.hp, g.hero.refractReady]; };
  assert.deepEqual(bolts('kimi', 'gpt'), [1000 - Math.round(KIMI.damage * 1.3) - 2 * KIMI.repeat, false]);
  assert.deepEqual(bolts('kimi', 'seed'), [1000 - KIMI.damage - 2 * KIMI.repeat, true]);
});
test('MiniMax and Kimi: a target just shoved into a wall takes the first bolt harder', () => {
  const bolts = (...team: CardId[]) => { const g = arena(...team); g.enemies = []; const [e] = put(g, { x: 5, wallMark: 3 }); cast(g, team.indexOf('kimi'), { aimX: 5 }); step(g, KIMI.life); return e.hp; };
  assert.equal(bolts('minimax', 'kimi'), 1000 - Math.round(KIMI.damage * 1.25) - 2 * KIMI.repeat);
  assert.equal(bolts('seed', 'kimi'), 1000 - KIMI.damage - 2 * KIMI.repeat);
  const g = arena('minimax', 'kimi'); const [e] = put(g, { x: 5 }); wall(g, 7, 0); cast(g, 0, { aimX: 1 }); step(g, .8); assert.ok(e.wallMark > 0, 'the wall leaves its mark');
});
test('Qwen and Gemini: the final free cast still adds one more dash', () => {
  const dashes = (zeroCharges: number, ...team: CardId[]) => { const g = arena(...team); put(g, { x: 5 }); g.hero.zeroCharges = zeroCharges; press(g, team.indexOf('gemini'), { aimX: 1 }); for (let i = 0; i < 120 && !g.blitzes.length; i++) g.update(FRAME, { aimX: 1 }); assert.equal(g.hero.zeroCharges, 0); return g.blitzes[0].total; };
  assert.equal(dashes(1, 'qwen', 'gemini'), dashes(1, 'kimi', 'gemini') + 1);
  assert.equal(dashes(0, 'qwen', 'gemini'), dashes(0, 'kimi', 'gemini'));
});
test('Seed and Claude: an elite held by the decoy takes the verdict harder', () => {
  const verdict = (decoy: boolean) => {
    const g = arena('seed', 'claude'); const [e] = put(g, { x: 5, elite: true });
    if (decoy) { cast(g, 0, { aimX: 3 }); step(g, 1.2); }
    g.hero.token = TOKEN.max; e.lured = 10; cast(g, 1, { aimX: 1 }); step(g, CLAUDE.delay + .1);
    return 1000 - e.hp;
  };
  assert.ok(verdict(true) > verdict(false) * 1.2);
});
test('GLM and Seed: when the decoy goes, those fighting for her are easier to hurt', () => {
  const after = (...team: CardId[]) => { const g = arena(...team); const [e] = put(g, { x: 20, allied: 100 }); cast(g, team.indexOf('seed'), { aimX: 3 }); step(g, SEED.life + .1); return e.broken; };
  assert.ok(after('glm', 'seed') > 0); assert.equal(after('kimi', 'seed'), 0);
});
test('a mod widens the charged thrust, and another sharpens the thrust after a dash', () => {
  const width = (...mods: ('wide')[]) => { const g = arena(); g.hero.token = TOKEN.max; g.hero.mods = mods; const held = { attack: true, aimX: 1 }; step(g, CHARGE.holdAfter + CHARGE.windup + .2, held); g.update(FRAME, { aimX: 1 }); assert.equal(g.hero.action, 'charge_release'); return g.hero.attack!.width; };
  assert.ok(Math.abs(width('wide') / width() - 1.4) < .01);
  const thrust = (...mods: ('opener')[]) => { const g = arena(); g.hero.mods = mods; g.hero.dashLinger = .2; g.update(FRAME, { attack: true, aimX: 1 }); return g.hero.attack!.damage; };
  assert.equal(thrust('opener'), Math.round(thrust() * 1.3));
});
test('the back door: nothing hurts her and Token never runs out', () => {
  const g = arena('kimi', 'seed'); g.god = true; g.hero.invulnerable = 0; g.hero.hp = 100;
  g.hurtHero(50); assert.equal(g.hero.hp, 100); assert.equal(g.hero.invulnerable, 0);
  g.hero.token = 0; g.hero.tokenLock = 5; g.update(FRAME); assert.equal(g.hero.token, g.hero.tokenMax); assert.equal(g.hero.tokenLock, 0);
  g.start(); g.hurtHero(50); assert.equal(g.hero.hp, 100, 'it stays on for the next run');
  g.god = false; g.hurtHero(50); assert.equal(g.hero.hp, 50);
});

test('MiniMax and Grok hit in all eight aimed directions after a press during hitstop or recovery', () => {
  for (const id of ['minimax', 'grok'] as const) for (const wait of ['hitstop', 'recovery'] as const) for (let i = 0; i < 8; i++) {
    const g = arena(id), angle = i / 8 * Math.PI * 2, aim = { x: Math.cos(angle), z: Math.sin(angle) };
    const [front, back] = put(g, { x: aim.x * 4, z: aim.z * 4 }, { x: -aim.x * 4, z: -aim.z * 4 });
    if (wait === 'hitstop') g.hitstop = .12;
    else { tap(g, { aimX: -aim.z, aimZ: aim.x }); g.hero.attackAge = .05; }
    press(g, 0, { aimX: aim.x, aimZ: aim.z });
    let fired = false;
    for (let frame = 0; frame < 100; frame++) {
      g.update(FRAME, { aimX: -aim.x, aimZ: -aim.z });
      const event = g.events.find(e => e.type === 'trainStart' || e.type === 'grokWave');
      if (event && (event.type === 'trainStart' || event.type === 'grokWave')) {
        const dir = event.type === 'trainStart' ? event.dir : event.aim;
        assert.ok(dir.x * aim.x + dir.z * aim.z > .999, `${id} ${wait} direction ${i}`); fired = true;
      }
    }
    assert.ok(fired); assert.ok(id === 'minimax' ? front.hp < 1000 : front.charm > 0);
    assert.equal(id === 'minimax' ? back.hp : back.charm, id === 'minimax' ? 1000 : 0);
  }
});
