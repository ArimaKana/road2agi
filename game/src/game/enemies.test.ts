import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { Game, LIGHT_CHAIN, CHARGE, type Enemy, type GameInput } from './simulation';
import { makeEnemy, shieldUp, shoot, type EnemyKind } from './enemies';
import { ENCOUNTERS, unitsOf } from './encounters';
import { CAMPAIGN, PORT_THEME, type Level } from './level';
import { regionArt } from './loading';
import { openMap, tileOf } from './room';

const FRAME = 1 / 60;
const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < seconds * 60; i++) g.update(FRAME, input); };
const arena = (): Game => {
  const level: Level = { name: '测试', theme: PORT_THEME, rooms: [{ id: 'T', kind: 'battle', name: '测试', map: openMap(), waves: [{ count: 1, hp: 1000 }] }] };
  const g = new Game(level); g.start(); g.hero.x = 0; g.hero.z = 0; g.enemies = []; return g;
};
const put = (g: Game, kind: EnemyKind, x: number, z = 0, cooldown = 0) => makeEnemy(g, kind, { x, z }, { cooldown });

test('every room of the plan names kinds that exist, and the counts match the table', () => {
  for (const level of CAMPAIGN) for (const room of level.rooms) {
    const plan = ENCOUNTERS[room.id];
    if (!plan) { assert.equal(room.waves.length, 0, room.id); continue; }
    assert.equal(room.waves.length, plan.length, room.id);
    room.waves.forEach((wave, i) => assert.equal(wave.count, unitsOf(plan[i]).length, room.id));
  }
  const g = new Game(); g.start('1-2'); assert.deepEqual(g.enemies.map(e => e.kind), ['e01', 'e01', 'e01', 'e01']);
});
test('the front of a shield stops the thrust and what is behind it, but not from the side', () => {
  const g = arena(), guard = put(g, 'e02', 2, 0, 99), behind = put(g, 'e01', 3.4, 0, 99); guard.facing = Math.PI; guard.speed = behind.speed = 0;
  g.hero.aim = { x: 1, z: 0 }; g.strike(LIGHT_CHAIN[0]); assert.equal(guard.hp, guard.maxHp); assert.equal(behind.hp, behind.maxHp); assert.ok(g.events.some(e => e.type === 'shieldBlock'));
  guard.facing = 0; g.strike(LIGHT_CHAIN[0]); assert.ok(guard.hp < guard.maxHp, 'its back is open');
});
test('any charged thrust breaks a guard from the front, and only a full one breaks the elite', () => {
  const g = arena(), guard = put(g, 'e02', 2, 0, 99); guard.facing = Math.PI; g.hero.aim = { x: 1, z: 0 }; g.hero.combo = 'charge';
  g.strike({ ...LIGHT_CHAIN[0], ...CHARGE.weak }); assert.ok(guard.hp < guard.maxHp); assert.equal(shieldUp(guard), false, 'its shield is out');
  const h = arena(), elite = put(h, 'e02e', 2, 0, 99); elite.facing = Math.PI; h.hero.aim = { x: 1, z: 0 }; h.hero.combo = 'charge';
  h.strike({ ...LIGHT_CHAIN[0], ...CHARGE.weak }); assert.equal(elite.hp, elite.maxHp);
  h.strike({ ...LIGHT_CHAIN[0], ...CHARGE.strong }); assert.ok(elite.hp < elite.maxHp);
});
test('a knight has half armour in front and none behind, and cards always meet it', () => {
  const g = arena(), knight = put(g, 'e09', 2, 0, 99); knight.facing = Math.PI;
  g.damage(knight, 20, 0, 0, 0, true, 'light', 0); assert.equal(knight.hp, knight.maxHp - 10);
  knight.facing = 0; g.damage(knight, 20, 0, 0, 0, true, 'light', 0); assert.equal(knight.hp, knight.maxHp - 30);
  g.damage(knight, 20, 0, 0, 0, false, 'kimi', 0); assert.equal(knight.hp, knight.maxHp - 40);
});
test('a warning shows the real shape, and leaving it in time means no damage', () => {
  const g = arena(), worm = put(g, 'e01', 3); worm.ai.lead = worm.id; g.update(FRAME);
  assert.equal(g.blasts.length, 1); assert.equal(g.blasts[0].shape, 'line'); assert.equal(g.blasts[0].damage, 8);
  g.hero.x = 0; g.hero.z = 6; step(g, .6); assert.equal(g.hero.hp, 100);
  const h = arena(), still = put(h, 'e01', 3); still.ai.lead = still.id; step(h, .6); assert.equal(h.hero.hp, 92);
});
test('what softens a blow softens the shots, rings and zones it leaves too', () => {
  for (const hit of [
    (g: Game, e: Enemy) => shoot(g, g.hero.x, g.hero.z, { x: 1, z: 0 }, 1, 5, 20, 'enemy', 'data', false, 0, e.id),
    (g: Game, e: Enemy) => g.rings.push({ id: 9, owner: e.id, x: g.hero.x, z: g.hero.z, reach: 0, max: 8, speed: 1, width: 2, gapAt: Math.PI, gapHalf: .01, damage: 20, camp: 'enemy', hit: new Set() }),
  ]) {
    const g = arena(), e = put(g, 'e06', 20, 9, 99); e.speed = 0; e.weak = [{ pct: .5, time: 9 }]; g.hero.hp = 100; g.hero.invulnerable = 0;
    hit(g, e); step(g, .1);
    assert.equal(g.hero.hp, 90);
  }
});
test('a courier fires three shots that stop at a wall and hurt when they reach her', () => {
  const g = arena(), courier = put(g, 'e03', 7); step(g, .75); assert.equal(g.shots.length, 3);
  step(g, 1.2); assert.ok(g.hero.hp < 100); assert.ok(courier.hp > 0);
});
test('a priest raises two echoes at most, which pay nothing and vanish with it', () => {
  const g = arena(), priest = put(g, 'e04', 7); g.hero.hp = 100; step(g, 1.2); const echoes = g.enemies.filter(e => e.kind === 'echo'); assert.equal(echoes.length, 2);
  const token = g.hero.token, gauge = g.hero.awaken; g.damage(echoes[0], 100, 0, 0, 0, true, 'light', 0); assert.equal(g.kills, 0); assert.ok(g.hero.token === token && g.hero.awaken === gauge);
  g.damage(priest, 1000, 0, 0, 0, true, 'light', 0); step(g, .1); assert.equal(g.enemies.filter(e => e.kind === 'echo').length, 0);
});
test('a projection splits; false images hurt no one, pay nothing and do not hold the room', () => {
  const g = arena(), real = put(g, 'e05', 8, 0, 9); g.update(FRAME); const fakes = g.enemies.filter(e => e.kind === 'phantom'); assert.equal(fakes.length, 2);
  fakes.forEach(f => { f.x = 1.5; f.z = 0; f.cooldown = 0; }); g.hero.invulnerable = 0; step(g, .8); assert.equal(g.hero.hp, 100, 'only a dashed outline');
  g.damage(real, 1000, 0, 0, 0, true, 'light', 0); step(g, .1); assert.equal(g.enemies.filter(e => e.kind === 'phantom').length, 0);
});
test('a stab sets off a mine from outside its ring, and walking in lights the fuse', () => {
  const g = arena(), jelly = put(g, 'e07', 7); jelly.speed = 0; g.mines.push({ id: 1, owner: jelly.id, x: 3, z: 0, life: 8, fuse: -1, camp: 'enemy' });
  g.hero.aim = { x: 1, z: 0 }; g.strike(LIGHT_CHAIN[0]); assert.equal(g.mines.length, 0); assert.equal(g.hero.hp, 100);
  g.mines.push({ id: 2, owner: jelly.id, x: 1, z: 0, life: 8, fuse: -1, camp: 'enemy' }); jelly.cooldown = 99; g.hero.invulnerable = 0; step(g, 1); assert.ok(g.hero.hp < 100); assert.ok(g.hero.slow > 0);
});
test('a thief lands where it said behind her and steals a dash charge', () => {
  const g = arena(), thief = put(g, 'e08', 7); g.hero.heading = { x: 1, z: 0 }; g.hero.dashCharges = 2; g.hero.invulnerable = 0; step(g, .75);
  assert.ok(Math.hypot(thief.x + 2, thief.z) < 1.6, 'behind her'); step(g, .9); assert.equal(g.hero.dashCharges < 2, true);
});
test('a weaver shields those near it, and its death takes the shields', () => {
  const g = arena(), weaver = put(g, 'e11', 12), guard = put(g, 'e09', 9, 0, 99); weaver.speed = guard.speed = 0; step(g, .6); assert.equal(guard.shieldHp, 30);
  g.damage(guard, 10, 0, 0, 0, false, 'trap', 0); assert.equal(guard.hp, guard.maxHp, 'the shield took it'); assert.equal(guard.shieldHp, 20);
  g.damage(weaver, 1000, 0, 0, 0, true, 'light', 0); assert.equal(guard.shieldHp, 0);
});
test('a furnace sends three rings and overheats, taking half as much again', () => {
  const g = arena(), furnace = put(g, 'e10', 4); furnace.speed = 0; step(g, .85); assert.equal(g.rings.length, 1); step(g, 1.1); assert.ok(furnace.ai.overheat > 0);
  const hp = furnace.hp; g.damage(furnace, 10, 0, 0, 0, false, 'trap', 0); assert.equal(hp - furnace.hp, 15);
});
test('a reaper cut stops the blade paying Token for three seconds', () => {
  const g = arena(), reaper = put(g, 'e12', 3); reaper.speed = 0; g.hero.invulnerable = 0; step(g, 1.05); assert.ok(g.hero.tokenLock > 0); assert.ok(g.hero.hp < 100);
});
test('the warden shows its core after each round and overloads at 60%', () => {
  const g = new Game(); g.start('1-9'); g.wave = 1; g.enemies = []; g.spawnWave(); const boss = g.enemies.find(e => e.boss)!; assert.equal(boss.kind, 'b01'); boss.arrive = 0;
  boss.hp = boss.maxHp * .5; boss.cooldown = 0; g.update(FRAME); assert.equal(boss.ai.stage, 1); assert.ok(boss.ai.invuln > 0);
  const hp = boss.hp; g.damage(boss, 50, 0, 0, 0, true, 'light', 0); assert.equal(boss.hp, hp, 'it takes nothing while it changes');
});
test('the statue ends only when its ring is broken by hand or by the fist', () => {
  const g = new Game(); g.start('3-9'); const icon = g.enemies[0]; assert.equal(icon.kind, 'b03'); assert.equal(icon.speed, 0); icon.arrive = 0;
  g.damage(icon, 100000, 0, 0, 0, true, 'light', 0); assert.equal(icon.ai.final, true); assert.ok(icon.hp > 0); assert.ok(g.prompt);
  g.hero.x = icon.x + 3; g.hero.z = icon.z + 3; g.interact(); assert.equal(icon.hp, 0); assert.equal(g.prompt, null);
});
test('NULL stands still at the middle of its room', () => {
  const g = new Game(); g.start('4-1'); g.wave = 2; g.enemies = []; g.spawnWave(); const heart = g.enemies.find(e => e.kind === 'b04')!;
  assert.deepEqual([heart.x, heart.z, heart.speed], [0, 0, 0]);
});
test('the proofreader\'s side mirrors come on at half life and fire from where they stand, until the room is clear', () => {
  const g = new Game(); g.start('2-9'); g.wave = 1; g.enemies = []; g.spawnWave(); g.hero.invulnerable = 1000; const boss = g.enemies.find(e => e.kind === 'b02')!; boss.arrive = 0;
  assert.equal(g.sideMirrors.length, 0);
  boss.hp = boss.maxHp * .4; boss.cooldown = 0; g.update(FRAME); assert.equal(g.sideMirrors.length, 2);
  for (const m of g.sideMirrors) assert.equal(g.room.walls[tileOf(g.room, m.x, m.z).r * g.room.cols + tileOf(g.room, m.x, m.z).c], 0);
  boss.ai.judge = 0; boss.ai.invuln = 0; boss.cooldown = 0; g.update(FRAME);
  for (const m of g.sideMirrors) assert.ok(g.blasts.some(b => b.x === m.x && b.z === m.z && b.delay > 0), 'lit before it fires');
  g.enemies = []; g.wave = g.plan.waves.length; step(g, 1.3); assert.equal(g.cleared, true); assert.equal(g.sideMirrors.length, 0);
});
test('NULL stops at 15% and the rally fills Token and the gauge', () => {
  const g = new Game(); g.start('4-1'); g.wave = 2; g.enemies = []; g.spawnWave(); const heart = g.enemies[0]; assert.equal(heart.kind, 'b04');
  heart.arrive = 0; g.hero.token = 0; g.hero.awaken = 0; heart.hp = heart.maxHp * .1; heart.ai.stage = 2; heart.cooldown = 0; g.update(FRAME);
  assert.equal(heart.ai.rally, true); assert.equal(g.hero.token, g.hero.tokenMax); assert.equal(g.hero.awaken, 100); assert.ok(g.prompt);
});
test('no blow is big enough to skip the rally, and it stops everything else in the room', () => {
  const g = new Game(); g.start('4-1'); g.wave = 2; g.enemies = []; g.spawnWave(); const heart = g.enemies[0]; heart.arrive = 0; const other = put(g, 'e01', 30);
  g.blasts.push({ owner: heart.id } as never); g.damage(heart, heart.hp * 2, 0, 0, 0, true, 'ult', 2);
  assert.equal(heart.ai.rally, true); assert.ok(heart.hp > 0); assert.equal(other.hp, 0); assert.equal(g.blasts.length, 0); assert.ok(g.traps.every(t => t.state === 'off' || t.kind === 'pad'));
});
test('a shield or a stabbed mine pays no Token, and a real hit does', () => {
  const blocked = arena(), guard = put(blocked, 'e02', 2, 0, 99); guard.facing = Math.PI; blocked.hero.aim = { x: 1, z: 0 }; blocked.hero.combo = 'light'; const token = blocked.hero.token;
  blocked.strike(LIGHT_CHAIN[0]); assert.equal(blocked.hero.token, token);
  const mined = arena(); mined.hero.aim = { x: 1, z: 0 }; mined.hero.combo = 'light'; mined.mines.push({ id: 1, owner: 9, x: 3, z: 0, life: 8, fuse: -1, camp: 'enemy' }); mined.strike(LIGHT_CHAIN[0]); assert.equal(mined.mines.length, 0); assert.equal(mined.hero.token, token);
  const open = arena(), worm = put(open, 'e01', 2, 0, 99); worm.speed = 0; open.hero.aim = { x: 1, z: 0 }; open.hero.combo = 'light'; open.strike(LIGHT_CHAIN[0]); assert.ok(open.hero.token > token);
});
test('the statue counts a flurry as one action, and cards as another kind', () => {
  const g = arena(), far = put(g, 'e01', 40, 0, 99); far.speed = 0; g.hero.combo = 'light'; g.hero.comboIndex = 1; g.hero.comboTimer = .3;
  g.update(FRAME, { attack: true, aimX: 1 }); g.update(FRAME, { aimX: 1 }); assert.equal(g.hero.action, 'flurry'); while (g.hero.attack) g.update(FRAME, { aimX: 1 });
  assert.deepEqual(g.actionLog, ['light']);
});
test('each of the statue\'s answers has its own shape', () => {
  const answer = (kind: string) => { const g = new Game(); g.start('3-9'); const icon = g.enemies[0]; icon.arrive = 0; icon.cooldown = 0; g.actionLog = [kind, kind, kind]; g.update(FRAME); return g.blasts.find(b => b.damage === 22)!.shape; };
  assert.deepEqual(['light', 'charge', 'card'].map(answer), ['fan', 'line', 'circle']);
});
test('the statue\'s answer to a charge reaches her, and the safe spot saves her', () => {
  const answer = (safe: boolean) => { const g = new Game(); g.start('3-9'); const icon = g.enemies[0]; icon.arrive = 0; icon.cooldown = 0; g.hero.invulnerable = 0; g.hero.x = 0; g.hero.z = 0; g.traps = []; g.actionLog = ['charge', 'charge', 'charge']; g.update(FRAME); const b = g.blasts.find(o => o.damage === 22)!; if (safe) { g.hero.x = b.safe!.x; g.hero.z = b.safe!.z; } for (let i = 0; i < 80; i++) g.update(FRAME); return g.hero.hp; };
  assert.ok(answer(false) < 100); assert.equal(answer(true), 100);
});
test('once freed, nothing but her or the fist finishes the statue', () => {
  const g = new Game(); g.start('3-9'); const icon = g.enemies[0]; icon.arrive = 0; g.damage(icon, 100000, 0, 0, 0, true, 'light', 0); assert.equal(icon.ai.final, true);
  g.damage(icon, 500, 0, 0, 0, false, 'trap', 0); assert.ok(icon.hp > 0, 'a trap does not'); assert.ok(g.prompt);
  g.hero.x = icon.x + 3; g.hero.z = icon.z + 3; g.interact(); assert.equal(icon.hp, 0);
});
test('killing a worm the warden called does not call off the warden', () => {
  const g = arena(), boss = put(g, 'b01', 6, 0, 99), add = put(g, 'e01', 3, 0, 99); boss.boss = true; add.ai.lead = add.id; boss.windup = 1; boss.ai.after = () => {}; g.blasts.push({ owner: boss.id, delay: 1 } as never);
  g.damage(add, 1000, 0, 0, 0, true, 'light', 0); assert.equal(boss.windup, 1); assert.equal(g.blasts.length, 1);
});
test('the weaver the statue calls keeps a shield on the statue', () => {
  const g = new Game(); g.start('3-9'); g.hero.invulnerable = 1000; const icon = g.enemies[0]; icon.arrive = 0; icon.cooldown = 99; const weaver = makeEnemy(g, 'e11', { x: icon.x + 2, z: icon.z + 2 }, { cooldown: 0 }); weaver.speed = 0; g.hero.x = weaver.x + 8; g.hero.z = weaver.z;
  step(g, .6); assert.equal(icon.shieldHp, 30); assert.equal(icon.shieldBy, weaver.id);
});
test('the verdict comes every 12 seconds, whatever else the statue did in between', () => {
  const g = new Game(); g.start('3-9'); g.hero.invulnerable = 1000; const icon = g.enemies[0]; icon.arrive = 0; icon.hp = icon.maxHp * .4; g.update(FRAME); assert.equal(icon.ai.stage, 1); assert.equal(icon.ai.judge, 12);
  let verdicts = 0; g.hero.hp = 100; for (let i = 0; i < 13 * 60; i++) { g.hero.invulnerable = 1000; g.update(FRAME); verdicts += g.events.filter(e => e.type === 'claudeForced').length; }
  assert.equal(verdicts, 1);
});
test('the elite crossbow draws the line it will bounce along, and it moves with the aim', () => {
  const g = arena(), bow = put(g, 'e06e', 8); bow.speed = 0; g.hero.x = 0; g.hero.z = 0; g.update(FRAME);
  const first = g.blasts.find(b => b.bent)!, leg = first.bent!; assert.ok(leg.preview); assert.ok(g.blasts.includes(leg));
  const before = { ...leg.dir }; g.hero.z = 5; step(g, .2); assert.notDeepEqual(first.dir, before);
  assert.ok(Math.abs(leg.x - (first.x + first.dir.x * first.length)) < .01);
});
test('the furnace marks its three gaps, and they land nothing', () => {
  const g = arena(), furnace = put(g, 'e10', 4); furnace.speed = 0; g.update(FRAME);
  const gaps = g.blasts.filter(b => b.style === 'gap'); assert.equal(gaps.length, 3); assert.ok(gaps.every(b => b.preview));
  const hp = g.hero.hp; step(g, .79); assert.equal(g.hero.hp, hp);
});
test('a courier and a weaver show where their shots go', () => {
  const g = arena(), courier = put(g, 'e03', 7); courier.speed = 0; g.update(FRAME); assert.equal(g.blasts.filter(b => b.preview).length, 3);
  const h = arena(), weaver = put(h, 'e11', 10); weaver.speed = 0; h.update(FRAME); assert.equal(h.blasts.filter(b => b.preview).length, 1);
});
test('a courier only backs off for so long, so it can be caught', () => {
  const g = arena(), courier = put(g, 'e03', 2, 0, 99); const chase = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) { g.hero.x = courier.x - 2; g.update(FRAME); } };
  chase(2); const stopped = courier.x; assert.ok(stopped > 4, 'it ran for a while'); chase(1); assert.equal(courier.x, stopped);
});
test('killing the lead worm calls off the pounces still to come', () => {
  const g = arena(), lead = put(g, 'e01', 3, 0, 0), next = put(g, 'e01', 3.5, 0, 0); lead.ai.team = next.ai.team = 7; lead.ai.lead = lead.id; next.ai.lead = lead.id; g.update(FRAME); assert.ok(next.windup > 0);
  g.damage(lead, 1000, 0, 0, 0, true, 'light', 0); assert.equal(next.windup, 0); assert.equal(g.blasts.filter(b => b.owner === next.id).length, 0);
});
test('with the melee slots full the rest hang back in a ring', () => {
  const g = arena(); g.levelIndex = 0; for (const x of [2, -2]) { const worker = put(g, 'e05', x, 0, 0); worker.windup = 5; worker.ai.split = true; }
  const waiting = put(g, 'e05', 0, 5, 0); waiting.ai.split = true; step(g, 1); assert.ok(Math.hypot(waiting.x, waiting.z) > 3.5, 'it stays off');
});
test('a thief stopped while landing does not go on to cut, and one in the air still lands when charmed', () => {
  const g = arena(), thief = put(g, 'e08', 7); g.hero.heading = { x: 1, z: 0 }; g.hero.invulnerable = 1000; step(g, .72); assert.equal(thief.ai.step, 1);
  g.damage(thief, 1, .3, 0, 0, true, 'light', 0); assert.equal(thief.ai.step, 0);
  const h = arena(), other = put(h, 'e08', 7); h.hero.heading = { x: 1, z: 0 }; h.update(FRAME); assert.equal(other.ai.clip, 'teleport'); other.charm = 3; const spot = h.blasts[0]; step(h, .8);
  assert.ok(Math.hypot(other.x - spot.x, other.z - spot.z) < .01, 'it landed'); step(h, 1); assert.equal(h.blasts.filter(b => b.steal).length, 0);
});
test('a mirror turns a bolt back at the enemy', () => {
  const g = arena(); g.traps = [{ id: 1, kind: 'mirror', state: 'idle', timer: 9, x: 0, z: 0, dir: { x: 0, z: 1 }, area: { x: 0, z: 0, halfX: 1, halfZ: 1 }, rail: { x: 6.75, z: .75, halfX: .75, halfZ: .75 }, feed: null, size: 1, step: 0, back: false, sweep: 0, lock: 0, hit: new Set(), used: false, plan: { kind: 'mirror' } } as never];
  const t = tileOf(g.room, 6.75, .75); g.room.walls[t.r * g.room.cols + t.c] = 3;
  const foe = put(g, 'e09', 6.75, 6, 99); foe.speed = 0; shoot(g, 3, .75, { x: 1, z: 0 }, 30, 40, 14, 'enemy', 'bolt', true); g.hero.x = -20; step(g, .5);
  assert.ok(foe.hp < foe.maxHp, 'it came back on the enemy');
});
test('a region names the art of everyone in it, and of those they bring', () => {
  const art = (name: string) => regionArt(CAMPAIGN.find(level => level.name === name)!);
  assert.ok(art('缓存废港').includes('b01') && art('缓存废港').includes('e04')); assert.ok(art('梯度熔炉').includes('e11') && art('梯度熔炉').includes('b03')); assert.ok(art('零域').includes('b04'));
  assert.ok(!art('缓存废港').includes('b04'), 'the first download stays small');
});
test('a boss comes on with its entrance and does not strike straight away', () => {
  const g = new Game(); g.start('1-9'); g.wave = 1; g.enemies = []; g.events = []; g.spawnWave(); const boss = g.enemies.find(e => e.boss)!; assert.equal(boss.ai.clip, 'enter'); assert.ok(boss.cooldown >= 1);
  assert.ok(g.events.find(e => e.type === 'wave')!.spawns.some((s: { kind: string }) => s.kind === 'b01'));
});
test('what the enemies left behind goes when the room clears', () => {
  const g = new Game(); g.start('1-2');
  g.mines.push({ id: 1, owner: 99, x: g.hero.x + 40, z: g.hero.z + 40, life: 100, fuse: -1, camp: 'enemy' });
  g.rings.push({ id: 2, owner: 99, x: g.hero.x + 40, z: g.hero.z + 40, reach: .4, max: 400, speed: .1, width: .8, gapAt: 0, gapHalf: 1, damage: 10 } as never);
  g.enemies = []; g.wave = g.plan.waves.length;
  for (let i = 0; i < 120 && !g.cleared; i++) g.update(1 / 60);
  assert.equal(g.cleared, true); assert.equal(g.mines.length, 0); assert.equal(g.rings.length, 0);
});
test('with the piercing mod the flurry passes a shield, and nothing else does', () => {
  const hit = (mods: 'pierce'[], action: string) => {
    const g = arena(), guard = put(g, 'e02', 2, 0, 99); guard.facing = Math.PI; g.hero.mods = mods; g.hero.aim = { x: 1, z: 0 };
    g.strike({ ...LIGHT_CHAIN[0], action } as typeof LIGHT_CHAIN[0]);
    return guard.maxHp - guard.hp;
  };
  assert.ok(hit(['pierce'], 'flurry') > 0); assert.equal(hit([], 'flurry'), 0); assert.equal(hit(['pierce'], 'light1'), 0);
});
test('a boss faces the side its target is on, and holds through a wind-up', () => {
  const g = arena(), boss = put(g, 'b01', 0, 0, 99); boss.boss = true; boss.speed = 0;
  const look = (x: number, z: number) => { boss.windup = 0; boss.ai.after = null; boss.ai.phase = 'move'; g.hero.x = x; g.hero.z = z; g.update(FRAME); return boss.side; };
  const left = look(-6, 6); assert.equal(look(6, -6), -left);
  boss.windup = 5; boss.ai.after = null; g.hero.x = -6; g.hero.z = 6; g.update(FRAME); assert.equal(boss.side, -left);
});
