import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FLOOR, MACHINE, TILE, WALL, distanceField, inArea, inDoor, isWall, lineClear, openDoor, openMap, openRoom, parseRoom, railTiles, setTiles, slide, slotOn, stepToward, tileCenter, tileOf, wallAtTile, type Room } from './room';
import { nearestOpen } from './room';
import { CACHE_PORT, CAMPAIGN, PORT_THEME, type Level, type TrapPlan, type Wave } from './level';
import { BELT, DIRS, ERASE, Game, LIGHT_CHAIN, MIRROR, PRESS, SCAN, SHELF, STAMPER, ULT, VALVE, VENT, warnTime, type Enemy, type GameInput } from './simulation';

const ROOMS = CAMPAIGN.flatMap(level => level.rooms);

const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60, input); };
const dummy = (g: Game, over: Partial<Enemy>): Enemy => ({ ...g.enemies[0], arrive: 0, id: 1, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, windup: 0, stun: 0, ...over });
// Takes the first thing on offer, through to the end if it asks which branch.
const settle = (g: Game) => { if (g.state === 'dialog') g.chooseStory(0); if (g.state === 'shop') g.closeShop(); while (g.state === 'reward') g.chooseReward(0); if (g.state === 'prep') g.confirmPrep(); };
const floors = (m: Room) => { const all: number[] = []; for (let i = 0; i < m.walls.length; i++) if (m.walls[i] === FLOOR) all.push(i); return all; };
const solo = (map: string[], traps: Record<string, TrapPlan> = {}, waves: Wave[] = [{ count: 1, hp: 1000 }]): Level => ({ name: '测试', theme: PORT_THEME, rooms: [{ id: 'T', kind: 'battle', name: '测试', map, traps, waves }] });
// Game with one trap and one still dummy enemy far from everything, so the room stays uncleared.
const withTrap = (map: string[], traps: Record<string, TrapPlan>) => {
  const g = new Game(solo(map, traps)); g.start(); g.enemies = [dummy(g, { x: 0, z: 0, radius: .42 })]; return g;
};
const OPEN_21 = openMap(14);
const placed = (mark: string, c0: number, r0: number, c1: number, r1: number) => OPEN_21.map((line, r) => [...line].map((ch, c) => c >= c0 && c <= c1 && r >= r0 && r <= r1 ? mark : ch).join(''));

test('the run goes through the four regions and all 28 rooms in the order of the design doc', () => {
  assert.deepEqual(CAMPAIGN.map(level => level.name), ['缓存废港', '镜像书库', '梯度熔炉', '零域']);
  const region = (n: number) => Array.from({ length: 9 }, (_, i) => `${n}-${i + 1}`);
  assert.deepEqual(ROOMS.map(r => r.id), [...region(1), ...region(2), ...region(3), '4-1']);
  for (const level of CAMPAIGN.slice(0, 3)) assert.deepEqual(level.rooms.map(r => r.kind), ['battle', 'battle', 'battle', 'event', 'battle', 'battle', 'battle', 'shop', 'boss']);
  assert.equal(ROOMS[27].kind, 'finale');
});
test('every room is a walled box with a way in and, until the last, a way out, and the whole floor connects', () => {
  ROOMS.forEach((plan, index) => {
    const widths = new Set(plan.map.map(line => line.length)); assert.equal(widths.size, 1, `${plan.id}: rows differ in width`);
    const m = parseRoom(plan.map), last = index === ROOMS.length - 1;
    assert.ok(m.entrance, `${plan.id}: no door in`); assert.equal(!!m.exit, !last, `${plan.id}: door out`);
    // Spec: doors four wide, the way in on a near wall and the way out on a far one.
    assert.equal(m.entrance!.span, 4, `${plan.id}: door in`); assert.ok(m.entrance!.inward.x < 0 || m.entrance!.inward.z < 0, `${plan.id}: door in is not on a near wall`);
    if (m.exit) { assert.equal(m.exit.span, 4, `${plan.id}: door out`); assert.ok(m.exit.inward.x > 0 || m.exit.inward.z > 0, `${plan.id}: door out is not on a far wall`); }
    for (let c = 0; c < m.cols; c++) { assert.ok(wallAtTile(m, c, 0)); assert.ok(wallAtTile(m, c, m.rows - 1)); }
    for (let r = 0; r < m.rows; r++) { assert.ok(wallAtTile(m, 0, r)); assert.ok(wallAtTile(m, m.cols - 1, r)); }
    assert.equal(isWall(m, m.start.x, m.start.z), false, `${plan.id}: starts in a wall`);
    if (m.exit) openDoor(m, m.exit);
    const field = distanceField(m, m.start);
    for (const i of floors(m)) assert.ok(field[i] >= 0, `${plan.id}: tile ${i} cannot be reached`);
  });
});
test('rooms keep to the sizes of the spec, with the ring of the finale the one exception', () => {
  for (const plan of ROOMS) {
    const cols = plan.map[0].length, rows = plan.map.length;
    if (plan.kind === 'event' || plan.kind === 'shop') assert.deepEqual([cols, rows], [13, 10], plan.id);
    else if (plan.kind === 'finale') assert.deepEqual([cols, rows], [25, 25], plan.id);
    else { assert.ok(cols >= 21 && cols <= 25, plan.id); assert.ok(rows >= 13 && rows <= 19, plan.id); }
  }
});
test('every region uses the mechanisms the design doc gives it', () => {
  const kinds = (region: number) => [...new Set(CAMPAIGN[region].rooms.flatMap(r => Object.values(r.traps ?? {}).map(t => t.kind)))].filter(k => k !== 'pad').sort();
  assert.deepEqual(kinds(0), ['belt', 'press', 'valve']);
  assert.deepEqual(kinds(1), ['mirror', 'shelf']);
  assert.deepEqual(kinds(2), ['stamper', 'vent']);
  assert.deepEqual(kinds(3), ['beacon', 'erase', 'scan']);
});
test('mechanisms are laid out so they can work', () => {
  for (const plan of ROOMS) {
    const g = new Game(); g.start(plan.id); const m = g.room;
    for (const t of g.traps) {
      const at = tileOf(m, t.x, t.z), where = `${plan.id} ${t.kind}`;
      // Spec: a low near wall would hide anything to be stabbed that stood right against it.
      if (['valve', 'mirror', 'beacon'].includes(t.kind)) { assert.ok(m.rows - 1 - at.r >= 2, where); assert.ok(m.cols - 1 - at.c >= 2, where); }
      if (t.plan.kind === 'shelf') assert.ok(railTiles(t.rail, t.dir) > t.size, where);
      if (t.plan.kind === 'stamper') { const spare = railTiles(t.rail, t.dir) - t.size; assert.ok(spare > 0 && spare % 2 === 0, `${where}: three blows do not land on whole tiles`); }
      if (t.plan.kind === 'mirror') {
        const from = DIRS[t.plan.from]; assert.equal(Math.abs(from.x * t.dir.x + from.z * t.dir.z), 0, `${where}: the way in and way out must be square`);
        // The bolt has to come out of a wall, not through a door, past no crate.
        let c = at.c + from.x, r = at.r + from.z;
        while (m.walls[r * m.cols + c] === FLOOR || m.walls[r * m.cols + c] === MACHINE) { c += from.x; r += from.z; }
        assert.equal(m.walls[r * m.cols + c], WALL, where);
        for (const line of [t.feed!, t.area]) assert.ok(line.halfX > 0 && line.halfZ > 0, `${where}: a line with no length`);
      }
    }
  }
});
test('no shelf can cut any part of a room off, wherever each of them stands, and a boss can always get round', () => {
  const roomy = (m: Room, c: number, r: number) => { for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (wallAtTile(m, c + x, r + y)) return false; return true; };
  for (const plan of ROOMS) {
    const g = new Game(); g.start(plan.id); const m = g.room, shelves = g.traps.filter(t => t.kind === 'shelf'), wide = plan.kind === 'boss' || plan.kind === 'finale';
    if (m.exit) openDoor(m, m.exit);
    for (const s of shelves) setTiles(m, s.area, FLOOR);
    const check = (index: number) => {
      if (index < shelves.length) {
        const s = shelves[index];
        for (let step = 0; step <= railTiles(s.rail, s.dir) - s.size; step++) { const slot = slotOn(s.rail, s.dir, s.size, step); setTiles(m, slot, MACHINE); check(index + 1); setTiles(m, slot, FLOOR); }
        return;
      }
      const field = distanceField(m, m.start);
      for (const i of floors(m)) assert.ok(field[i] >= 0, `${plan.id}: tile ${i % m.cols},${Math.floor(i / m.cols)} is cut off`);
      if (!wide) return;
      const route = distanceField(m, m.start, 1);
      for (const i of floors(m)) if (roomy(m, i % m.cols, Math.floor(i / m.cols))) assert.ok(route[i] >= 0, `${plan.id}: a boss cannot reach ${i % m.cols},${Math.floor(i / m.cols)}`);
    };
    check(0);
  }
});
test('every battle room has a working mechanism, and no trap sits where the hero arrives', () => {
  for (const plan of ROOMS) {
    const m = parseRoom(plan.map), kinds = Object.values(plan.traps ?? {}).map(t => t.kind);
    if (plan.waves.length) assert.ok(kinds.some(k => k !== 'pad'), `${plan.id} has no mechanism`);
    assert.deepEqual(Object.keys(m.marks).sort(), Object.keys(plan.traps ?? {}).sort(), `${plan.id}: marks and traps differ`);
    for (const [mark, area] of Object.entries(m.marks)) {
      assert.equal(inArea(area, m.start.x, m.start.z), false, `${plan.id}: ${mark} is on the arrival spot`);
      // A mark has to fill its rectangle, or the trap would cover more floor than the map shows.
      const from = tileOf(m, area.x - area.halfX + .01, area.z - area.halfZ + .01), to = tileOf(m, area.x + area.halfX - .01, area.z + area.halfZ - .01);
      for (let r = from.r; r <= to.r; r++) for (let c = from.c; c <= to.c; c++) assert.equal(plan.map[r][c], mark, `${plan.id}: ${mark} is not a rectangle`);
    }
  }
});
test('the door out stays shut until the room is cleared, then walking into it moves on', () => {
  const g = new Game(); g.start(); const exit = g.room.exit!, walk = { moveX: -exit.inward.x, moveZ: -exit.inward.z };
  const spot = { x: exit.center.x + exit.inward.x * 2 * TILE, z: exit.center.z + exit.inward.z * 2 * TILE };
  g.enemies.forEach(e => { e.x = g.room.start.x; e.z = g.room.start.z; e.speed = 0; e.cooldown = 1000; });
  g.hero.x = spot.x; g.hero.z = spot.z; step(g, 2, walk);
  assert.equal(g.roomIndex, 0); assert.equal(g.cleared, false); assert.equal(inDoor(g.room, exit, g.hero), false, 'the shut door stopped her');
  g.enemies = []; step(g, 2.1); g.enemies = []; step(g, 1.2); assert.equal(g.cleared, true); assert.equal(g.roomIndex, 0);
  assert.equal(g.state, 'reward'); const held = g.hero.z; step(g, 1, walk); assert.equal(g.hero.z, held, 'she waits for the choice'); settle(g);
  step(g, 3, walk); assert.equal(g.roomIndex, 1, 'through the open door'); assert.equal(g.cleared, false);
});
test('the hero arrives inside the door she came through, it is shut behind her, and health carries over', () => {
  const g = new Game(); g.start(); g.hero.hp = 37; g.enemies = []; g.cleared = true; g.enterRoom(1);
  assert.deepEqual([g.hero.x, g.hero.z], [g.room.start.x, g.room.start.z]); assert.equal(g.hero.hp, 37);
  const inDoorway = g.room.entrance!.center; assert.equal(isWall(g.room, inDoorway.x, inDoorway.z), true);
  step(g, 3, { moveX: -g.room.entrance!.inward.x, moveZ: -g.room.entrance!.inward.z }); assert.equal(inDoor(g.room, g.room.entrance!, g.hero), false);
});
test('an event room has its door open from the start and its pad pays once', () => {
  const g = new Game(); g.start(); g.enterRoom(2); g.wave = 2; step(g, 1.2); assert.equal(g.cleared, true); settle(g);
  const exit = g.room.exit!; g.hero.x = exit.center.x + exit.inward.x; g.hero.z = exit.center.z + exit.inward.z;
  while (g.roomIndex === 2) g.update(1 / 60, { moveX: -exit.inward.x, moveZ: -exit.inward.z });
  assert.equal(g.plan.kind, 'event'); assert.equal(g.cleared, true); assert.equal(isWall(g.room, g.room.exit!.center.x, g.room.exit!.center.z), false);
  const pad = g.traps[0]; g.hero.hp = 20; g.hero.x = pad.x; g.hero.z = pad.z; g.update(1 / 60, {}); assert.equal(g.hero.hp, 50);
  assert.ok(g.events.some(e => e.type === 'pad')); step(g, .2); assert.equal(g.hero.hp, 50);
});
test('the pause map shows the rooms walked through, this one and the next once its door is open', () => {
  const g = new Game(); g.start();
  assert.deepEqual(g.roomStates().slice(0, 3), ['current', 'locked', 'locked']);
  g.enemies = []; step(g, 2.1); g.enemies = []; step(g, 1.2); assert.deepEqual(g.roomStates().slice(0, 3), ['current', 'open', 'locked']);
  g.enterRoom(1); assert.deepEqual(g.roomStates().slice(0, 3), ['cleared', 'current', 'locked']);
});
test('the last room won clears the run and has no door to open', () => {
  const g = new Game(); g.start('4-1'); g.wave = 3; g.enemies = []; step(g, 1.2);
  assert.equal(g.state, 'won'); assert.equal(g.room.exit, null);
});
test('a door to a fight forks, and which half she walks through picks the road', () => {
  const through = (shift: number) => {
    const g = new Game(); g.start('1-1'); g.hero.invulnerable = 1000; g.enemies = []; g.wave = g.plan.waves.length; step(g, 1.3); if (g.state === 'reward') g.chooseReward(0);
    assert.equal(g.forksAhead(), true);
    const d = g.room.exit!; g.hero.x = d.center.x + (d.alongX ? shift : 0); g.hero.z = d.center.z + (d.alongX ? 0 : shift); step(g, .5);
    return g;
  };
  const safe = through(-.8), risky = through(.8);
  assert.equal(safe.plan.id, '1-2'); assert.equal(risky.plan.id, '1-2'); assert.equal(safe.route, 'supply'); assert.equal(risky.route, 'risk');
  assert.equal(risky.enemies.length, safe.enemies.length + 1, 'one more in each wave');
  assert.ok(risky.enemies.every(e => e.kind === 'e01'), 'of a kind the wave already has');
  for (const g of [safe, risky]) { g.hero.invulnerable = 1000; g.enemies = []; g.wave = g.plan.waves.length; step(g, 1.3); }
  assert.ok(safe.reward!.options.every(o => ['heal', 'refill', 'cap', 'coins'].includes(o.kind)), 'the supply road pays supplies, and no extra life');
  assert.ok(risky.reward!.options.some(o => o.kind === 'upgrade'), 'the risky road pays upgrades');
});
test('no fork on the way to an event, a shop or a boss, or in a trial', () => {
  for (const id of ['1-3', '1-7', '1-8']) { const g = new Game(); g.start(id); assert.equal(g.forksAhead(), false, id); }
  const t = new Game(); t.startTrial(); assert.equal(t.forksAhead(), false);
});
test('a retry comes back on the road it took', () => {
  const g = new Game(); g.start('1-2'); g.route = 'risk'; const run = g.snapshot();
  const back = new Game(); back.restore(run); assert.equal(back.route, 'risk');
  assert.equal(back.enemies.length, g.plan.waves[0].units!.length + 1);
  const old = new Game(); old.restore({ ...run, route: undefined }); assert.equal(old.route, '', 'a save from before there were roads');
});
test('a boss room opens through the preparation point onto the first room of the next region, which brings its own map', () => {
  const g = new Game(); g.start('1-9'); g.hero.hp = 37; g.wave = 2; g.enemies = []; step(g, 1.2);
  assert.equal(g.state, 'playing'); assert.equal(g.cleared, true); assert.deepEqual(g.roomStates().at(-1), 'current');
  const exit = g.room.exit!; g.hero.x = exit.center.x + exit.inward.x * 2 * TILE; g.hero.z = exit.center.z + exit.inward.z * 2 * TILE;
  for (let i = 0; i < 300 && g.state === 'playing'; i++) g.update(1 / 60, { moveX: -exit.inward.x, moveZ: -exit.inward.z });
  assert.equal(g.state, 'prep'); assert.equal(g.levelIndex, 0); settle(g);
  assert.equal(g.plan.id, '2-1'); assert.equal(g.level.name, '镜像书库'); assert.equal(g.hero.hp, g.hero.maxHp);
  assert.deepEqual(g.roomStates().slice(0, 2), ['current', 'locked']);
});
test('a run can start in any room, fresh and alive, which is what the back door uses', () => {
  for (const plan of ROOMS) {
    const g = new Game(); g.start(); g.hero.hp = 3; g.hero.awaken = 40; g.state = 'lost';
    g.start(plan.id);
    assert.equal(g.plan.id, plan.id); assert.equal(g.state, 'playing'); assert.equal(g.hero.hp, 100); assert.equal(g.hero.awaken, 0);
    assert.deepEqual([g.hero.x, g.hero.z], [g.room.start.x, g.room.start.z]);
    assert.equal(g.enemies.length, plan.waves[0]?.count ?? 0, plan.id);
  }
  const g = new Game(); g.start('9-9'); assert.equal(g.plan.id, '1-1', 'an unknown room starts the run as usual');
});

test('a press warns, then hits everyone standing on it, and a dash takes her out from under it', () => {
  const g = withTrap(placed('a', 3, 3, 6, 6), { a: { kind: 'press', delay: .5 } }), t = g.traps[0];
  g.enemies = [dummy(g, { id: 1, x: t.x, z: t.z, radius: .42 }), dummy(g, { id: 2, x: 12, z: 12, radius: .42 })]; g.hero.x = t.x; g.hero.z = t.z;
  const hp = g.hero.hp; step(g, .4); assert.equal(t.state, 'idle'); assert.equal(g.hero.hp, hp);
  step(g, .2); assert.equal(t.state, 'warn'); assert.equal(g.hero.hp, hp);
  step(g, PRESS.warn); assert.equal(t.state, 'strike'); assert.equal(g.hero.hp, hp - PRESS.heroDamage);
  assert.equal(g.enemies[0].hp, 1000 - PRESS.enemyDamage); assert.equal(g.enemies[1].hp, 1000, 'off the plate, untouched');
  step(g, PRESS.strike + PRESS.recover + .05); assert.equal(t.state, 'idle');
  const d = withTrap(placed('a', 3, 3, 6, 6), { a: { kind: 'press', delay: .1 } }), p = d.traps[0]; d.hero.x = p.x; d.hero.z = p.z; const before = d.hero.hp;
  while (p.state !== 'warn') d.update(1 / 60, {}); while (p.timer > .1) d.update(1 / 60, {});
  d.update(1 / 60, { dash: true, moveX: 1 }); while (p.state === 'warn') d.update(1 / 60, {}); assert.equal(d.hero.hp, before, 'the dash is invulnerable');
});
test('a belt carries the hero and enemies along it, but not the boss, and running with it is faster', () => {
  const g = withTrap(placed('a', 3, 3, 24, 6), { a: { kind: 'belt', dir: 'x+' } }), t = g.traps[0];
  g.enemies = [dummy(g, { id: 1, x: t.x - 6, z: t.z, radius: .42 }), dummy(g, { id: 2, x: t.x - 6, z: t.z + 1.5, radius: .8, boss: true })]; g.hero.x = t.x; g.hero.z = t.z;
  const x = g.hero.x, enemy = g.enemies[0].x, boss = g.enemies[1].x; step(g, 1);
  assert.ok(Math.abs(g.hero.x - x - BELT.speed) < .15, `hero rode ${g.hero.x - x}`); assert.ok(Math.abs(g.enemies[0].x - enemy - BELT.speed * BELT.enemyShare) < .2); assert.equal(g.enemies[1].x, boss);
  g.hero.x = x; step(g, .5, { moveX: 1 }); const withIt = g.hero.x - x; g.hero.x = x; step(g, .5, { moveX: -1 }); const against = x - g.hero.x; assert.ok(withIt > against + 2);
  assert.ok(BELT.speed * BELT.enemyShare < 2.2, 'no belt can keep an enemy from the hero');
});
test('stabbing a valve fires it down the line a moment later, hitting both sides on the line only, then it recharges', () => {
  const g = withTrap(placed('v', 3, 12, 3, 12), { v: { kind: 'valve', dir: 'x+' } }), t = g.traps[0];
  assert.equal(isWall(g.room, t.x, t.z), true, 'the valve is solid');
  g.enemies = [dummy(g, { id: 1, x: t.x + 8, z: t.z, radius: .42 }), dummy(g, { id: 2, x: t.x + 8, z: t.z + 4, radius: .42 })];
  g.hero.x = t.x + 2; g.hero.z = t.z + 1; step(g, 1); assert.equal(t.state, 'idle', 'it waits for the blade');
  g.update(1 / 60, { attack: true, aimX: -1, aimZ: -.5 }); step(g, .2, { aimX: -1, aimZ: -.5 }); assert.equal(t.state, 'warn');
  g.hero.z = t.z + 5; const hp = g.hero.hp; step(g, VALVE.warn); assert.equal(t.state, 'strike');
  assert.equal(g.enemies[0].hp, 1000 - VALVE.enemyDamage); assert.equal(g.enemies[1].hp, 1000); assert.equal(g.hero.hp, hp, 'she stepped off the line');
  step(g, VALVE.strike + .1); assert.equal(t.state, 'recover'); step(g, VALVE.recover); assert.equal(t.state, 'idle');
  const h = withTrap(placed('v', 3, 12, 3, 12), { v: { kind: 'valve', dir: 'x+' } }), v = h.traps[0]; v.state = 'warn'; v.timer = .05; h.hero.x = v.x + 5; h.hero.z = v.z; const full = h.hero.hp; step(h, .1); assert.equal(h.hero.hp, full - VALVE.heroDamage);
});
test('a valve blast stops at a crate, and a blade cannot reach a valve through a wall', () => {
  const map = placed('v', 3, 12, 3, 12).map((line, r) => r === 12 ? `${line.slice(0, 8)}o${line.slice(9)}` : line);
  const g = withTrap(map, { v: { kind: 'valve', dir: 'x+' } }), t = g.traps[0];
  assert.ok(inArea(t.area, t.x + 3, t.z)); assert.equal(inArea(t.area, t.x + 7, t.z), false);
  g.hero.x = t.x + 7; g.hero.z = t.z; g.enemies = [dummy(g, { x: 12, z: 12, radius: .42 })]; step(g, .1, { attack: true, aimX: -1 }); step(g, .3, { aimX: -1 }); assert.equal(t.state, 'idle');
});
test('with no enemy in reach a ready valve draws the attack', () => {
  const g = withTrap(placed('v', 3, 12, 3, 12), { v: { kind: 'valve', dir: 'x+' } }), t = g.traps[0];
  g.enemies = [dummy(g, { x: 15, z: -15, radius: .42 })]; g.hero.x = t.x + 3; g.hero.z = t.z; g.hero.heading = { x: 0, z: 1 };
  g.update(1 / 60, { attack: true }); step(g, .2); assert.equal(t.state, 'warn');
});
test('a cleared room stops its mechanisms', () => {
  const g = withTrap(placed('a', 3, 3, 6, 6), { a: { kind: 'press', delay: .1 } }), t = g.traps[0];
  g.level.rooms.push({ ...g.plan, id: 'next' }); g.enemies = []; g.wave = 1;
  g.room.exit = parseRoom(CACHE_PORT.rooms[0].map).exit; g.hero.x = t.x; g.hero.z = t.z; step(g, 1.2); assert.equal(g.cleared, true); assert.equal(t.state, 'off');
  const hp = g.hero.hp; step(g, 3); assert.equal(g.hero.hp, hp);
});
test('enemies do not spawn on a working trap', () => {
  for (const plan of ROOMS) for (let run = 0; run < (plan.waves.length ? 6 : 0); run++) {
    const g = new Game(); g.start(plan.id);
    for (const e of g.enemies) for (const t of g.traps) if (!['valve', 'mirror', 'vent', 'beacon'].includes(t.kind)) assert.equal(inArea(t.rail, e.x, e.z), false, `${plan.id} ${t.kind}`);
  }
});

test('a shelf warns, then slides its rail shoving and hurting what it meets once each, and comes back the next time', () => {
  const g = withTrap(placed('a', 3, 10, 14, 11), { a: { kind: 'shelf', dir: 'x+', size: 4, delay: .1 } }), t = g.traps[0], m = g.room;
  assert.equal(isWall(m, tileCenter(m, 3, 10).x, tileCenter(m, 3, 10).z), true, 'it is solid where it starts');
  assert.equal(isWall(m, tileCenter(m, 7, 10).x, tileCenter(m, 7, 10).z), false, 'the rest of the rail is floor');
  Object.assign(g.hero, tileCenter(m, 9, 10)); g.hero.hp = 100;
  g.enemies = [dummy(g, { ...tileCenter(m, 11, 11), radius: .42 })];
  step(g, .15); assert.equal(t.state, 'warn'); assert.equal(g.hero.hp, 100);
  step(g, SHELF.warn); assert.equal(t.state, 'strike');
  while (t.state === 'strike') { g.update(1 / 60, {}); assert.equal(isWall(m, g.hero.x, g.hero.z), false, 'she is never left inside it'); assert.equal(isWall(m, g.enemies[0].x, g.enemies[0].z), false); }
  assert.equal(t.step, 8); assert.equal(g.hero.hp, 100 - SHELF.heroDamage, 'hurt once, however long it pushed'); assert.equal(g.enemies[0].hp, 1000 - SHELF.enemyDamage);
  assert.ok(g.hero.x > t.area.x + t.area.halfX, 'she went ahead of it');
  assert.equal(isWall(m, tileCenter(m, 3, 10).x, tileCenter(m, 3, 10).z), false, 'the floor it left is walkable again');
  assert.equal(isWall(m, tileCenter(m, 14, 11).x, tileCenter(m, 14, 11).z), true);
  while (t.state !== 'warn') g.update(1 / 60, {});
  while (t.state === 'warn') g.update(1 / 60, {});
  while (t.state === 'strike') g.update(1 / 60, {});
  assert.equal(t.step, 0, 'back where it began');
});
test('a shelf that pins a body against a wall lets it out at the nearest room', () => {
  const g = withTrap(placed('a', 3, 10, 19, 11), { a: { kind: 'shelf', dir: 'x+', size: 4, delay: .1 } }), t = g.traps[0], m = g.room;
  Object.assign(g.hero, tileCenter(m, 19, 10)); g.enemies = [dummy(g, { x: -12, z: -12, radius: .42 })];
  while (t.state !== 'recover') { g.update(1 / 60, {}); g.hero.invulnerable = 0; }
  assert.equal(isWall(m, g.hero.x, g.hero.z), false); assert.equal(inArea(t.area, g.hero.x, g.hero.z), false);
});
test('a mirror sends a bolt in from the wall and off along its line, hitting everyone on both, and a stab turns it', () => {
  const g = withTrap(placed('m', 10, 3, 10, 3), { m: { kind: 'mirror', from: 'z-', dir: 'x+', delay: .1 } }), t = g.traps[0], m = g.room;
  assert.equal(isWall(m, t.x, t.z), true, 'it is solid');
  assert.ok(inArea(t.area, t.x + 6, t.z)); assert.equal(inArea(t.area, t.x - 6, t.z), false); assert.ok(inArea(t.feed!, t.x, t.z - TILE));
  g.enemies = [dummy(g, { id: 1, x: t.x + 6, z: t.z, radius: .42 }), dummy(g, { id: 2, x: t.x - 6, z: t.z, radius: .42 }), dummy(g, { id: 3, x: t.x, z: t.z - TILE, radius: .42 })];
  g.hero.x = 8; g.hero.z = 8; step(g, .15); assert.equal(t.state, 'warn');
  step(g, MIRROR.warn); assert.equal(t.state, 'strike');
  assert.deepEqual(g.enemies.map(e => e.hp), [1000 - MIRROR.enemyDamage, 1000, 1000 - MIRROR.enemyDamage], 'the line and the feed, not the other side');
  const s = withTrap(placed('m', 10, 3, 10, 3), { m: { kind: 'mirror', from: 'z-', dir: 'x+', delay: 100 } }), turned = s.traps[0];
  s.enemies = [dummy(s, { x: 12, z: 12, radius: .42 })];
  s.hero.x = turned.x + 1.5; s.hero.z = turned.z + 1.5;
  s.update(1 / 60, { attack: true, aimX: -1, aimZ: -1 }); step(s, .3, { aimX: -1, aimZ: -1 });
  assert.equal(turned.dir.x, -1, 'stabbed round'); assert.ok(inArea(turned.area, turned.x - 6, turned.z)); assert.equal(inArea(turned.area, turned.x + 6, turned.z), false);
  s.update(1 / 60, { attack: true, aimX: -1, aimZ: -1 }); step(s, .1, { aimX: -1, aimZ: -1 }); assert.equal(turned.dir.x, -1, 'too soon to turn it back');
  assert.ok(MIRROR.turnLock > LIGHT_CHAIN[2].more![2].at, 'one flurry turns it once');
});
test('a shelf in a bolt line stops the bolt', () => {
  const map = placed('m', 10, 3, 10, 3).map((line, r) => r === 3 ? `${line.slice(0, 14)}aa${line.slice(16)}` : line);
  const g = withTrap(map, { m: { kind: 'mirror', from: 'z-', dir: 'x+', delay: 100 }, a: { kind: 'shelf', dir: 'x+', size: 1, delay: 100 } }), mirror = g.traps[0];
  assert.equal(inArea(mirror.area, tileCenter(g.room, 13, 3).x, mirror.z), true); assert.equal(inArea(mirror.area, tileCenter(g.room, 17, 3).x, mirror.z), false);
});
test('a vent sends a ring out with a gap in it: the gap is safe, the ring is not, and the gap turns each time', () => {
  const g = withTrap(placed('v', 6, 6, 6, 6), { v: { kind: 'vent', dir: 'x+', delay: .1 } }), t = g.traps[0];
  assert.equal(isWall(g.room, t.x, t.z), true, 'it is solid');
  g.enemies = [dummy(g, { id: 1, x: t.x + 6, z: t.z, radius: .42 }), dummy(g, { id: 2, x: t.x - 6, z: t.z, radius: .42 })];
  g.hero.x = t.x; g.hero.z = t.z - 6; g.hero.hp = 100;
  step(g, .15 + VENT.warn); assert.equal(t.state, 'strike');
  while (t.state === 'strike') g.update(1 / 60, {});
  assert.deepEqual(g.enemies.map(e => e.hp), [1000, 1000 - VENT.enemyDamage], 'hit once, and not in the gap');
  assert.equal(g.hero.hp, 100 - VENT.heroDamage);
  while (t.state !== 'idle') g.update(1 / 60, {});
  assert.deepEqual([t.dir.x, t.dir.z], [-0, 1], 'a quarter turn on');
  const d = withTrap(placed('v', 6, 6, 6, 6), { v: { kind: 'vent', dir: 'x+', delay: .1 } }), dodged = d.traps[0];
  d.hero.x = dodged.x; d.hero.z = dodged.z - 3; d.hero.hp = 100; d.enemies = [dummy(d, { x: 12, z: 12, radius: .42 })];
  while (dodged.state !== 'strike' || dodged.sweep < 1.6) { d.hero.invulnerable = 0; d.update(1 / 60, {}); }
  d.update(1 / 60, { dash: true, moveX: 1 });
  while (dodged.state === 'strike') d.update(1 / 60, {});
  assert.equal(d.hero.hp, 100, 'a dash goes through it');
});
test('a stamper lands three blows along its rail, the last one late, and works back the other way next time', () => {
  const g = withTrap(placed('a', 3, 10, 14, 11), { a: { kind: 'stamper', dir: 'x+', size: 4, delay: .1 } }), t = g.traps[0], m = g.room;
  const slot = (c: number) => tileCenter(m, c, 10);
  g.enemies = [dummy(g, { x: 12, z: -12, radius: .42 })];
  const slabs: number[] = [], waits: number[] = [];
  for (let i = 0, last = ''; i < 2400 && slabs.length < 6; i++) {
    g.hero.invulnerable = 1; g.update(1 / 60, {});
    if (t.state === 'warn' && last !== 'warn') waits.push(warnTime(t));
    if (t.state === 'strike' && last !== 'strike') slabs.push(t.area.x);
    last = t.state;
  }
  const at = (c: number) => slot(c).x + TILE * 1.5;
  assert.deepEqual(slabs, [at(3), at(7), at(11), at(11), at(7), at(3)]);
  assert.deepEqual(waits.slice(0, 3), [STAMPER.warn, STAMPER.second, STAMPER.last]); assert.ok(STAMPER.last > STAMPER.warn && STAMPER.last > STAMPER.second, 'the third blow is the late one');
  const h = withTrap(placed('a', 3, 10, 14, 11), { a: { kind: 'stamper', dir: 'x+', size: 4, delay: .1 } }), hit = h.traps[0];
  Object.assign(h.hero, tileCenter(h.room, 8, 10)); h.hero.hp = 100; h.enemies = [dummy(h, { ...tileCenter(h.room, 4, 11), radius: .42 })];
  while (hit.step < 2) h.update(1 / 60, {});
  assert.equal(h.hero.hp, 100 - STAMPER.heroDamage, 'caught by the second blow'); assert.equal(h.enemies[0].hp, 1000 - STAMPER.enemyDamage, 'caught by the first');
  assert.equal(isWall(h.room, hit.area.x, hit.area.z), false, 'it does not block the way');
});
test('a scan line crosses the whole room: the gap is safe, a dash goes through, and everyone else is hit once', () => {
  const g = withTrap(placed('g', 1, 9, 2, 11), { g: { kind: 'scan', dir: 'x+', delay: .1 } }), t = g.traps[0], m = g.room, gap = tileCenter(m, 15, 10);
  assert.ok(inArea(t.area, gap.x, gap.z), 'the gap runs the length of the room');
  g.enemies = [dummy(g, { id: 1, x: 6, z: gap.z, radius: .42 }), dummy(g, { id: 2, x: 6, z: 10, radius: .42 })];
  g.hero.x = gap.x; g.hero.z = gap.z; g.hero.hp = 100;
  step(g, .15 + SCAN.warn); assert.equal(t.state, 'strike');
  while (t.state === 'strike') g.update(1 / 60, {});
  assert.equal(g.hero.hp, 100, 'she stood in the gap'); assert.deepEqual(g.enemies.map(e => e.hp), [1000, 1000 - SCAN.enemyDamage]);
  const h = withTrap(placed('g', 1, 9, 2, 11), { g: { kind: 'scan', dir: 'x+', delay: .1 } }), caught = h.traps[0];
  h.hero.x = 0; h.hero.z = 10; h.hero.hp = 100; h.enemies = [dummy(h, { x: 0, z: -12, radius: .42 })];
  while (caught.state !== 'recover') h.update(1 / 60, {});
  assert.equal(h.hero.hp, 100 - SCAN.heroDamage);
  const d = withTrap(placed('g', 1, 9, 2, 11), { g: { kind: 'scan', dir: 'x+', delay: .1 } }), dodged = d.traps[0];
  d.hero.x = 0; d.hero.z = 10; d.hero.hp = 100; d.enemies = [dummy(d, { x: 0, z: -12, radius: .42 })];
  while (dodged.state !== 'strike' || d.scanLines(dodged)[0].x < -1.2) d.update(1 / 60, {});
  d.update(1 / 60, { dash: true, moveZ: 1 });
  while (dodged.state === 'strike') d.update(1 / 60, {});
  assert.equal(d.hero.hp, 100, 'a dash goes through it');
});
test('erased floor bites whoever stays on it until it comes back', () => {
  const g = withTrap(placed('a', 8, 8, 11, 11), { a: { kind: 'erase', delay: .1 } }), t = g.traps[0];
  g.enemies = [dummy(g, { id: 1, x: t.x, z: t.z, radius: .42 }), dummy(g, { id: 2, x: 12, z: 12, radius: .42 })];
  g.hero.x = t.x; g.hero.z = t.z; g.hero.hp = 100;
  step(g, .15); assert.equal(t.state, 'warn'); assert.equal(g.hero.hp, 100, 'the warning does not hurt');
  while (t.state === 'warn') g.update(1 / 60, {});
  g.update(1 / 60, {}); assert.equal(g.hero.hp, 100 - ERASE.heroDamage, 'it bites at once');
  while (t.state === 'strike') g.update(1 / 60, {});
  assert.ok(g.hero.hp < 100 - ERASE.heroDamage * 3, `keeps biting: ${g.hero.hp}`); assert.ok(g.enemies[0].hp <= 1000 - ERASE.enemyDamage * 7); assert.equal(g.enemies[1].hp, 1000);
  assert.equal(isWall(g.room, t.x, t.z), false, 'she can still walk off it');
  const hp = g.hero.hp; step(g, ERASE.recover + .5); assert.equal(g.hero.hp, hp, 'back again, it does not hurt');
});
test('a beacon answers only while floor is gone, and brings back the nearest', () => {
  const map = placed('a', 3, 3, 6, 6).map((line, r) => r === 4 ? `${line.slice(0, 10)}p${line.slice(11)}` : r === 15 ? `${line.slice(0, 15)}bbbb${line.slice(19)}` : r === 16 ? `${line.slice(0, 15)}bbbb${line.slice(19)}` : line);
  const g = withTrap(map, { a: { kind: 'erase', delay: .1 }, b: { kind: 'erase', delay: .1 }, p: { kind: 'beacon' } }), [near, far, beacon] = g.traps;
  assert.equal(g.stabbable(beacon), false); assert.equal(isWall(g.room, beacon.x, beacon.z), true, 'it is solid');
  g.enemies = [dummy(g, { x: 12, z: -12, radius: .42 })]; g.hero.x = beacon.x + 2; g.hero.z = beacon.z; g.hero.invulnerable = 100;
  while (near.state !== 'strike') g.update(1 / 60, {});
  assert.equal(g.stabbable(beacon), true);
  g.update(1 / 60, { attack: true, aimX: -1 }); step(g, .3, { aimX: -1 });
  assert.equal(near.state, 'recover', 'the near one is coming back'); assert.equal(far.state, 'strike', 'the far one is still gone');
  assert.equal(beacon.state, 'recover'); assert.equal(g.stabbable(beacon), false, 'it has to recharge');
});
test('a cleared room stops every kind of mechanism, and a solid one stays where it is', () => {
  for (const plan of ROOMS) {
    if (!plan.waves.length) continue;
    const g = new Game(); g.start(plan.id); g.hero.invulnerable = 1000; step(g, 8); g.hero.hp = 100;
    g.enemies = []; g.wave = plan.waves.length; step(g, 1.2);
    if (!g.room.exit) { assert.equal(g.state, 'won'); continue; }
    assert.ok(g.traps.every(t => t.state === 'off'), plan.id);
    const hp = g.hero.hp; g.hero.invulnerable = 0; step(g, 6); assert.equal(g.hero.hp, hp, `${plan.id} still hurts`);
    const field = distanceField(g.room, g.hero); assert.ok(field[tileOf(g.room, g.room.exit.center.x, g.room.exit.center.z).r * g.room.cols + tileOf(g.room, g.room.exit.center.x, g.room.exit.center.z).c] >= 0, `${plan.id}: the way out is blocked`);
  }
});

test('a body slides along a wall and cannot pass through one, however fast', () => {
  const m = openRoom(10), edge = (m.cols / 2 - 1) * TILE;
  const end = slide(m, 0, 0, 100, 3, .32);
  assert.ok(Math.abs(end.x - edge) < TILE, 'stopped at the wall'); assert.ok(end.x + .32 <= edge + 1e-9); assert.ok(end.z > 2.9, 'kept moving along it');
});
test('a thrust and the soft lock do not go through walls', () => {
  const g = new Game(solo(openMap())); g.start(); g.hero.x = 0; g.hero.z = 0;
  const m = g.room, t = tileOf(m, 1.6, 0); for (let r = t.r - 8; r <= t.r + 8; r++) m.walls[r * m.cols + t.c] = 1;
  assert.equal(lineClear(m, g.hero, { x: 3, z: 0 }), false);
  g.enemies = [{ ...g.enemies[0], arrive: 0, id: 1, x: 3, z: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100 }];
  g.update(1 / 60, { attack: true, aimX: 1 }); assert.equal(g.hero.lockId, null);
  for (let i = 0; i < 30; i++) g.update(1 / 60, { aimX: 1 });
  assert.equal(g.enemies[0].hp, 1000); assert.ok(LIGHT_CHAIN[0].range > 3);
});
// A wall across the room with one gap at the far end, so nothing can walk straight between the two sides.
const DIVIDED = openMap(14).map((line, r) => r === 12 ? `${'#'.repeat(line.length - 6)}.....#` : line);
test('enemies walk round the walls to reach the hero', () => {
  const g = new Game(solo(DIVIDED)); g.start(); const m = g.room, e = g.enemies[0]; g.enemies = [e]; g.wave = 1;
  Object.assign(e, tileCenter(m, 3, 3), { speed: 2.4, cooldown: 1000 }); Object.assign(g.hero, tileCenter(m, 3, 18)); g.hero.invulnerable = 1000;
  assert.equal(lineClear(m, e, g.hero), false);
  for (let i = 0; i < 120 * 60 && Math.hypot(e.x - g.hero.x, e.z - g.hero.z) > 2.5; i++) { g.hero.invulnerable = 1000; e.cooldown = 1000; e.windup = 0; g.update(1 / 60, {}); assert.equal(isWall(m, e.x, e.z), false); }
  assert.ok(Math.hypot(e.x - g.hero.x, e.z - g.hero.z) <= 2.5, 'it arrived');
});
test('a boss too wide for the tiles beside a wall still finds its way round', () => {
  const g = new Game(solo(DIVIDED)); g.start(); const m = g.room, boss = dummy(g, { boss: true, radius: .8, speed: 1.8, ...tileCenter(m, 3, 3) }); g.enemies = [boss]; g.wave = 1; Object.assign(g.hero, tileCenter(m, 3, 18));
  for (let i = 0; i < 180 * 60 && Math.hypot(boss.x - g.hero.x, boss.z - g.hero.z) > 3.2; i++) { g.hero.invulnerable = 1000; boss.cooldown = 1000; boss.windup = 0; g.update(1 / 60, {}); }
  assert.ok(Math.hypot(boss.x - g.hero.x, boss.z - g.hero.z) <= 3.2, `boss stuck at ${boss.x},${boss.z}`);
});
test('a wide body has a route to a hero tucked into a corner', () => {
  const m = openRoom(12), corner = tileCenter(m, 1, 1), field = distanceField(m, corner, 1), middle = tileOf(m, 0, 0);
  assert.ok(field[middle.r * m.cols + middle.c] > 0);
});
test('a body caught overlapping a wall can walk back out', () => {
  const m = openRoom(10), inWall = tileCenter(m, 1, 1), end = slide(m, inWall.x, inWall.z, 3, 3, .8);
  assert.ok(end.x > inWall.x + 2 && end.z > inWall.z + 2); assert.equal(isWall(m, end.x, end.z), false);
});
test('standing exactly on an enemy still leaves something to aim at', () => {
  const g = new Game(solo(openMap())); g.start(); g.hero.x = 0; g.hero.z = 0; g.hero.heading = { x: 1, z: 0 };
  g.enemies = [dummy(g, { x: 0, z: 0 })];
  g.update(1 / 60, { attack: true }); assert.ok(Math.hypot(g.hero.aim.x, g.hero.aim.z) > .9);
  // The first lunge can carry her past it, but the next hit turns back and lands.
  for (let i = 1; i < 90; i++) g.update(1 / 60, { attack: i % 24 === 0 });
  assert.ok(g.enemies[0].hp < 1000);
});
test('waves spawn on the floor, away from the hero but with a path to her', () => {
  for (const plan of ROOMS) {
    for (const [index, wave] of plan.waves.entries()) for (let run = 0; run < 6; run++) {
      const g = new Game(); g.start(plan.id); g.wave = index; g.enemies = []; g.spawnWave();
      assert.equal(g.enemies.length, wave.count, plan.id); assert.equal(g.enemies.filter(e => e.boss).length, wave.boss ? 1 : 0, plan.id);
      const field = distanceField(g.room, g.hero);
      for (const e of g.enemies) { if (e.speed === 0) continue; const t = tileOf(g.room, e.x, e.z); assert.ok(field[t.r * g.room.cols + t.c] >= 9, plan.id); } // The statue stands in its corner.
    }
  }
});
test('a whole run can be won: go for each enemy from behind, then walk out by the open door', { timeout: 240000 }, () => {
  const total = ROOMS.flatMap(r => r.waves).reduce((sum, w) => sum + w.count, 0);
  for (let run = 0; run < 2; run++) {
    const g = new Game(); g.start(); const seen = new Set([g.plan.id]);
    for (let i = 0; i < 3600 * 60 && (g.state === 'playing' || g.state === 'reward' || g.state === 'prep' || g.state === 'shop' || g.state === 'dialog'); i++) {
      settle(g); g.hero.hp = 100;
      if (g.prompt) { g.interact(); g.hero.awaken = 100; g.update(1 / 60, { ult: i % 30 === 0 }); }
      else if (!g.cleared || !g.room.exit || g.leaving > 0) {
        // A shield or a keep-away enemy will not come to her, so the pilot goes to them, the way a player would.
        const foe = g.enemies.find(e => e.hp > 0 && e.kind !== 'phantom' && e.kind !== 'b02fake' && !e.ai.final);
        if (foe) {
          const spot = nearestOpen(g.room, foe.x - Math.cos(foe.facing) * (foe.radius + 1), foe.z - Math.sin(foe.facing) * (foe.radius + 1), .3);
          g.hero.x = spot.x; g.hero.z = spot.z;
          g.update(1 / 60, { attack: i % 24 === 0, aimX: foe.x - g.hero.x, aimZ: foe.z - g.hero.z });
        } else g.update(1 / 60);
      } else {
        const field = distanceField(g.room, g.room.exit.center), next = stepToward(g.room, field, g.hero.x, g.hero.z) ?? g.room.exit.center;
        g.update(1 / 60, { moveX: next.x - g.hero.x, moveZ: next.z - g.hero.z });
      }
      seen.add(g.plan.id);
    }
    assert.equal(g.state, 'won'); assert.equal(g.plan.id, '4-1'); assert.equal(seen.size, 28); assert.ok(g.kills >= total, `${g.kills} of ${total}`);
    assert.equal(g.hero.awaken <= ULT.cost, true);
  }
});
