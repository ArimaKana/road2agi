import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { Game, type GameInput } from './simulation';
import { BASE_CARDS, CARD_IDS, START_SLOTS, UNLOCKS, canStartWith, startLoadout, type CardId } from './cards';
import { clearUnlocked, loadUnlocked, saveUnlocked } from './progress';
import { rewardOptions, type RecruitReward } from './rewards';

const FRAME = 1 / 60;
const step = (g: Game, seconds: number, input: GameInput = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) g.update(FRAME, input); };
const clearRoom = (g: Game) => { g.enemies = []; g.wave = g.plan.waves.length; step(g, 1.2); };
const walkOut = (g: Game) => { const exit = g.room.exit!; g.hero.x = exit.center.x; g.hero.z = exit.center.z; step(g, .5); };
const beat = (g: Game) => { clearRoom(g); walkOut(g); };
const recruitOf = (g: Game) => g.reward!.options.findIndex(o => o.kind === 'recruit');

test('a first run sets out with GLM and Kimi and an empty third place', () => {
  const g = new Game(); g.start(); assert.deepEqual(g.hero.cards.map(c => c.id), BASE_CARDS); assert.equal(START_SLOTS, 2);
  g.update(FRAME, { card: 2 }); assert.equal(g.hero.summon, null); assert.ok(g.events.some(e => e.type === 'cardDenied'));
});
test('the first region of a first run offers no new card, so the third place stays empty', () => {
  const g = new Game(); g.start(); clearRoom(g); assert.equal(g.state, 'reward'); assert.ok(g.reward!.options.every(o => o.kind !== 'recruit'));
});
test('any partner in the album can be started with, including Claude', () => {
  assert.ok(canStartWith('glm', BASE_CARDS)); assert.ok(!canStartWith('qwen', BASE_CARDS)); assert.ok(canStartWith('qwen', [...BASE_CARDS, 'qwen'])); assert.ok(!canStartWith('claude', BASE_CARDS)); assert.ok(canStartWith('claude', CARD_IDS));
  assert.deepEqual(startLoadout([], ['glm', 'kimi', 'qwen']), ['glm', 'kimi']); assert.deepEqual(startLoadout(['qwen', 'gpt'], ['glm', 'qwen']), ['qwen', 'glm']); assert.deepEqual(startLoadout(['qwen', 'gpt', 'glm'], CARD_IDS, 3), ['qwen', 'gpt', 'glm']);
  assert.deepEqual(startLoadout(['claude', 'kimi'], [...BASE_CARDS, 'claude']), ['claude', 'kimi']);
});
test('beating each boss for the first time adds its partners to the album, once', () => {
  for (const [room, ids] of Object.entries(UNLOCKS)) {
    const g = new Game(); g.start(room); clearRoom(g);
    for (const id of ids) assert.ok(g.unlocked.has(id), `${room} ${id}`);
    assert.ok(g.cleared);
  }
  const g = new Game(); g.start('1-9'); g.enemies = []; g.wave = g.plan.waves.length; const seen: unknown[] = []; for (let i = 0; i < 72; i++) { g.update(FRAME); seen.push(...g.events.filter(e => e.type === 'unlock').map(e => e.fresh)); }
  assert.deepEqual(seen, [['qwen', 'minimax']]);
  g.start('1-9'); g.enemies = []; g.wave = g.plan.waves.length; seen.length = 0; for (let i = 0; i < 72; i++) { g.update(FRAME); seen.push(...g.events.filter(e => e.type === 'unlock').map(e => e.fresh)); }
  assert.deepEqual(seen, [[]], 'a repeat win adds nothing');
});
test('an ordinary room and the event rooms unlock nothing', () => {
  const g = new Game(); g.start(); clearRoom(g); assert.equal(g.unlocked.size, BASE_CARDS.length);
});
test('losing keeps the album but not the levels', () => {
  const g = new Game(); g.start('1-9'); clearRoom(g); g.hero.cards[0].level = 3; g.hero.cards[0].branch = 'A';
  g.start(); assert.ok(g.unlocked.has('qwen')); assert.equal(g.hero.cards[0].level, 1); assert.equal(g.hero.cards[0].branch, null); assert.equal(g.hero.rescued, false);
});
test('with a free place an unlocked card simply joins at I, usable at once', () => {
  const g = new Game(); g.start('1-9'); clearRoom(g); walkOut(g); g.confirmPrep(); assert.equal(g.plan.id, '2-1');
  clearRoom(g); const i = recruitOf(g); assert.ok(i >= 0, 'a new partner gets one of the three'); const r = g.reward!.options[i] as RecruitReward;
  g.chooseReward(i); assert.equal(g.state, 'playing'); assert.equal(g.hero.cards.length, 3); assert.equal(g.hero.cards[2].id, r.id); assert.equal(g.hero.cards[2].level, 1);
  g.hero.token = 100; g.update(FRAME, { card: 2 }); assert.ok(g.hero.summon || g.events.some(e => e.type === 'cardDenied'));
});
test('with the team full a new card takes the place of the lowest one in one choice, takes over its cooldown, and that card keeps its level', () => {
  const g = new Game(); g.loadout = ['glm', 'kimi', 'seed']; g.start(); g.unlocked.add('qwen');
  g.hero.cards[0].level = 2; g.hero.cards[0].branch = 'B'; g.hero.cards[2].level = 2; g.hero.cards[2].branch = 'A'; clearRoom(g); g.hero.cards[1].cooldown = 7;
  const i = g.reward!.options.findIndex(o => o.kind === 'replace'), r = g.reward!.options[i]; assert.ok(r?.kind === 'replace'); assert.equal(r.id, 'qwen'); assert.equal(r.out, 'kimi');
  g.chooseReward(i);
  assert.equal(g.state, 'playing'); assert.deepEqual(g.hero.cards.map(c => c.id), ['glm', 'qwen', 'seed']); assert.equal(g.hero.cards[1].cooldown, 7, 'no free reset'); assert.equal(g.hero.cards[1].level, 1); assert.deepEqual(g.hero.bench.map(c => c.id), ['kimi']);
  g.hero.cards.length = 2; g.hero.bench = [{ id: 'kimi', cooldown: 0, level: 2, branch: 'A', boost: 0 }];
  const back = rewardOptions(g.hero, 2, ['kimi']), bench = back.find(o => o.kind === 'recruit') as RecruitReward; assert.equal(bench.id, 'kimi'); assert.equal(bench.level, 2); assert.ok(bench.returning);
});
test('the first rescue permanently unlocks Claude for subsequent starting teams', () => {
  const g = new Game(); g.start('3-9'); assert.ok(!g.cardChoices().includes('claude')); assert.ok(!canStartWith('claude', g.unlocked));
  clearRoom(g); assert.ok(g.hero.rescued); assert.ok(g.cardChoices().includes('claude')); assert.ok(canStartWith('claude', g.unlocked));
  g.loadout = ['claude', 'kimi']; g.start();
  assert.equal(g.hero.rescued, false); assert.ok(g.cardChoices().includes('claude')); assert.deepEqual(g.hero.cards.map(c => c.id), ['claude', 'kimi']);
});
test('a boss door leads to the preparation point, where nothing runs', () => {
  const g = new Game(); g.start('1-9'); beat(g); assert.equal(g.state, 'prep'); assert.equal(g.plan.id, '1-9');
  const time = g.time; step(g, 1); assert.equal(g.time, time); g.chooseReward(0); assert.equal(g.state, 'prep');
});
test('the preparation point rearranges the team, keeps levels and goes on to the next region', () => {
  const g = new Game(); g.start('1-9'); const glm = g.hero.cards[0]; glm.level = 2; glm.branch = 'A'; glm.cooldown = 5; beat(g);
  g.confirmPrep(['qwen', 'minimax', 'kimi']); assert.equal(g.state, 'playing'); assert.equal(g.plan.id, '2-1'); assert.deepEqual(g.hero.cards.map(c => c.id), ['qwen', 'minimax', 'kimi']); assert.deepEqual(g.hero.bench.map(c => c.id), ['glm']); assert.ok(g.enemies.length > 0, 'the next room has begun');
  g.state = 'prep'; g.levelIndex = 0; g.confirmPrep(['glm', 'kimi']); assert.deepEqual(g.hero.cards.map(c => c.id), ['glm', 'kimi']); assert.equal(g.hero.cards[0].level, 2); assert.equal(g.hero.cards[0].branch, 'A'); assert.equal(g.hero.cards[0].cooldown, 0, 'a new room has them ready');
});
test('the preparation point sends her on at full health', () => {
  const g = new Game(); g.start('1-9'); beat(g); g.hero.hp = 12; g.confirmPrep(); assert.equal(g.hero.hp, g.hero.maxHp);
});

test('an already unlocked Claude can join at the first preparation point', () => {
  const g = new Game(); g.unlocked.add('claude'); g.start('1-9'); beat(g);
  assert.equal(g.hero.rescued, false); g.confirmPrep(['claude', 'kimi']);
  assert.equal(g.plan.id, '2-1'); assert.deepEqual(g.hero.cards.map(c => c.id), ['claude', 'kimi']);
});
test('the preparation point turns down what cannot be chosen, and more than three', () => {
  const g = new Game(); g.start('1-9'); beat(g); g.confirmPrep(['gpt', 'claude', 'glm', 'kimi', 'qwen', 'minimax'] as CardId[]); assert.deepEqual(g.hero.cards.map(c => c.id), ['glm', 'kimi', 'qwen']);
  const h = new Game(); h.start('1-9'); beat(h); h.confirmPrep(); assert.deepEqual(h.hero.cards.map(c => c.id), BASE_CARDS, 'with no change the team stays');
});

afterEach(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });
const fakeStorage = () => { const data = new Map<string, string>(); Object.assign(globalThis, { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) } }); return data; };

test('existing album saves allow Claude in early rewards and restored runs without another rescue', () => {
  fakeStorage(); saveUnlocked([...BASE_CARDS, 'claude']);
  const g = new Game(); g.unlocked = new Set(loadUnlocked()); g.start();
  assert.ok(canStartWith('claude', g.unlocked)); assert.equal(g.hero.rescued, false);
  const restored = new Game(); restored.unlocked = new Set(loadUnlocked()); restored.restore(g.snapshot());
  assert.equal(restored.hero.rescued, false); assert.ok(restored.cardChoices().includes('claude'));
  clearRoom(restored); const i = recruitOf(restored); assert.ok(i >= 0);
  const reward = restored.reward!.options[i] as RecruitReward; assert.equal(reward.id, 'claude');
  restored.chooseReward(i); assert.equal(restored.hero.cards[2].id, 'claude');
});
test('the album is saved and read back, ignoring anything it does not recognise', () => {
  const data = fakeStorage(); assert.deepEqual(loadUnlocked(), BASE_CARDS);
  saveUnlocked(new Set<CardId>(['glm', 'kimi', 'qwen'])); assert.deepEqual(loadUnlocked(), ['glm', 'qwen', 'kimi']);
  data.set([...data.keys()][0], JSON.stringify(['claude', 'nobody'])); assert.ok(loadUnlocked().includes('claude')); assert.ok(!(loadUnlocked() as string[]).includes('nobody')); assert.ok(BASE_CARDS.every(id => loadUnlocked().includes(id)), 'the base cards are always there');
  data.set([...data.keys()][0], '{broken'); assert.deepEqual(loadUnlocked(), BASE_CARDS);
  clearUnlocked(); assert.equal(data.size, 0);
});
test('no storage at all just means the base cards', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined'); assert.deepEqual(loadUnlocked(), BASE_CARDS); saveUnlocked(['qwen']); clearUnlocked();
});
