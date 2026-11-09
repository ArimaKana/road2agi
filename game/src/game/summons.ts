// What each of the nine summon cards does once it is paid for, and everything it leaves in the room. None of their damage feeds Token or the awakening gauge.
import { CLAUDE, DEALS_DAMAGE, GEMINI, GLM, GROK, KIMI, MINIMAX, SEED, STAGGER, claudeStats, geminiStats, glmStats, gptStats, grokStats, kimiStats, minimaxStats, qwenStats, seedStats, type CardRank } from './cards.ts';
import { lineClear, slide } from './room.ts';
import { inRing, unit, type CardSlot, type Enemy, type Game, type Vec2 } from './simulation.ts';

export interface Weaken { pct: number; time: number }
// Each keeps the numbers of the card that made it, with `power` for GPT's one-off boost, so nothing changes under it if the card levels up.
export interface Decoy extends Vec2 { life: number; shock: number; shockRadius: number }
export interface Train extends Vec2 { dir: Vec2; left: number; hit: Set<number>; width: number; blast: number; blastRadius: number; power: number }
export interface Prism extends Vec2 { age: number; bolts: number; from: Vec2; hit: Set<number>; stats: ReturnType<typeof kimiStats>; life: number; power: number }
export interface Seal extends Vec2 { target: number; age: number; stats: ReturnType<typeof claudeStats>; power: number }
export interface Blitz extends Vec2 { age: number; hits: number; counts: Map<number, number>; last: number | null; total: number; finisher: number; power: number }

const TRAIN_RADIUS = .4;
const away = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
// What a card can aim at: never a false image, which is what stops an expensive card being wasted on one. A chain is fair game (spec 9).
export const hostile = (g: Game) => g.enemies.filter(e => e.hp > 0 && e.allied <= 0 && e.arrive <= 0 && e.kind !== 'phantom' && e.kind !== 'b02fake' && !e.ai.final);
const seen = (g: Game, from: Vec2, e: Enemy, reach: number) => away(from, e) <= reach + e.radius && (e.kind === 'b03' || lineClear(g.room, from, e));

// All damage reductions on one enemy count as the strongest of them, never the sum.
export const weakness = (e: Enemy) => e.weak.reduce((most, w) => Math.max(most, w.pct), 0);
const weaken = (e: Enemy, pct: number, time: number) => { e.weak = [...e.weak, { pct, time }]; };
// A boss can only be pushed over this gauge so often: once it has reeled, it shrugs off control for a while.
export function addStagger(g: Game, e: Enemy, amount: number) {
  if (e.staggered > 0 || e.staggerLock > 0) return;
  e.stagger += amount * (e.kind === 'b03' && g.hero.iconBonus ? 1.5 : 1);
  if (e.stagger < STAGGER.full) return;
  e.stagger = 0; e.staggered = STAGGER.time; e.staggerLock = STAGGER.time + STAGGER.lockout; e.windup = 0; e.ai.after = null; e.ai.chainUp = 1; e.ai.clip = ''; e.ai.clipCount++;
  g.emit('bossStagger', { id: e.id, x: e.x, z: e.z });
}

// A mouse, a stick and a finger all say only which way, so cards go by the hero's aim and never land where a cursor points.
// The enemy a targeted card goes for: close and near the aim, and in plain sight.
function pickTarget(g: Game, reach: number) {
  const h = g.hero;
  let best: Enemy | null = null, score = Infinity;
  for (const e of hostile(g)) {
    if (!seen(g, h, e, reach)) continue;
    const d = away(h, e), off = d > .001 ? Math.acos(Math.max(-1, Math.min(1, ((e.x - h.x) * h.aim.x + (e.z - h.z) * h.aim.z) / d))) : 0, s = d + off * 6;
    if (s < score) { score = s; best = e; }
  }
  return best;
}
// Kimi's prism stands halfway to that enemy, which is always in reach of its light. Only no enemy in sight stops the card.
function prismPoint(g: Game): Vec2 | null {
  const h = g.hero, e = pickTarget(g, KIMI.reach + KIMI.sight);
  return e ? slide(g.room, h.x, h.z, (e.x - h.x) / 2, (e.z - h.z) / 2, .3) : null;
}
const canTurn = (e: Enemy) => !e.boss && !e.elite && e.kind !== 'chain' && e.alliedImmune <= 0;
const inFox = (g: Game, radius: number) => hostile(g).filter(e => seen(g, g.hero, e, radius)).sort((a, b) => away(g.hero, a) - away(g.hero, b));

// Why a card cannot go right now, or null if it can. Nothing is paid when it cannot.
export function cardRefusal(g: Game, card: CardRank): string | null {
  const id = card.id;
  if (id === 'qwen') return g.hero.zeroCharges > 0 ? '零消耗次数尚未用尽' : null;
  if (id === 'glm') return inFox(g, glmStats(card).radius).some(e => e.boss || e.elite || canTurn(e)) ? null : '范围内没有可策反的目标';
  if (id === 'kimi') return prismPoint(g) ? null : '棱镜照不到敌人';
  if (id === 'claude') return pickTarget(g, CLAUDE.reach) ? null : '范围内没有可裁决的目标';
  if (id === 'gemini') return pickTarget(g, GEMINI.reach) ? null : '范围内没有可穿梭的目标';
  return null;
}

export function castCard(g: Game, card: CardSlot) {
  const h = g.hero, id = card.id, power = 1 + card.boost;
  card.boost = 0;
  if (id === 'glm') {
    const stats = glmStats(card);
    let turned = 0;
    g.emit('glmPulse', { x: h.x, z: h.z, radius: stats.radius });
    for (const e of inFox(g, stats.radius)) {
      if (e.kind === 'chain') continue;
      if (e.boss) addStagger(g, e, GLM.bossStagger);
      else if (e.elite) weaken(e, GLM.eliteWeaken, GLM.eliteTime);
      else if (turned < stats.targets && canTurn(e)) { e.allied = stats.time; e.charm = 0; e.windup = 0; e.lured = 0; e.cooldown = .4; turned++; }
      else continue;
      g.emit('glmThread', { x: h.x, z: h.z, toX: e.x, toZ: e.z, id: e.id });
    }
  } else if (id === 'qwen') {
    const stats = qwenStats(card);
    h.zeroCharges = stats.uses; h.zeroRefund = stats.refund; g.emit('qwenOn', { x: h.x, z: h.z });
  } else if (id === 'kimi') {
    const at = prismPoint(g) ?? { x: h.x, z: h.z }, stats = kimiStats(card);
    g.prisms.push({ ...at, age: 0, bolts: 0, from: { ...at }, hit: new Set(), stats, life: KIMI.first + stats.bolts * KIMI.gap + .3, power }); g.emit('kimiPrism', { ...at });
  } else if (id === 'seed') {
    const stats = seedStats(card), healed = h.noHeal > 0 ? 0 : Math.min(stats.heal, h.maxHp - h.hp, h.healBudget);
    h.hp += healed; h.healBudget -= healed; g.emit('seedHeal', { x: h.x, z: h.z, amount: healed });
    const at = slide(g.room, h.x, h.z, h.aim.x * SEED.reach * .5, h.aim.z * SEED.reach * .5, .3); // Dropped on the floor ahead, not on top of an enemy, where it could not be seen.
    g.decoy = { ...at, life: SEED.life, shock: Math.round(stats.shock * power), shockRadius: stats.shockRadius }; g.emit('decoyDrop', { ...at });
    for (const e of hostile(g)) {
      if (away(at, e) > SEED.taunt) continue;
      if (e.boss) weaken(e, SEED.bossWeaken, SEED.bossTime);
      else if (e.elite) e.lured = SEED.eliteTaunt;
    }
  } else if (id === 'minimax') {
    g.trains.push({ x: h.x, z: h.z, dir: { ...h.aim }, left: MINIMAX.length, hit: new Set(), ...minimaxStats(card), power }); g.emit('trainStart', { x: h.x, z: h.z, dir: { ...h.aim } });
  } else if (id === 'gpt') {
    const stats = gptStats(card);
    h.dashCharges = 2; h.dashCooldown = 0; h.haste = stats.haste; h.hasteTime = stats.hasteTime;
    for (const other of h.cards) {
      if (other.id === 'gpt') continue;
      if (other.cooldown > 0 && DEALS_DAMAGE.includes(other.id)) other.boost = stats.boost;
      other.cooldown = 0;
    }
    h.refractReady = true;
    g.emit('gptReset', { x: h.x, z: h.z });
  } else if (id === 'claude') {
    const e = pickTarget(g, CLAUDE.reach)!;
    g.seals.push({ x: e.x, z: e.z, target: e.id, age: 0, stats: claudeStats(card), power }); g.emit('claudeMark', { x: e.x, z: e.z, id: e.id, delay: CLAUDE.delay });
  } else if (id === 'grok') {
    const stats = grokStats(card);
    g.emit('grokWave', { x: h.x, z: h.z, aim: { ...h.aim }, radius: stats.radius, half: stats.half });
    for (const e of hostile(g)) {
      const d = away(h, e);
      if (!seen(g, h, e, stats.radius) || (d > .001 && ((e.x - h.x) * h.aim.x + (e.z - h.z) * h.aim.z) / d < Math.cos(stats.half))) continue;
      if (e.kind === 'chain') continue;
      if (e.boss) { weaken(e, GROK.bossWeaken, GROK.bossTime); addStagger(g, e, GROK.bossStagger); }
      else if (e.charmImmune <= 0) {
        // Those who move as one stop as one: a projection with its images, a line of worms with its leader.
        const together = g.enemies.filter(o => o.hp > 0 && o.allied <= 0 && o.charmImmune <= 0 && ((o.kind === 'phantom' && o.ai.owner === e.id) || (e.ai.team > 0 && o.ai.team === e.ai.team)));
        for (const o of new Set([e, ...together])) { o.charm = o.elite ? GROK.eliteTime : GROK.time; o.charmBonus = stats.bonus; o.windup = 0; o.ai.after = null; }
      }
      else continue;
      g.emit('grokCharm', { id: e.id, x: e.x, z: e.z });
    }
  } else {
    const stats = geminiStats(card);
    // Qwen and Gemini: one more dash when a zero-cost charge pays for this cast.
    const extra = h.zeroCharges > 0 && pair(g, 'qwen', 'gemini') && ready(g, 'extra', 10) ? 1 : 0;
    g.blitzes.push({ x: h.x, z: h.z, age: 0, hits: 0, counts: new Map(), last: null, total: stats.hits + extra, finisher: stats.finisher, power }); g.emit('geminiStart', { x: h.x, z: h.z });
  }
}

// Each bolt starts from where the last one struck, and goes for someone it has not hit if it can. The same target again takes half.
function fireBolt(g: Game, p: Prism) {
  const near = (from: Vec2) => hostile(g).filter(e => seen(g, from, e, KIMI.sight)).sort((a, b) => Number(p.hit.has(a.id)) - Number(p.hit.has(b.id)) || away(from, a) - away(from, b));
  let from = p.from, targets = near(from);
  if (!targets.length) { from = { x: p.x, z: p.z }; targets = near(from); }
  const e = targets[0];
  if (!e) return;
  g.emit('kimiBolt', { x: from.x, z: from.z, toX: e.x, toZ: e.z, index: p.bolts });
  const fresh = !p.hit.has(e.id), first = !p.hit.size;
  // Kimi and GPT: the first bolt after a reset. MiniMax and Kimi: a target just shoved into a wall.
  const reset = g.hero.refractReady && pair(g, 'kimi', 'gpt') ? 1.3 : 1, wall = e.wallMark > 0 && pair(g, 'minimax', 'kimi') ? 1.25 : 1;
  if (reset > 1) { g.hero.refractReady = false; g.emit('combo', { key: 'refract' }); }
  if (wall > 1) { e.wallMark = 0; g.emit('combo', { key: 'wall' }); }
  g.damage(e, Math.round((fresh ? KIMI.damage : KIMI.repeat) * p.power * reset * wall), 0, 0, 0, false, 'kimi', 1);
  if (fresh && p.stats.breakPct && (first || p.stats.breakAll)) { e.broken = p.stats.breakTime; e.breakPct = p.stats.breakPct; g.emit('armorBroken', { id: e.id, x: e.x, z: e.z }); }
  p.hit.add(e.id); p.from = { x: e.x, z: e.z };
}
function moveTrain(g: Game, t: Train, dt: number) {
  const step = Math.min(MINIMAX.speed * dt, t.left), next = slide(g.room, t.x, t.z, t.dir.x * step, t.dir.z * step, TRAIN_RADIUS), moved = away(t, next);
  t.x = next.x; t.z = next.z; t.left -= step;
  const swept = g.shots.filter(s => s.camp === 'enemy' && away(s, t) < t.width + .4).length + g.mines.filter(m => away(m, t) < t.width + .4).length;
  if (swept) { g.shots = g.shots.filter(s => s.camp !== 'enemy' || away(s, t) >= t.width + .4); g.mines = g.mines.filter(m => away(m, t) >= t.width + .4); g.emit('trainClear', { x: t.x, z: t.z }); }
  for (const e of hostile(g)) {
    if (t.hit.has(e.id) || !inRing(t, e, t.width)) continue;
    t.hit.add(e.id); g.emit('trainHit', { x: e.x, z: e.z, dir: t.dir });
    const push = e.elite ? MINIMAX.elitePush : MINIMAX.push;
    g.damage(e, Math.round((e.boss ? MINIMAX.bossDamage : MINIMAX.damage) * t.power), .35, t.dir.x * push, t.dir.z * push, false, 'minimax', 1);
    if (!e.boss && !e.elite) e.wallCheck = MINIMAX.wallWindow;
  }
  return t.left > 0 && moved >= step * .5; // A wall stops the train.
}
function resolveSeal(g: Game, s: Seal) {
  const alive = hostile(g), e = alive.find(o => o.id === s.target) ?? alive.filter(o => away(s, o) <= CLAUDE.retarget).sort((a, b) => away(s, a) - away(s, b))[0];
  g.emit('claudeStrike', { x: e?.x ?? s.x, z: e?.z ?? s.z, unbound: s.stats.unbound, splash: s.stats.splashRadius });
  if (!e) return;
  // Seed and Claude: an elite held by the decoy takes the verdict harder.
  const marked = e.elite && !!g.decoy && e.lured > 0 && pair(g, 'seed', 'claude') && ready(g, 'verdict', 10), main = s.stats.damage * s.power * (marked ? 1.3 : 1);
  // Seal before the impact, so a woven shield cannot swallow the verdict itself.
  if (e.ai.invuln <= 0) e.sealed = Math.max(e.sealed, CLAUDE.seal);
  g.damage(e, Math.round(main + (e.boss ? CLAUDE.bossExtra * s.power : 0)), 1, 0, 0, false, 'claude', 2);
  if (e.boss && e.hp > 0 && e.ai.invuln <= 0 && !e.ai.final) addStagger(g, e, CLAUDE.bossStagger);
  // The ones caught beside the target only take a share, and are never executed by it.
  for (const o of alive) if (o !== e && o.hp > 0 && away(e, o) <= s.stats.splashRadius + o.radius && lineClear(g.room, e, o)) {
    if (o.ai.invuln <= 0) o.sealed = Math.max(o.sealed, CLAUDE.seal);
    g.damage(o, Math.round(main * s.stats.splash), .6, 0, 0, false, 'claude', 1);
  }
  if (!e.boss && e.hp > 0 && e.hp < e.maxHp * s.stats.execute) g.executeEnemy(e);
}
// Least-hit target first, so she weaves between them. It never picks up more than four, and never goes over the limit on one, which is what stops a lone enemy taking all six.
function blitzStep(g: Game, b: Blitz) {
  const open = hostile(g).filter(e => seen(g, b, e, GEMINI.reach) && (b.counts.get(e.id) ?? 0) < GEMINI.perTarget && (b.counts.has(e.id) || b.counts.size < GEMINI.targets)).sort((x, y) => (b.counts.get(x.id) ?? 0) - (b.counts.get(y.id) ?? 0) || Number(x.id === b.last) - Number(y.id === b.last) || away(b, x) - away(b, y));
  const e = open[0];
  if (!e) return false;
  g.emit('geminiDash', { x: b.x, z: b.z, toX: e.x, toZ: e.z });
  g.damage(e, Math.round(GEMINI.damage * b.power), .12, 0, 0, false, 'gemini', 0);
  b.counts.set(e.id, (b.counts.get(e.id) ?? 0) + 1); b.last = e.id; b.x = e.x; b.z = e.z;
  return true;
}
function blitzFinish(g: Game, b: Blitz) {
  const alive = hostile(g), e = alive.find(o => o.id === b.last) ?? alive.filter(o => seen(g, b, o, GEMINI.reach)).sort((x, y) => away(b, x) - away(b, y))[0];
  g.emit('geminiEnd', { x: e?.x ?? b.x, z: e?.z ?? b.z });
  if (e) g.damage(e, Math.round(b.finisher * b.power), .3, 0, 0, false, 'gemini', 1);
}

// The six pair strengths of spec section 6. Only numbers on what the cards already do, and each pays once or waits on its own cooldown.
const pair = (g: Game, a: string, b: string) => g.hero.cards.some(c => c.id === a) && g.hero.cards.some(c => c.id === b);
function ready(g: Game, key: string, cooldown: number) {
  if ((g.hero.comboCd[key] ?? 0) > 0) return false;
  g.hero.comboCd[key] = cooldown; g.emit('combo', { key });
  return true;
}
// GLM and Grok: whoever comes out of it hesitates a little longer.
export function comboHesitate(g: Game, e: Enemy) { if (pair(g, 'glm', 'grok') && ready(g, 'hesitate', 8)) e.cooldown = Math.max(e.cooldown, 1.6); }

export function updateSummons(g: Game, dt: number) {
  if (g.decoy && (g.decoy.life -= dt) <= 0) {
    const d = g.decoy;
    g.emit('decoyEnd', { x: d.x, z: d.z }); g.decoy = null;
    // GLM and Seed: the decoy's end leaves the turned ones easier to hurt when they come round.
    if (pair(g, 'glm', 'seed') && g.enemies.some(e => e.allied > 0) && ready(g, 'weaken', 12)) for (const e of g.enemies) if (e.allied > 0) { e.broken = 4; e.breakPct = .2; }
    if (d.shock) {
      g.emit('decoyShock', { x: d.x, z: d.z, radius: d.shockRadius });
      for (const e of hostile(g)) if (inRing(d, e, d.shockRadius)) { const push = unit(e.x - d.x, e.z - d.z); g.damage(e, d.shock, .3, push.x * .8, push.z * .8, false, 'seed', 1); }
    }
  }
  g.prisms = g.prisms.filter(p => {
    p.age += dt;
    while (p.bolts < p.stats.bolts && p.age >= KIMI.first + p.bolts * KIMI.gap) { fireBolt(g, p); p.bolts++; }
    if (p.age < p.life) return true;
    g.emit('kimiEnd', { x: p.x, z: p.z });
    return false;
  });
  g.trains = g.trains.filter(t => {
    if (moveTrain(g, t, dt)) return true;
    g.emit('trainEnd', { x: t.x, z: t.z, dir: t.dir });
    // The blast does not count as a shove, so it never sets off the wall hit.
    if (t.blast) {
      g.emit('trainBlast', { x: t.x, z: t.z, radius: t.blastRadius });
      for (const e of hostile(g)) if (inRing(t, e, t.blastRadius)) g.damage(e, Math.round(t.blast * t.power), .3, 0, 0, false, 'minimax', 1);
    }
    return false;
  });
  g.seals = g.seals.filter(s => {
    s.age += dt;
    const e = g.enemies.find(o => o.id === s.target && o.hp > 0);
    if (e) { s.x = e.x; s.z = e.z; }
    if (s.age < CLAUDE.delay) return true;
    resolveSeal(g, s);
    return false;
  });
  g.blitzes = g.blitzes.filter(b => {
    b.age += dt;
    while (b.hits < b.total && b.age >= (b.hits + 1) * GEMINI.gap) { if (!blitzStep(g, b)) b.hits = b.total; else b.hits++; }
    if (b.hits < b.total) return true;
    blitzFinish(g, b);
    return false;
  });
}
