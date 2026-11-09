import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Game, LIGHT_CHAIN, type CardSlot, type Enemy, type GameInput } from './simulation';
import { CARDS, CLAUDE, GEMINI, GROK, KIMI, MAX_LEVEL, MINIMAX, QWEN, SEED, SUMMON, TOKEN, cardPrice, levelCap, type Branch, type CardId } from './cards';
import { SUPPLIES, allUpgrades, applyReward, rewardOptions, type Reward } from './rewards';
import { WALL, openMap, tileOf } from './room';
import { CACHE_PORT, type Level } from './level';

const FRAME = 1 / 60;
const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) g.update(FRAME, input); };
const level = (): Level => ({ ...CACHE_PORT, name: '测试', rooms: [{ id: 'A', kind: 'battle', name: '甲', map: openMap(24), waves: [{ count: 1, hp: 48 }] }, { id: 'B', kind: 'battle', name: '乙', map: openMap(24), waves: [{ count: 1, hp: 48 }] }] });
let template: Enemy;
const foe = (g: Game, over: Partial<Enemy>): Enemy => ({ ...template, arrive: 0, id: g.nextId++, z: 0, vx: 0, vz: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, windup: 0, stun: 0, weak: [], ...over });
const arena = (...loadout: CardId[]) => {
  const g = new Game(level()); g.loadout = loadout; g.start();
  template = g.enemies[0]; g.enemies = [foe(g, { x: 30, z: 30 })]; g.hero.x = 0; g.hero.z = 0; g.hero.token = TOKEN.max; g.hero.invulnerable = 1000;
  return g;
};
const put = (g: Game, ...over: Partial<Enemy>[]) => { const list = over.map(o => foe(g, o)); g.enemies.push(...list); return list; };
const leveled = (g: Game, slot: number, level: number, branch: Branch) => { const card: CardSlot = g.hero.cards[slot]; card.level = level; card.branch = branch; return card; };
const cast = (g: Game, slot: number, input: GameInput = {}) => {
  g.update(FRAME, { ...input, card: slot });
  for (let i = 0; i < 60 && !g.hero.summon?.confirmed; i++) g.update(FRAME, input);
  assert.ok(g.hero.summon?.confirmed, 'the card went off');
  for (let i = 0; i < 60 && g.hitstop > 0; i++) g.update(FRAME, input);
};
const events = (g: Game, seconds: number, input: GameInput = {}) => { const seen: string[] = []; for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(FRAME, input); seen.push(...g.events.map(e => e.type)); } return seen; };
const tap = (g: Game, input: GameInput = {}) => { g.update(FRAME, { ...input, attack: true }); g.update(FRAME, input); };
const kindOf = (r: Reward) => r.kind;
const cleared = () => { const g = new Game(); g.start(); g.enemies = []; g.wave = g.plan.waves.length; step(g, 1.2); return g; };

test('clearing a battle room stops the fight on a choice of three, after the door has opened', () => {
  const g = cleared();
  assert.equal(g.state, 'reward'); assert.equal(g.cleared, true); assert.equal(g.reward!.options.length, 3); assert.deepEqual(g.reward!.options.map(kindOf), ['upgrade', 'upgrade', 'upgrade']); assert.deepEqual([...new Set(g.reward!.options.map(o => 'id' in o && o.id))].sort(), ['glm', 'kimi'], 'each card is on offer before a second branch of one');
  const time = g.time; step(g, 1); assert.equal(g.time, time, 'nothing runs while she chooses');
});
test('one choice ends it: a branch is picked straight from the three, with no second round', () => {
  const g = cleared(), i = g.reward!.options.findIndex(o => 'id' in o && o.id === 'kimi'), up = g.reward!.options[i]; assert.ok(up.kind === 'upgrade');
  g.chooseReward(i); assert.equal(g.state, 'playing'); assert.equal(g.reward, null);
  assert.equal(g.hero.cards[1].level, 2); assert.equal(g.hero.cards[1].branch, up.branch); assert.equal(g.hero.cards[0].level, 1);
});
test('a card at II goes straight to III along its branch, and a card at III is not offered', () => {
  const g = arena('glm', 'kimi', 'seed'); leveled(g, 0, 2, 'A'); leveled(g, 1, MAX_LEVEL, 'B');
  const options = rewardOptions(g.hero); assert.deepEqual(options.map(kindOf), ['upgrade', 'upgrade', 'upgrade']);
  const up = options.find(o => 'slot' in o && o.slot === 0); assert.ok(up?.kind === 'upgrade' && up.branch === 'A' && up.level === 3); assert.ok(options.every(o => 'slot' in o && o.slot !== 1), 'the card at III is not offered');
});
test('III only opens from the third region on, and the Token cap stops growing', () => {
  const g = arena('glm', 'kimi', 'seed'); leveled(g, 0, 2, 'A'); leveled(g, 1, 2, 'B'); leveled(g, 2, 2, 'A');
  assert.equal(levelCap('1-3'), 2); assert.equal(levelCap('2-8'), 2); assert.equal(levelCap('3-1'), 3); assert.equal(levelCap('4-1'), 3);
  assert.ok(rewardOptions(g.hero, 2).every(o => o.kind !== 'upgrade')); assert.ok(rewardOptions(g.hero, 3).every(o => o.kind === 'upgrade'));
  g.hero.tokenMax = 130; assert.ok(rewardOptions(g.hero, 2).every(o => o.kind !== 'cap'));
  const low = new Game(); low.start(); low.hero.cards.forEach(c => { c.level = 2; c.branch = 'A'; }); low.enemies = []; low.wave = low.plan.waves.length; step(low, 1.2); assert.ok(low.reward!.options.every(o => o.kind !== 'upgrade'));
  const high = new Game(); high.start('3-1'); high.hero.cards.forEach(c => { c.level = 2; c.branch = 'A'; }); high.enemies = []; high.wave = high.plan.waves.length; step(high, 1.2); assert.equal(high.reward!.options.filter(o => o.kind === 'upgrade').length, 2);
});
test('the rooms the plan names offer an upgrade on their pads', () => {
  for (const id of ['1-8', '2-8', '3-8']) { const g = new Game(); g.start(id); const pad = g.traps[0]; g.hero.x = pad.x; g.hero.z = pad.z; g.update(FRAME); assert.equal(g.state, 'shop', id); assert.ok(g.shop!.length >= 3); }
  for (const id of ['1-4', '2-4', '3-4']) { const g = new Game(); g.start(id); const pad = g.traps[0]; g.hero.x = pad.x; g.hero.z = pad.z; g.update(FRAME); assert.equal(g.state, 'dialog', id); g.chooseStory(0); assert.notEqual(g.state, 'dialog', id); }
  const mod = new Game(); mod.start('1-4'); const pad = mod.traps[0]; mod.hero.x = pad.x; mod.hero.z = pad.z; mod.update(FRAME); mod.chooseStory(0); assert.equal(mod.hero.mods.length, 1);
  const shop = new Game(); shop.start('1-8'); const stall = shop.traps[0]; shop.hero.x = stall.x; shop.hero.z = stall.z; shop.update(FRAME); shop.hero.coins = 9; shop.hero.hp = 20; shop.buy(0); assert.equal(shop.hero.coins, 1); assert.equal(shop.hero.hp, 50); shop.buy(0); assert.equal(shop.hero.coins, 1, 'sold once'); shop.buy(2); assert.equal(shop.hero.coins, 1, 'too dear'); shop.closeShop(); assert.equal(shop.state, 'playing');
});
test('with every card maxed the choice is all supplies, and they pay what they say', () => {
  const g = arena('glm', 'kimi', 'seed'); for (let i = 0; i < 3; i++) leveled(g, i, MAX_LEVEL, 'A');
  assert.ok(rewardOptions(g.hero).every(o => o.kind !== 'upgrade' && o.kind !== 'recruit'));
  const h = g.hero; h.hp = 50; h.token = 50;
  for (const o of SUPPLIES.filter(s => s.kind === 'heal' || s.kind === 'refill' || s.kind === 'cap')) applyReward(h, o);
  assert.equal(h.hp, 80); assert.equal(h.tokenMax, TOKEN.max + 10); assert.equal(h.token, 100);
  applyReward(h, SUPPLIES.find(s => s.kind === 'life')!); assert.equal(h.maxHp, 110); assert.equal(h.hp, 90); applyReward(h, SUPPLIES.find(s => s.kind === 'coins')!); assert.equal(h.coins, 15);
  h.token = h.tokenMax - 2; g.gainToken(12); assert.equal(h.token, h.tokenMax, 'the new cap is the one that holds');
});
test('the stall shows every upgrade her cards could take, and buying one branch closes the other', () => {
  const g = new Game(); g.loadout = ['glm', 'kimi', 'seed']; g.start('1-8'); const pad = g.traps[0]; g.hero.x = pad.x; g.hero.z = pad.z; g.update(FRAME);
  const ups = g.shop!.filter(item => item.reward.kind === 'upgrade'); assert.equal(ups.length, 6, 'both branches of all three');
  g.hero.coins = 100; g.buy(g.shop!.indexOf(ups[0])); assert.equal(ups[1].sold, true, 'the same card'); assert.equal(ups[2].sold, false, 'another card');
});
test('a full Token cap takes extension off the stall and out of the event room', () => {
  const g = new Game(); g.start('1-8'); g.hero.tokenMax = 130; const pad = g.traps[0]; g.hero.x = pad.x; g.hero.z = pad.z; g.update(FRAME); assert.ok(g.shop!.every(item => item.reward.kind !== 'cap'));
  const e = new Game(); e.start('1-4'); e.hero.tokenMax = 130; const stone = e.traps[0]; e.hero.x = stone.x; e.hero.z = stone.z; e.update(FRAME); e.chooseStory(1); assert.equal(e.hero.tokenMax, 130);
});
test('a card taking a full team\'s place says what it costs', () => {
  const g = arena('glm', 'kimi', 'seed'), swap = rewardOptions(g.hero, MAX_LEVEL, ['claude']).find(o => o.kind === 'replace'); assert.ok(swap?.kind === 'replace'); assert.equal(swap.cost, CARDS.claude.cost); assert.equal(swap.cooldown, CARDS.claude.cooldown);
});
test('an event room gives no reward', () => {
  const g = new Game(); g.start('1-4'); assert.equal(g.plan.kind, 'event'); step(g, .2); assert.equal(g.state, 'playing');
});
test('the supply depot still heals when she steps on its pad', () => {
  const g = new Game(); g.start('1-8'); assert.equal(g.plan.kind, 'shop');
  const pad = g.traps[0]; g.hero.x = pad.x; g.hero.z = pad.z; g.hero.hp = 40; g.update(FRAME); assert.equal(g.state, 'shop'); assert.ok(g.shop!.length >= 3); assert.equal(g.hero.hp, 100);
});
test('levels start at I for each new run and carry through rooms', () => {
  const g = arena('glm', 'kimi', 'seed'); leveled(g, 0, 2, 'A'); g.enterRoom(1); assert.equal(g.hero.cards[0].level, 2);
  g.start(); assert.equal(g.hero.cards[0].level, 1); assert.equal(g.hero.cards[0].branch, null);
});
test('every card and branch has words for both steps', () => {
  for (const id of Object.keys(CARDS) as CardId[]) for (const branch of ['A', 'B'] as Branch[]) {
    const g = arena(id); const card = leveled(g, 0, 2, branch); const up = rewardOptions(g.hero)[0];
    assert.ok(up.kind === 'upgrade' && up.text.length > 2); assert.equal(card.level, 2);
  }
});

test('GLM branch A holds them for 8 seconds, branch B reaches 5 metres, and III turns a third', () => {
  const a = arena('glm'); leveled(a, 0, 2, 'A'); const [e] = put(a, { x: 2 }); cast(a, 0, { aimX: 1 }); assert.ok(e.allied > 7.5);
  const b = arena('glm'); leveled(b, 0, 2, 'B'); const [far] = put(b, { x: 7 }); cast(b, 0, { aimX: 1 }); assert.ok(far.allied > 0, '7 units is 4.7 metres');
  const base = arena('glm'); const [no] = put(base, { x: 7 }, { x: 2 }); cast(base, 0, { aimX: 1 }); assert.equal(no.allied, 0);
  const iii = arena('glm'); leveled(iii, 0, 3, 'B'); const list = put(iii, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }); cast(iii, 0, { aimX: 1 }); assert.deepEqual(list.map(o => o.allied > 0), [true, true, true, false]);
});
test('Qwen upgrades add a second use, preserve the A III discount, and refund only on the last use', () => {
  for (const branch of ['A', 'B'] as const) for (const level of [2, 3]) {
    const g = arena('qwen', 'grok', 'minimax'), card = leveled(g, 0, level, branch);
    const uses = branch === 'A' || level === 3 ? 2 : QWEN.uses, price = branch === 'A' && level === 3 ? 35 : CARDS.qwen.cost;
    g.hero.token = 50; cast(g, 0); assert.equal(cardPrice(card), price); assert.equal(g.hero.zeroCharges, uses); assert.equal(g.hero.token, 50 - price);
    step(g, 30); assert.equal(g.hero.zeroCharges, uses); assert.equal(g.hero.token, 50 - price, 'waiting never consumes or refunds a use');
    for (let i = 0; i < uses; i++) {
      cast(g, i + 1); assert.equal(g.hero.zeroCharges, uses - i - 1);
      assert.equal(g.hero.token, 50 - price + (branch === 'B' && i === uses - 1 ? 10 : 0));
      step(g, SUMMON.duration);
    }
    assert.equal(g.hero.zeroRefund, 0); const token = g.hero.token; step(g, 30); assert.equal(g.hero.token, token, 'the refund only pays once');
  }
});
test('Qwen refund also triggers on a charged thrust and respects the Token cap', () => {
  const g = arena('qwen'); leveled(g, 0, 2, 'B'); cast(g, 0); step(g, SUMMON.duration);
  g.hero.token = g.hero.tokenMax - 3; g.hero.charge = .2; g.update(FRAME, { aimX: 1 });
  assert.equal(g.hero.zeroCharges, 0); assert.equal(g.hero.zeroRefund, 0); assert.equal(g.hero.token, g.hero.tokenMax);
  assert.equal(g.events.filter(e => e.type === 'qwenOff').length, 1);
});
test('Kimi branch A adds bolts', () => {
  for (const [lv, bolts] of [[2, 4], [3, 5]]) {
    const g = arena('kimi'); leveled(g, 0, lv, 'A'); const list = put(g, ...Array.from({ length: 5 }, (_, i) => ({ x: 4 + i, z: i % 2 ? 1 : -1 }))); cast(g, 0, { aimX: 4 });
    const seen = events(g, 3); assert.equal(seen.filter(t => t === 'kimiBolt').length, bolts); assert.equal(list.filter(e => e.hp === 1000 - KIMI.damage).length, bolts);
  }
});
test('Kimi branch B breaks the armour of the first hit, and at III of every new hit', () => {
  const b = arena('kimi'); leveled(b, 0, 2, 'B'); const [e, o] = put(b, { x: 4 }, { x: 5, z: 2 }); cast(b, 0, { aimX: 4 }); step(b, KIMI.first + .05);
  assert.ok(e.broken > 3); assert.equal(o.broken, 0); const hp = e.hp; b.damage(e, 100, 0, 0, 0); assert.equal(e.hp, hp - 115, 'takes 15% more while broken');
  const iii = arena('kimi'); leveled(iii, 0, 3, 'B'); const list = put(iii, { x: 4 }, { x: 5, z: 2 }, { x: 5, z: -2 }); cast(iii, 0, { aimX: 4 }); step(iii, 1.4); assert.ok(list.every(x => x.broken > 4));
  const plain = arena('kimi'); const [p] = put(plain, { x: 4 }); cast(plain, 0, { aimX: 4 }); step(plain, 1.4); assert.equal(p.broken, 0);
});
test('Seed branch A raises the budget at once and heals more at III', () => {
  const g = arena('seed'); g.hero.healBudget = 5; const up = rewardOptions(g.hero).find(o => o.kind === 'upgrade' && o.branch === 'A'); assert.ok(up); applyReward(g.hero, up); assert.equal(g.hero.healBudget, 15, 'ten more than before');
  const iii = arena('seed'); leveled(iii, 0, 3, 'A'); iii.hero.hp = 50; iii.hero.healBudget = 50; cast(iii, 0); assert.equal(iii.hero.hp, 70);
});

test('upgrading another partner never replenishes Seed healing', () => {
  for (const id of Object.keys(CARDS) as CardId[]) {
    if (id === 'seed') continue;
    for (const branch of ['A', 'B'] as const) {
      const g = arena(id, 'seed'); g.hero.healBudget = 0;
      for (const level of [2, 3]) {
        const reward = allUpgrades(g.hero).find(r => r.id === id && r.branch === branch);
        assert.ok(reward); applyReward(g.hero, reward);
        assert.equal(g.hero.healBudget, 0, `${id} ${branch} level ${level}`);
      }
    }
  }
});
test('Seed branch B makes the decoy burst when it ends, and only then', () => {
  const g = arena('seed'); leveled(g, 0, 2, 'B'); const [near, far] = put(g, { x: 4 }, { x: 16 }); cast(g, 0, { aimX: 1 }); assert.ok(g.decoy);
  step(g, SEED.life - .3); assert.equal(near.hp, 1000); const seen = events(g, .4); assert.ok(seen.includes('decoyShock')); assert.equal(near.hp, 1000 - 12); assert.equal(far.hp, 1000);
  const plain = arena('seed'); const [p] = put(plain, { x: 4 }); cast(plain, 0, { aimX: 1 }); step(plain, SEED.life + .1); assert.equal(p.hp, 1000);
});
test('MiniMax branch A widens the train', () => {
  const off = MINIMAX.width + .42 + .1;
  const base = arena('minimax'); const [miss] = put(base, { x: 8, z: off }); cast(base, 0, { aimX: 1 }); step(base, 1); assert.equal(miss.hp, 1000);
  const a = arena('minimax'); leveled(a, 0, 3, 'A'); const [hit] = put(a, { x: 8, z: off }); cast(a, 0, { aimX: 1 }); step(a, 1); assert.equal(hit.hp, 1000 - MINIMAX.damage);
});
test('MiniMax branch B blasts at the end of the line without setting off the wall hit', () => {
  const g = arena('minimax'); leveled(g, 0, 2, 'B'); const end = MINIMAX.length; const [e] = put(g, { x: end + 2 }); cast(g, 0, { aimX: 1 }); const seen = events(g, 1.2);
  assert.ok(seen.includes('trainBlast')); assert.equal(e.hp, 1000 - 10); assert.equal(seen.filter(t => t === 'trainWall').length, 0); assert.equal(e.wallCheck, 0);
});
test('GPT branch A speeds the hero up for a moment', () => {
  const run = (lv: number) => { const g = arena('gpt'); if (lv) leveled(g, 0, lv, 'A'); cast(g, 0); step(g, SUMMON.duration); const from = g.hero.x; step(g, .9, { moveX: 1 }); return g.hero.x - from; };
  assert.ok(run(2) > run(0) * 1.1); assert.ok(run(3) > run(2) * 1.05);
  const g = arena('gpt'); leveled(g, 0, 3, 'A'); cast(g, 0); assert.ok(g.hero.hasteTime > 2.5); step(g, 3.2); assert.equal(g.hero.hasteTime, 0);
});
test('GPT branch B boosts the next hit of damage cards it refreshed, once', () => {
  const g = arena('gpt', 'claude', 'grok'); leveled(g, 0, 2, 'B'); g.hero.cards[1].cooldown = 9; g.hero.cards[2].cooldown = 9; const [e] = put(g, { x: 5 }); cast(g, 0);
  assert.equal(g.hero.cards[1].boost, .1); assert.equal(g.hero.cards[2].boost, 0, 'Grok deals no damage of her own'); step(g, SUMMON.duration + SUMMON.gap);
  g.hero.token = TOKEN.max; cast(g, 1, { aimX: 1 }); assert.equal(g.hero.cards[1].boost, 0); step(g, CLAUDE.delay + .1); assert.equal(e.hp, 1000 - Math.round(CLAUDE.damage * 1.1));
  const ready = arena('gpt', 'claude', 'grok'); leveled(ready, 0, 2, 'B'); cast(ready, 0); assert.equal(ready.hero.cards[1].boost, 0, 'a card already ready was not refreshed');
});
test('Claude branch A splashes without executing, branch B hits harder and executes sooner', () => {
  const a = arena('claude'); leveled(a, 0, 2, 'A'); const [t, side, far] = put(a, { x: 5 }, { x: 6.5, z: 1, hp: 145, maxHp: 1000 }, { x: 14 }); cast(a, 0, { aimX: 1 }); step(a, CLAUDE.delay + .1);
  assert.equal(t.hp, 820); assert.equal(side.hp, 10, '75% splash, under the execution line, but not executed'); assert.equal(far.hp, 1000);
  const b = arena('claude'); leveled(b, 0, 2, 'B'); const [m] = put(b, { x: 5 }); cast(b, 0, { aimX: 1 }); step(b, CLAUDE.delay + .1); assert.equal(m.hp, 760);
  const b3 = arena('claude'); leveled(b3, 0, 3, 'B'); const [n] = put(b3, { x: 5, hp: 590 }); cast(b3, 0, { aimX: 1 }); step(b3, CLAUDE.delay + .1); assert.ok(!b3.enemies.includes(n), '290 left of 1000 is under the 30% line');
});
test('Grok branch A catches enemies wider out, and III further', () => {
  const g = arena('grok'); const off = Math.PI * .33, spot = { x: Math.cos(off) * 5, z: Math.sin(off) * 5 }; const [miss] = put(g, spot); cast(g, 0, { aimX: 1 }); assert.equal(miss.charm, 0);
  const a = arena('grok'); leveled(a, 0, 2, 'A'); const [hit] = put(a, spot); cast(a, 0, { aimX: 1 }); assert.ok(hit.charm > 0);
  const near = arena('grok'); leveled(near, 0, 2, 'A'); const [too] = put(near, { x: GROK.radius + 1 }); cast(near, 0, { aimX: 1 }); assert.equal(too.charm, 0);
  const iii = arena('grok'); leveled(iii, 0, 3, 'A'); const [yes] = put(iii, { x: GROK.radius + 1 }); cast(iii, 0, { aimX: 1 }); assert.ok(yes.charm > 0);
});
test('Grok branch B makes the blade hit a charmed enemy harder', () => {
  const g = arena('grok'); leveled(g, 0, 2, 'B'); const [e] = put(g, { x: 2.5 }); cast(g, 0, { aimX: 1 }); step(g, SUMMON.duration);
  tap(g, { aimX: 1 }); step(g, .3, { aimX: 1 }); assert.equal(e.hp, 1000 - Math.round(LIGHT_CHAIN[0].damage * 1.15));
  const plain = arena('grok'); const [p] = put(plain, { x: 2.5 }); cast(plain, 0, { aimX: 1 }); step(plain, SUMMON.duration); tap(plain, { aimX: 1 }); step(plain, .3, { aimX: 1 }); assert.equal(p.hp, 1000 - LIGHT_CHAIN[0].damage);
});
test('Gemini branch A adds hits but keeps the limit on one target, branch B hardens the finisher', () => {
  const a = arena('gemini'); leveled(a, 0, 2, 'A'); const list = put(a, { x: 3 }, { x: 4, z: 2 }, { x: 4, z: -2 }); cast(a, 0, { aimX: 1 }); const seen = events(a, GEMINI.gap * 11);
  assert.equal(seen.filter(t => t === 'geminiDash').length, 8); assert.equal(list.reduce((sum, e) => sum + 1000 - e.hp, 0), 90);
  const alone = arena('gemini'); leveled(alone, 0, 3, 'A'); alone.enemies = []; const [e] = put(alone, { x: 3 }); cast(alone, 0, { aimX: 1 }); step(alone, GEMINI.gap * 13); assert.equal(e.hp, 1000 - 50);
  const b = arena('gemini'); leveled(b, 0, 3, 'B'); b.enemies = []; const [f] = put(b, { x: 3 }); cast(b, 0, { aimX: 1 }); step(b, GEMINI.gap * 9); assert.equal(f.hp, 1000 - 40 - 30);
});
test('a wall still stops what levels up', () => {
  const g = arena('kimi'); leveled(g, 0, 3, 'A'); g.enemies = []; put(g, { x: 7 }); const t = tileOf(g.room, 4, 0); g.room.walls[t.r * g.room.cols + t.c] = WALL;
  g.update(FRAME, { aimX: 2.5, card: 0 }); assert.equal(g.hero.summon, null);
});
