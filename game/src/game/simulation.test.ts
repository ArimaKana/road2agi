import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Game, LIGHT_CHAIN, CHARGE, ULT, DASH_RECHARGE, FACINGS, screenToWorld, worldToScreen, facing, side, inThrust, bladeTouches, type GameInput, type Enemy } from './simulation';
import { openMap } from './room';
import { PORT_THEME, type Level } from './level';

const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60, input); };
const dummy = (g: Game, over: Partial<Enemy>): Enemy => ({ ...g.enemies[0], arrive: 0, id: over.id ?? 1, z: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, ...over });
// One empty room with three waves, the last with the boss.
const level = (): Level => ({ name: '测试', theme: PORT_THEME, rooms: [{ id: 'T', kind: 'boss', name: '测试', map: openMap(), waves: [{ count: 4, hp: 48 }, { count: 6, hp: 64 }, { count: 7, hp: 64, boss: true }] }] });
const arena = () => { const g = new Game(level()); g.start(); g.hero.x = 0; g.hero.z = 0; return g; };
// One press of the attack button: down for a frame, then up.
const tap = (g: Game, input: GameInput = {}) => { g.update(1 / 60, { ...input, attack: true }); g.update(1 / 60, input); };

test('screen-relative movement preserves all eight directional views', () => {
  ([[0, -1, 'U'], [1, -1, 'UR'], [1, 0, 'R'], [1, 1, 'DR'], [0, 1, 'D'], [-1, 1, 'DL'], [-1, 0, 'L'], [-1, -1, 'UL']] as [number, number, string][]).forEach(([x, y, name]) => {
    const p = screenToWorld(x, y); assert.equal(FACINGS[facing(p.x, p.z, (FACINGS.indexOf(name) + 4) % 8)], name);
    const q = worldToScreen(p.x, p.z); assert.ok(Math.abs(q.x - x) < 1e-8 && Math.abs(q.y - y) < 1e-8);
  });
});
test('diagonal movement is normalized', () => {
  const a = arena(), b = arena(); a.enemies = []; b.enemies = []; step(a, 1, { moveX: 1 }); step(b, 1, { moveX: 1, moveZ: 1 });
  assert.ok(Math.abs(Math.hypot(a.hero.x, a.hero.z) - Math.hypot(b.hero.x, b.hero.z)) < .001);
});
test('a thrust damages once, in front, and does not hit behind', () => {
  const g = arena(); g.enemies = [dummy(g, { id: 1, x: 2 }), dummy(g, { id: 2, x: -2 })];
  tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 }); assert.equal(g.enemies[0].hp, 1000 - LIGHT_CHAIN[0].damage); assert.equal(g.enemies[1].hp, 1000);
});
test('the first two hits share one clip and the third is the flurry, then the chain wraps', () => {
  assert.equal(LIGHT_CHAIN[0].action, LIGHT_CHAIN[1].action); assert.equal(LIGHT_CHAIN[2].action, 'flurry');
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; const seen: number[] = [];
  for (let press = 0; press < 4; press++) { tap(g, { aimX: 1 }); seen.push(g.hero.attackIndex); while (g.hero.attackAge < g.hero.attack!.cancelAt) g.update(1 / 60, { aimX: 1 }); }
  assert.deepEqual(seen, [0, 1, 2, 0]);
});
test('the flurry lands all four thrusts, the last one hardest', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 2 })]; g.hero.combo = 'light'; g.hero.comboIndex = 1; g.hero.comboTimer = .3;
  tap(g, { aimX: 1 }); assert.equal(g.hero.action, 'flurry'); const strikes: number[] = [];
  while (g.hero.attack) { g.update(1 / 60, { aimX: 1 }); for (const e of g.events) if (e.type === 'hit') strikes.push(e.damage); }
  assert.deepEqual(strikes, [5, 5, 5, 7]); assert.equal(g.enemies[0].hp, 1000 - 22);
});
test('the chain resets once the combo window has passed', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; tap(g, { aimX: 1 }); while (g.hero.attack) g.update(1 / 60, {});
  step(g, .6); tap(g, { aimX: 1 }); assert.equal(g.hero.attackIndex, 0);
});
test('attacks carry the hero forward by the distance the clip travels and hit-stop freezes time', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; tap(g, { aimX: 1 }); const a = g.hero.attack!; while (g.hero.attack) g.update(1 / 60, {});
  assert.ok(Math.abs(g.hero.x - a.travel) < .01);
  const h = arena(); h.enemies = [dummy(h, { x: 2 })]; tap(h, { aimX: 1 }); while (!h.hero.attackHit) h.update(1 / 60, {});
  assert.ok(h.hitstop > 0); const age = h.hero.attackAge; h.update(1 / 120, {}); assert.equal(h.hero.attackAge, age);
});
test('a dash may cancel a recovery but not a wind-up', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; tap(g, { aimX: 1 }); g.update(1 / 60, { dash: true }); assert.equal(g.hero.action, 'light1');
  while (!g.hero.attackHit) g.update(1 / 60, {}); g.update(1 / 60, { dash: true }); assert.equal(g.hero.dash > 0, true); assert.equal(g.hero.action, 'dash'); assert.equal(g.hero.attack, null);
});
test('a tap is a light hit; holding runs a light hit into the charge', () => {
  const t = arena(); t.enemies = [dummy(t, { x: 30 })]; tap(t, { aimX: 1 }); step(t, 1, { aimX: 1 }); assert.equal(t.hero.charge, null); assert.notEqual(t.hero.action, 'charge_start');
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; const held = { attack: true, aimX: 1 };
  g.update(1 / 60, held); assert.equal(g.hero.action, 'light1'); assert.equal(g.hero.charge, null);
  step(g, CHARGE.holdAfter - .1, held); assert.equal(g.hero.charge, null);
  step(g, .15, held); assert.notEqual(g.hero.charge, null); assert.equal(g.hero.action, 'charge_start');
  step(g, CHARGE.windup + .02, held); assert.equal(g.hero.action, 'charge_hold');
});
test('letting go releases the charge, and a longer hold hits harder and further', () => {
  const release = (held: number) => {
    const g = arena(); g.enemies = [dummy(g, { x: 3 })]; const input = { attack: true, aimX: 1 };
    while (g.hero.charge === null) g.update(1 / 60, input);
    g.enemies[0].hp = 1000; // The light hit that opened the hold has landed by now.
    step(g, held, input); g.update(1 / 60, { aimX: 1 }); assert.equal(g.hero.action, 'charge_release'); assert.equal(g.hero.combo, 'charge');
    const reach = g.hero.attack!.range; while (g.hero.attack) g.update(1 / 60, { aimX: 1 });
    return { damage: 1000 - g.enemies[0].hp, reach };
  };
  const quick = release(.05), long = release(.7);
  assert.ok(long.damage > quick.damage && quick.damage >= CHARGE.weak.damage && long.damage <= CHARGE.strong.damage); assert.ok(long.reach > quick.reach);
});
test('a full charge releases automatically and a continued hold starts another', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; const input = { attack: true, aimX: 1 };
  while (g.hero.charge === null) g.update(1 / 60, input);
  step(g, CHARGE.full + .05, input); assert.equal(g.hero.action, 'charge_release'); assert.equal(g.hero.attack!.damage, CHARGE.strong.damage);
  while (g.hero.attack) g.update(1 / 60, input);
  assert.notEqual(g.hero.charge, null);
  g.update(1 / 60, { aimX: 1 }); assert.equal(g.hero.action, 'charge_release');
  step(g, 1); assert.equal(g.hero.charge, null); assert.equal(g.hero.action, 'idle');
  g.update(1 / 60, input); assert.equal(g.hero.action, 'light1');
});
test('the hero can walk slowly and track the aim while charging, and dash cancels it', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; const r = screenToWorld(1, 0), l = screenToWorld(-1, 0), input = { attack: true, aimX: r.x, aimZ: r.z };
  while (g.hero.charge === null) g.update(1 / 60, input);
  const x = g.hero.x; step(g, .2, { ...input, moveX: 1 }); assert.ok(g.hero.x - x > .2 && g.hero.x - x < .5); assert.equal(FACINGS[g.hero.direction], 'R');
  step(g, .1, { attack: true, aimX: l.x, aimZ: l.z }); assert.equal(FACINGS[g.hero.direction], 'L');
  g.update(1 / 60, { attack: true, dash: true, moveX: 1 }); assert.equal(g.hero.charge, null); assert.equal(g.hero.action, 'dash');
});

test('a slightly longer tap does not accidentally enter charge', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })];
  step(g, .32, { attack: true, aimX: 1 }); assert.equal(g.hero.charge, null);
  const token = g.hero.token; step(g, 1); assert.equal(g.hero.token, token); assert.equal(g.hero.action, 'idle');
});

test('a held attack falls back to light attacks when Token is low, with one denial per hold', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; g.hero.token = 0;
  let lights = 0, denied = 0;
  for (let i = 0; i < 180; i++) {
    g.update(1 / 60, { attack: true, aimX: 1 });
    for (const e of g.events) { if (e.type === 'attack' && e.kind === 'light') lights++; if (e.type === 'tokenDenied') denied++; }
    assert.equal(g.hero.charge, null);
  }
  assert.ok(lights >= 4); assert.equal(denied, 1);
  step(g, 2); assert.equal(g.hero.action, 'idle');
});

test('releasing a manual charge keeps its last direction when the live aim disappears', () => {
  const g = arena(); g.enemies = [dummy(g, { x: -3 })];
  const input = { attack: true, aimX: 1 };
  while (g.hero.charge === null) g.update(1 / 60, input);
  const aim = { ...g.hero.aim }; g.update(1 / 60);
  assert.equal(g.hero.action, 'charge_release'); assert.deepEqual(g.hero.travelAim, aim); assert.ok(aim.x > 0);
});
test('a run starts with an empty gauge and earns the ultimate', () => {
  const g = arena(); assert.equal(g.hero.awaken, 0); g.enemies = [dummy(g, { x: 2 })];
  g.update(1 / 60, { ult: true }); assert.equal(g.hero.ult, false);
  const r = arena(); r.enemies = [dummy(r, { x: 3, hp: 100000, maxHp: 100000 })];
  for (let i = 0; i < 120 * 60 && r.hero.awaken < ULT.cost; i++) { r.update(1 / 60, { attack: i % 12 === 0, aimX: 1 }); r.enemies[0].x = 3; r.hero.x = 0; }
  assert.equal(r.hero.awaken, ULT.cost);
});
test('awakening fills per B, is capped per second and pays for the fist', () => {
  const g = arena(); g.hero.awaken = 0; g.enemies = [dummy(g, { x: 2 })]; tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 }); assert.ok(g.hero.awaken > 0);
  const paid = g.hero.awaken; g.hero.awakenBudget = 0; g.gainAwaken(50); assert.equal(g.hero.awakenBudget, 0); assert.equal(g.hero.awaken, paid);
  const u = arena(); u.hero.awaken = 100; u.enemies = [dummy(u, { id: 1, x: 2 }), dummy(u, { id: 2, x: 3 })]; u.update(1 / 60, { ult: true }); assert.equal(u.hero.action, 'cast'); assert.equal(u.hero.awaken, 100);
  step(u, ULT.confirmAt + .05); assert.equal(u.hero.awaken, 0); while (u.hero.ult) u.update(1 / 60, {});
  assert.equal(u.enemies[0].hp, 1000 - ULT.damage - ULT.shockDamage); assert.equal(u.hero.awaken, 0);
});
test('the fist has no direction: it lands on the thickest crowd whatever the aim, and hits inner then outer', () => {
  const g = arena(); g.hero.awaken = ULT.cost; g.enemies = [dummy(g, { id: 1, x: -2 }), dummy(g, { id: 2, x: 7, z: 7 }), dummy(g, { id: 3, x: 7.5, z: 6 }), dummy(g, { id: 4, x: 6, z: 7.5 })];
  const facedBefore = g.hero.direction; g.update(1 / 60, { ult: true, aimX: -1 }); assert.equal(g.hero.direction, facedBefore);
  const seen: Record<string, any> = {}; while (g.hero.ult) { g.update(1 / 60, {}); for (const e of g.events) seen[e.type] ??= e; }
  assert.ok(seen.ultConfirm && seen.ultAvatar && seen.ultFist && seen.ultPunch && seen.ultShock);
  assert.deepEqual([seen.ultPunch.x, seen.ultPunch.z], [seen.ultConfirm.x, seen.ultConfirm.z]); assert.ok(seen.ultPunch.x > 5 && seen.ultPunch.z > 5);
  assert.equal(g.enemies[0].hp, 1000); assert.equal(g.enemies[1].hp, 1000 - ULT.damage - ULT.shockDamage);
  const empty = arena(); empty.hero.awaken = ULT.cost; empty.enemies = []; empty.hero.heading = { x: 1, z: 0 }; empty.update(1 / 60, { ult: true }); let landed: any; while (empty.hero.ult) { empty.update(1 / 60, {}); landed ??= empty.events.find(e => e.type === 'ultPunch'); }
  assert.deepEqual([landed.x, landed.z], [4, 0]);
});
test('the ultimate plays in order: the avatar comes and goes before the fist leaves, and the fist lands after that', () => {
  const g = arena(); g.hero.awaken = ULT.cost; g.enemies = [dummy(g, { x: 3 })]; g.update(1 / 60, { ult: true }); const order: string[] = [];
  while (g.hero.ult) { g.update(1 / 60, {}); for (const e of g.events) if (e.type.startsWith('ult')) order.push(e.type); }
  assert.deepEqual(order, ['ultConfirm', 'ultAvatar', 'ultAvatarOut', 'ultFist', 'ultPunch', 'ultShock']);
  assert.ok(ULT.fistAt - ULT.avatarOutAt >= .24); // Long enough for the avatar to have slid off the screen.
});
test('the ultimate needs a full gauge and the boss is not moved by it', () => {
  const g = arena(); g.hero.awaken = 99; g.enemies = [dummy(g, { x: 5 })]; g.update(1 / 60, { ult: true }); assert.equal(g.hero.ult, false);
  const b = arena(); b.hero.awaken = 100; b.enemies = [dummy(b, { x: 5, boss: true })]; b.update(1 / 60, { ult: true }); while (b.hero.ult) b.update(1 / 60, {}); assert.equal(b.enemies[0].x, 5); assert.equal(b.enemies[0].hp, 1000 - ULT.damage - ULT.shockDamage);
});
test('a dash covers about 4.5 units plus a short glide, and a second of running 6.5', () => {
  const g = arena(); g.enemies = []; g.update(1 / 60, { dash: true, moveX: 1 }); step(g, .3); assert.ok(g.hero.x > 4.4 && g.hero.x < 5.1, `dash went ${g.hero.x}`);
  const r = arena(); r.enemies = []; step(r, 1, { moveX: 1 }); assert.ok(r.hero.x > 6 && r.hero.x < 6.5, `ran ${r.hero.x}`);
});
test('dash grants invulnerability, has two charges and cannot bypass the recharge', () => {
  const g = arena(); g.enemies = [{ ...g.enemies[0], x: 0, z: 0, windup: .01, attackX: 0, attackZ: 0 }];
  g.update(1 / 60, { dash: true, moveX: 1 }); assert.equal(g.hero.hp, 100); assert.equal(g.hero.dashCharges, 1);
  step(g, .3); assert.equal(g.hero.dash, 0); g.update(1 / 60, { dash: true, moveX: 1 }); assert.ok(g.hero.dash > 0); assert.equal(g.hero.dashCharges, 0);
  step(g, .3); assert.equal(g.hero.dash, 0); g.update(1 / 60, { dash: true, moveX: 1 }); assert.equal(g.hero.dash, 0);
  step(g, DASH_RECHARGE); assert.ok(g.hero.dashCharges >= 1); g.hero.dashBuffer = 0; g.update(1 / 60, { dash: true, moveX: 1 }); assert.ok(g.hero.dash > 0);
});
test('moving faces the movement, not the aim; attacking turns to the aim; standing still keeps the facing', () => {
  const g = arena(); g.enemies = []; const left = screenToWorld(-1, -1), right = screenToWorld(1, 1);
  step(g, .1, { moveX: left.x, moveZ: left.z, aimX: right.x, aimZ: right.z }); assert.equal(FACINGS[g.hero.direction], 'UL');
  g.update(1 / 60, { attack: true, aimX: right.x, aimZ: right.z }); assert.equal(FACINGS[g.hero.direction], 'DR'); assert.equal(g.hero.action, 'light1');
  while (g.hero.attack) g.update(1 / 60, { aimX: left.x, aimZ: left.z }); step(g, .2, { aimX: left.x, aimZ: left.z }); assert.equal(FACINGS[g.hero.direction], 'DR');
});
test('a heading on the edge of two facings keeps the one it had and does not flicker', () => {
  const at = (degrees: number): [number, number] => { const a = degrees * Math.PI / 180, p = screenToWorld(Math.sin(a), -Math.cos(a)); return [p.x, p.z]; }, R = FACINGS.indexOf('R'), DR = FACINGS.indexOf('DR'), U = FACINGS.indexOf('U'), UL = FACINGS.indexOf('UL');
  assert.equal(facing(...at(112.5), R), R); assert.equal(facing(...at(112.5), DR), DR); assert.equal(facing(...at(112.5 + 6), R), R); assert.equal(facing(...at(112.5 - 6), DR), DR);
  assert.equal(facing(...at(112.5 + 12), R), DR); assert.equal(facing(...at(112.5 - 12), DR), R);
  // Across the wrap from the last facing to the first, the same holds.
  assert.equal(facing(...at(-22.5 + 6), UL), UL); assert.equal(facing(...at(-22.5 - 6), U), U); assert.equal(facing(...at(-22.5 + 12), UL), U);
  assert.equal(facing(0, 0, 5), 5);
});
test('ordinary enemies face left or right, the boss faces eight ways, and a wind-up is committed', () => {
  const l = screenToWorld(-1, 0), r = screenToWorld(1, 0), up = screenToWorld(0, -1), leftAndDown = screenToWorld(-1, 1);
  assert.equal(side(l.x, l.z), -1); assert.equal(side(r.x, r.z), 1); assert.equal(side(leftAndDown.x, leftAndDown.z), -1);
  assert.equal(side(up.x, up.z, -1), -1); assert.equal(side(up.x, up.z, 1), 1); assert.equal(side(0, 0, -1), -1);
  const g = arena(), p = screenToWorld(4, 0); g.enemies = [dummy(g, { x: p.x, z: p.z, cooldown: 100 })];
  g.update(1 / 60, {}); assert.equal(g.enemies[0].side, -1); assert.equal(FACINGS[g.enemies[0].direction], 'L'); // On the right of the hero, it looks left at her.
  const q = screenToWorld(-4, 0); g.enemies[0].x = q.x; g.enemies[0].z = q.z; g.update(1 / 60, {}); assert.equal(g.enemies[0].side, 1); assert.equal(FACINGS[g.enemies[0].direction], 'R');
  g.enemies[0].windup = .5; g.enemies[0].x = p.x; g.enemies[0].z = p.z; g.update(1 / 60, {}); assert.equal(g.enemies[0].side, 1);
});
test('releasing the button stops the chain, a press during a hit still queues the next one', () => {
  const thrust = arena(); thrust.enemies = [dummy(thrust, { x: 30 })]; thrust.update(1 / 60, { dash: true, moveX: 1 }); step(thrust, .2); tap(thrust, { aimX: 1 }); step(thrust, .1, { aimX: 1 }); assert.equal(thrust.hero.action, 'dash_attack');
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; tap(g, { aimX: 1 }); step(g, 1); assert.equal(g.hero.action, 'idle'); assert.equal(g.hero.comboIndex, 0);
  const q = arena(); q.enemies = [dummy(q, { x: 30 })]; tap(q, { aimX: 1 }); step(q, .05); tap(q, { aimX: 1 }); step(q, .25); assert.equal(q.hero.comboIndex, 1);
});
test('the recovery gives way to the next hit and to running, never the wind-up', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })]; tap(g, { aimX: 1 }); const a = g.hero.attack!;
  step(g, a.hitAt * .8, { moveX: 1 }); assert.equal(g.hero.attack, a);
  while (g.hero.attackAge < a.cancelAt - 1 / 60) g.update(1 / 60, {}); assert.equal(g.hero.attack, a);
  step(g, 2 / 60, { moveX: 1 }); assert.equal(g.hero.attack, null); assert.equal(g.hero.action, 'run');
  const c = arena(); c.enemies = [dummy(c, { x: 30 })]; tap(c, { aimX: 1 }); const b = c.hero.attack!;
  while (c.hero.attackAge < b.cancelAt) c.update(1 / 60, {}); tap(c, { aimX: 1 }); assert.equal(c.hero.comboIndex, 1); assert.ok(c.hero.age < b.duration);
});
test('the ultimate is buffered through an attack and cancels its recovery', () => {
  const g = arena(); g.hero.awaken = ULT.cost; g.enemies = [dummy(g, { x: 2 })]; tap(g, { aimX: 1 }); g.update(1 / 60, { ult: true }); assert.equal(g.hero.ult, false);
  for (let i = 0; i < 60 && !g.hero.ult; i++) g.update(1 / 60, {}); assert.equal(g.hero.ult, true); assert.equal(g.hero.attack, null);
});

test('an early tap during the flurry queues one light after all four thrusts', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })];
  Object.assign(g.hero, { combo: 'light', comboIndex: 1, comboTimer: .3 });
  tap(g, { aimX: 1 });
  const attacks: number[] = [], strikes: number[] = [];
  for (let frame = 2; frame < 150; frame++) {
    g.update(1 / 60, { aimX: 1, attack: [12, 18, 24].includes(frame) });
    for (const e of g.events) {
      if (e.type === 'attack') attacks.push(e.index);
      if (e.type === 'strike' && e.index === 2) strikes.push(e.tier);
    }
  }
  assert.deepEqual(strikes, [0, 0, 0, 1]);
  assert.deepEqual(attacks, [0], 'multiple early taps keep one next attack, not a backlog');
});

test('moving leaves a flurry after 250ms and clears its queued follow-up', () => {
  const g = arena(); g.enemies = [dummy(g, { x: 30 })];
  Object.assign(g.hero, { combo: 'light', comboIndex: 1, comboTimer: .3 });
  tap(g, { aimX: 1 }); step(g, .1); tap(g, { aimX: 1 });
  assert.equal(g.hero.action, 'flurry');
  step(g, .2, { moveZ: 1 });
  assert.equal(g.hero.attack, null); assert.ok(g.hero.z > 0);
  step(g, 1); assert.equal(g.hero.attack, null); assert.equal(g.hero.comboIndex, 2);
});

test('a card or ultimate pressed early in a flurry can interrupt it', () => {
  for (const action of ['card', 'ult']) {
    const g = arena(); g.enemies = [dummy(g, { x: 2 })];
    Object.assign(g.hero, { combo: 'light', comboIndex: 1, comboTimer: .3, awaken: ULT.cost, token: 100 });
    g.hero.cards = [{ id: 'qwen', cooldown: 0, level: 1, branch: null, boost: 0 }];
    tap(g, { aimX: 1 }); step(g, .16);
    g.update(1 / 60, action === 'card' ? { card: 0 } : { ult: true });
    const seen: string[] = g.events.map(e => e.type);
    for (let n = 0; n < 18; n++) { g.update(1 / 60); seen.push(...g.events.map(e => e.type)); }
    assert.ok(seen.includes(action === 'card' ? 'summonStart' : 'ultStart'), action);
    assert.equal(g.hero.attack, null);
  }
});
test('the fist adds its stagger to a boss', () => {
  const g = arena(); g.hero.awaken = ULT.cost; g.enemies = [dummy(g, { x: 5, boss: true })]; g.update(1 / 60, { ult: true }); while (g.hero.ult) g.update(1 / 60, {});
  assert.equal(g.enemies[0].stagger, ULT.bossStagger);
});
test('what has just come out of the wall can be neither hit nor locked on to, and does nothing yet', () => {
  const g = new Game(level()); g.start(); const e = g.enemies[0]; assert.ok(e.arrive > 0);
  const hp = e.hp; g.damage(e, 10, 0, 0, 0, true, 'light', 0); assert.equal(e.hp, hp);
  e.x = 1; e.z = 0; g.hero.x = 0; g.hero.z = 0; g.lockOn({ x: 1, z: 0 }, null); assert.equal(g.hero.lockId, null);
  step(g, .7); g.damage(e, 10, 0, 0, 0, true, 'light', 0); assert.equal(e.hp, hp - 10);
});
test('an elite kill pays its whole bonus to the gauge, past the limit per second', () => {
  const g = arena(); g.hero.awakenBudget = 0; g.enemies = [dummy(g, { x: 2, hp: 1, elite: true }), dummy(g, { id: 2, x: 30 })];
  g.damage(g.enemies[0], 5, 0, 0, 0, true, 'light', 0); assert.equal(g.hero.awaken, 10);
});
test('a dash is only remembered once it has finished', () => {
  const g = arena(); g.enemies = []; const before = { ...g.hero.lastDash }; g.update(1 / 60, { dash: true, moveX: -1 });
  assert.deepEqual(g.hero.lastDash, before); step(g, .4); assert.ok(g.hero.lastDash.x < 0);
});
test('an empty gauge refuses the ultimate out loud', () => {
  const g = arena(); g.hero.awaken = 10; g.update(1 / 60, { ult: true }); assert.ok(g.events.some(e => e.type === 'ultDenied')); assert.equal(g.hero.ult, false);
});
test('manual attacks keep their aim, while automatic attacks seek the nearest enemy', () => {
  const g = arena(); g.enemies = [dummy(g, { id: 1, x: 3, z: 1 }), dummy(g, { id: 2, x: -1, z: -5 })];
  g.update(1 / 60, { attack: true, aimX: 1 }); assert.equal(g.hero.lockId, null); assert.deepEqual(g.hero.travelAim, { x: 1, z: 0 });
  const n = arena(); n.enemies = [dummy(n, { id: 1, x: -4, z: 0 }), dummy(n, { id: 2, x: 0, z: 6 })]; n.update(1 / 60, { attack: true }); assert.deepEqual(n.hero.travelAim, { x: -1, z: 0 });
  const w = arena(); w.enemies = [dummy(w, { id: 1, x: -3, z: 0 })]; w.update(1 / 60, { attack: true, aimX: 1 }); assert.equal(w.hero.lockId, null); assert.deepEqual(w.hero.travelAim, { x: 1, z: 0 });
});

test('closer off-axis enemies cannot pull an explicitly aimed attack away', () => {
  const g = arena(); g.enemies = [dummy(g, { id: 1, x: 5 }), dummy(g, { id: 2, x: 2, z: .7 })];
  g.update(1 / 60, { attack: true, aimX: 1, aimTargetId: 1 });
  assert.equal(g.hero.lockId, 1); assert.deepEqual(g.hero.travelAim, { x: 1, z: 0 });
  const exact = arena(); exact.enemies = [dummy(exact, { id: 1, x: 5 }), dummy(exact, { id: 2, x: 3 })];
  exact.update(1 / 60, { aimX: 1, aimTargetId: 1 }); assert.equal(exact.hero.lockId, 1);
  const off = arena(); off.enemies = [dummy(off, { x: 3, z: .15 })];
  off.update(1 / 60, { attack: true, aimX: 1 }); assert.deepEqual(off.hero.travelAim, { x: 1, z: 0 });
});

test('automatic aim resists small distance changes but releases invalid or distant targets', () => {
  const g = arena(); g.enemies = [dummy(g, { id: 1, x: 3 }), dummy(g, { id: 2, x: 3.2, z: .2 })];
  g.lockOn(null, null); assert.equal(g.hero.lockId, 1);
  g.enemies[0].x = 3.2; g.enemies[1].x = 3;
  g.lockOn(null, null); assert.equal(g.hero.lockId, 1);
  g.enemies[1].x = 1.8; g.lockOn(null, null); assert.equal(g.hero.lockId, 2);
  g.enemies[1].allied = 2; g.lockOn(null, null); assert.equal(g.hero.lockId, 1);
  g.enemies[0].x = 8; g.lockOn(null, null); assert.equal(g.hero.lockId, null);
});

test('changing movement direction overrides automatic target stickiness', () => {
  const g = arena(); g.enemies = [dummy(g, { id: 1, x: 2 }), dummy(g, { id: 2, x: -4 })];
  g.lockOn(null, { x: 1, z: 0 }); assert.equal(g.hero.lockId, 1);
  assert.deepEqual(g.lockOn(null, { x: -1, z: 0 }), { x: -1, z: 0 }); assert.equal(g.hero.lockId, 2);
});

test('range hints distinguish a distant selection and account for charge range and lunges', () => {
  for (const x of [3, 4.5, 6.5]) {
    const g = arena(); const enemy = dummy(g, { x }); g.enemies = [enemy];
    g.update(1 / 60, { aimX: 1 }); assert.equal(g.hero.lockId, enemy.id);
    const predicted = g.targetInRange(enemy);
    tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 });
    assert.equal(predicted, enemy.hp < 1000, `light range at ${x}`);
    if (x === 6.5) {
      assert.equal(predicted, false);
      Object.assign(g.hero, { x: 0, z: 0, attack: null, charge: CHARGE.full });
      assert.equal(g.targetInRange(enemy), true);
    }
  }
});
test('knockback pushes over time, solid hits interrupt a wind-up, the boss holds its ground', () => {
  const chargeInto = (over: Partial<Enemy>) => {
    const g = arena(); g.enemies = [dummy(g, { x: 2, ...over })]; const input = { attack: true, aimX: 1 };
    while (g.hero.charge === null) { g.update(1 / 60, input); g.enemies[0].windup = over.windup ?? 0; g.enemies[0].x = 2; g.enemies[0].hp = 1000; }
    g.enemies[0].windup = .5; g.update(1 / 60, { aimX: 1 }); while (!g.hero.attackHit) g.update(1 / 60, { aimX: 1 });
    return g;
  };
  const g = chargeInto({ attackX: 2, attackZ: 0 }), x = g.enemies[0].x; assert.equal(g.enemies[0].windup, 0); assert.ok(g.enemies[0].vx > 0); step(g, .5, { aimX: 1 }); assert.ok(g.enemies[0].x > x + .5);
  const b = chargeInto({ boss: true, attackX: 2, attackZ: 0 }); assert.equal(b.enemies[0].x, 2); assert.ok(b.enemies[0].windup > 0);
});
test('killing the last enemy slows time and the win waits for the moment to land', () => {
  const g = arena(); g.wave = 3; g.enemies = [dummy(g, { hp: 1, x: 2 })]; tap(g, { aimX: 1 }); while (g.enemies.length) g.update(1 / 60, {});
  assert.ok(g.slowmo > 0); assert.equal(g.state, 'playing'); step(g, 4); assert.equal(g.state, 'won');
});
test('pause freezes gameplay; restart restores the initial room', () => {
  const g = new Game(level()); g.start(); g.hero.hp = 28; g.kills = 4; g.pause(); const x = g.hero.x; step(g, 2, { moveX: 1, attack: true }); assert.equal(g.hero.x, x); assert.equal(g.time, 0);
  g.resume(); step(g, .1, { moveX: 1 }); assert.ok(g.hero.x > x); g.start(); assert.equal(g.hero.hp, 100); assert.equal(g.kills, 0); assert.equal(g.wave, 1); assert.equal(g.enemies.length, 4);
});
test('three cleared waves end in a win and death stops further waves', () => {
  const g = new Game(level()); g.start(); g.enemies = []; step(g, 2.1); assert.equal(g.wave, 2); g.enemies = []; step(g, 2.1); assert.equal(g.wave, 3); assert.ok(g.enemies.some(e => e.boss)); g.enemies = []; step(g, 1.2); assert.equal(g.state, 'won');
  g.start(); g.hero.hp = 0; g.update(.01); assert.equal(g.state, 'lost');
});
test('thrust width rejects off-axis enemies', () => { assert.equal(inThrust({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 3, radius: .4 }), false); });
test('a blade counts against the picture on screen, not only the circle at its feet', () => {
  const body = { width: 1.2, tall: 1.8, foot: .1 }, right = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }, up = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  const at = (along: number, toward: number) => ({ x: right.x * along + up.x * toward, z: right.z * along + up.z * toward, ...body });
  // A thrust to the right of the screen, and someone standing off its line toward or away from the camera.
  assert.ok(bladeTouches({ x: 0, z: 0 }, right, at(2, 0), 3.9, .2), 'straight ahead');
  assert.ok(bladeTouches({ x: 0, z: 0 }, right, at(2, 1.4), 3.9, .2), 'its feet are crossed, further from the camera');
  assert.ok(bladeTouches({ x: 0, z: 0 }, right, at(2, -1.3), 3.9, .2), 'its head is crossed, nearer the camera');
  assert.ok(!bladeTouches({ x: 0, z: 0 }, right, at(2, 2.4), 3.9, .2), 'well above the blade');
  assert.ok(!bladeTouches({ x: 0, z: 0 }, right, at(2, -2.4), 3.9, .2), 'well below the blade');
  assert.ok(!bladeTouches({ x: 0, z: 0 }, right, at(5.2, 0), 3.9, .2), 'past the tip');
  assert.ok(!bladeTouches({ x: 0, z: 0 }, right, at(-2, 0), 3.9, .2), 'behind her');
  assert.ok(bladeTouches({ x: 0, z: 0 }, up, at(.3, 1), 3.9, .2), 'a thrust up the screen');
  assert.ok(!bladeTouches({ x: 0, z: 0 }, up, at(1.5, 1), 3.9, .2), 'beside a thrust up the screen');
});
test('a strike lands on what is drawn: off the floor line, on a big boss, and from inside one', () => {
  const hitAt = (over: Partial<Enemy>, aim = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }) => {
    const g = arena(); g.enemies = [dummy(g, { x: 30 })]; const e = dummy(g, { id: 77, hp: 1000, maxHp: 1000, ...over }); g.enemies.push(e);
    g.hero.x = 0; g.hero.z = 0; g.hero.aim = aim; g.hero.combo = 'light'; g.strike(LIGHT_CHAIN[0]); return e.hp < 1000;
  };
  const off = (along: number, toward: number) => ({ x: Math.SQRT1_2 * along - Math.SQRT1_2 * toward, z: -Math.SQRT1_2 * along - Math.SQRT1_2 * toward });
  assert.ok(hitAt({ kind: 'e05', ...off(2, 1.3) }), 'feet just above the blade');
  assert.ok(hitAt({ kind: 'e05', ...off(2, -1.3) }), 'head just below the blade');
  assert.ok(!hitAt({ kind: 'e05', ...off(2, 3) }), 'too far off');
  assert.ok(hitAt({ kind: 'b01', boss: true, radius: .8, ...off(3, 1.5) }), 'the edge of a big boss');
  assert.ok(hitAt({ kind: 'b01', boss: true, radius: .8, x: -.5, z: .5 }), 'standing inside it');
});
