// The twelve enemies and four elites of spec section 8: their numbers, what each one does, and the things they leave in the room.
// Plain data and rules like the rest of the fight. Everything an attack does is a Blast, which shows its real shape on the floor while it waits and lands when the wait is up.
import { B, GLM, WORLD_PER_METRE } from './cards.ts';
import { inArea, isWall, lineClear, nearestOpen, slide } from './room.ts';
import { weakness } from './summons.ts';
import { DASH_RECHARGE, facing, inRing, side, unit, type Enemy, type Game, type Vec2 } from './simulation.ts';

export type EnemyKind = 'plain' | 'e01' | 'e02' | 'e03' | 'e04' | 'e05' | 'e06' | 'e07' | 'e08' | 'e09' | 'e10' | 'e11' | 'e12' | 'e02e' | 'e06e' | 'e09e' | 'e12e' | 'echo' | 'phantom' | 'chain' | 'b01' | 'b02' | 'b02fake' | 'b03' | 'b04';
export type Toughness = 'light' | 'mid' | 'heavy' | 'elite';
interface Stats { hp: number; speed: number; radius: number; tough: Toughness; ranged?: boolean }
// Spec 8.3. Life is in B.
export const ENEMIES: Record<Exclude<EnemyKind, 'plain' | 'b01' | 'b02' | 'b02fake' | 'b03' | 'b04' | 'chain'>, Stats> = {
  e01: { hp: 2, speed: 3.6, radius: .3, tough: 'mid' }, e02: { hp: 8, speed: 1.8, radius: .55, tough: 'heavy' }, e03: { hp: 3, speed: 2.6, radius: .4, tough: 'light', ranged: true }, e04: { hp: 4, speed: 2, radius: .42, tough: 'light', ranged: true },
  e05: { hp: 4, speed: 2.8, radius: .42, tough: 'mid' }, e06: { hp: 4, speed: 2.2, radius: .42, tough: 'light', ranged: true }, e07: { hp: 3, speed: 1.6, radius: .45, tough: 'light', ranged: true }, e08: { hp: 3, speed: 3.8, radius: .38, tough: 'light' },
  e09: { hp: 14, speed: 2.2, radius: .55, tough: 'heavy' }, e10: { hp: 12, speed: .8, radius: .7, tough: 'heavy', ranged: true }, e11: { hp: 4, speed: 3, radius: .45, tough: 'light', ranged: true }, e12: { hp: 12, speed: 2.6, radius: .5, tough: 'heavy' },
  e02e: { hp: 20, speed: 2, radius: .6, tough: 'elite' }, e06e: { hp: 12, speed: 2.2, radius: .45, tough: 'elite', ranged: true }, e09e: { hp: 30, speed: 2.4, radius: .6, tough: 'elite' }, e12e: { hp: 30, speed: 2.6, radius: .55, tough: 'elite' },
  echo: { hp: 1, speed: 3.6, radius: .3, tough: 'mid' }, phantom: { hp: 1, speed: 2.8, radius: .42, tough: 'light' },
};
// How wide and tall each kind is drawn, in metres, for what the blade and the cursor can touch.
const BODY: Partial<Record<EnemyKind, [number, number]>> = {
  e01: [1.3, .6], e02: [1.3, 1.5], e03: [1.2, 1.1], e04: [1, 1.5], e05: [1, 1.45], e06: [1, 1.45], e07: [1.1, 1.2], e08: [1, 1.4], e09: [1.2, 1.6], e10: [1.6, 1.4], e11: [1.1, 1], e12: [1.2, 1.75],
  e02e: [1.5, 1.75], e06e: [1.2, 1.65], e09e: [1.4, 1.85], e12e: [1.4, 2], b01: [2.8, 2.6], b02: [2.5, 3], b03: [3.4, 5.2], b04: [3, 3.4], b02fake: [2.5, 3], echo: [1.3, .6], phantom: [1, 1.45],
};
const BODY_SHARE = .8; // The corners of a picture are mostly air.
// Its width and height on screen, in world units, and how far above its feet the body starts.
export function bodyOf(e: { kind?: EnemyKind; radius: number }) {
  const size = e.kind && BODY[e.kind];
  return size ? { width: size[0] * WORLD_PER_METRE * BODY_SHARE, tall: size[1] * WORLD_PER_METRE * BODY_SHARE, foot: size[1] * WORLD_PER_METRE * .05 } : { width: e.radius * 2.4, tall: 1.8, foot: .1 };
}
// What picture each kind is drawn with.
export const ENEMY_ART: Partial<Record<EnemyKind, string>> = { echo: 'e01', phantom: 'e05', b02fake: 'b02' };
export const artOf = (kind: EnemyKind) => ENEMY_ART[kind] ?? (kind === 'plain' || kind === 'chain' ? 'e01' : kind);
const TAU = Math.PI * 2, deg = (d: number) => d * Math.PI / 180;
const SHIELD_HALF = deg(70), ON_SCREEN = 15, FIRE_GAP = .4, MAX_RANGED = 3;

export interface AiState {
  phase: 'move' | 'act' | 'recover'; t: number; after: (() => void) | null;
  // The move being shown: its name, and a count that changes each time one starts.
  clip: string; clipCount: number;
  cd: number; step: number; lead: number; team: number; owner: number; dashX: number; dashZ: number; dashT: number; retreat: number; summoned: number; shieldOff: number; behind: number; overheat: number; split: boolean; respawn: number; pause: number; life: number;
  // Boss state.
  script: number; stage: number; exposed: number; invuln: number; adds: number; lostMark: number; chains: number; chainUp: number; judge: number; side: number; final: boolean; rally: boolean; seenStagger: boolean;
}
export const freshAi = (): AiState => ({ phase: 'move', t: 0, after: null, clip: '', clipCount: 0, cd: 0, step: 0, lead: 0, team: 0, owner: 0, dashX: 0, dashZ: 0, dashT: 0, retreat: 0, summoned: 0, shieldOff: 0, behind: 0, overheat: 0, split: false, respawn: 0, pause: 0, life: 0, script: 0, stage: 0, exposed: 0, invuln: 0, adds: 0, lostMark: 1, chains: 3, chainUp: 0, judge: 12, side: 1, final: false, rally: false, seenStagger: false });

// ---- What attacks leave in the room. ----
export type BlastShape = 'circle' | 'line' | 'fan';
export interface Blast {
  id: number; owner: number; shape: BlastShape; x: number; z: number; dir: Vec2; length: number; width: number; radius: number; arc: number; delay: number; total: number; damage: number;
  camp: 'enemy' | 'ally'; style: 'enemy' | 'fake' | 'aim' | 'gap'; track: number; push: number; slow: number; tokenLock: number; steal: boolean; noHeal: number; fire: (() => void) | null; safe: (Vec2 & { radius: number }) | null;
  // Only a drawing of what is coming: nothing lands when it runs out. `riding` keeps it at its owner's feet and `bent` is the leg an aim line goes on to after the wall.
  preview: boolean; riding: boolean; bent: Blast | null;
}
export interface Shot extends Vec2 { id: number; owner: number; vx: number; vz: number; radius: number; damage: number; left: number; camp: 'enemy' | 'ally'; pierce: boolean; bounces: number; look: 'data' | 'bolt' | 'thread'; hit: Set<number> }
export interface Mine extends Vec2 { id: number; owner: number; life: number; fuse: number; camp: 'enemy' | 'ally' }
export interface HeatRing extends Vec2 { id: number; owner: number; reach: number; max: number; speed: number; width: number; gapAt: number; gapHalf: number; damage: number; camp: 'enemy' | 'ally'; hit: Set<number> }
export interface Block extends Vec2 { id: number; owner: number; dir: Vec2; radius: number; arc: number; life: number; dps: number; tick: number }

const MINE = { radius: 2.2, life: 8, fuse: .9, damage: 8, slow: .35, slowTime: 1.5, friendly: 1.5 * B };
let nextThing = 1;

function plainBlast(e: Enemy, over: Partial<Blast>): Blast {
  return { id: nextThing++, owner: e.id, shape: 'circle', x: e.x, z: e.z, dir: { x: 0, z: 1 }, length: 0, width: 0, radius: 0, arc: 0, delay: 0, total: 0, damage: 0, camp: e.allied > 0 ? 'ally' : 'enemy', style: 'enemy', track: 0, push: 0, slow: 0, tokenLock: 0, steal: false, noHeal: 0, fire: null, safe: null, preview: false, riding: false, bent: null, ...over };
}
// Sets a blast waiting. It shows on the floor from now until it lands.
export function blast(g: Game, e: Enemy, delay: number, over: Partial<Blast>) {
  const b = plainBlast(e, { delay, total: delay, ...over }); g.blasts.push(b);
  return b;
}
export const faceVector = (e: Enemy): Vec2 => ({ x: Math.cos(e.facing), z: Math.sin(e.facing) });
function setFacing(e: Enemy, dir: Vec2) { e.facing = Math.atan2(dir.z, dir.x); e.side = side(dir.x, dir.z, e.side); e.direction = facing(dir.x, dir.z, e.direction); }
// Turns toward a direction at a limited rate in degrees a second, so a shield has a real front.
function turnToward(e: Enemy, dir: Vec2, rate: number, dt: number) {
  const want = Math.atan2(dir.z, dir.x), off = ((want - e.facing + Math.PI * 3) % TAU) - Math.PI, step = deg(rate) * dt;
  e.facing += Math.abs(off) <= step ? off : Math.sign(off) * step;
  const now = faceVector(e); e.side = side(now.x, now.z, e.side); e.direction = facing(now.x, now.z, e.direction);
}
export function playClip(e: Enemy, clip: string) { e.ai.clip = clip; e.ai.clipCount++; }
export function wind(e: Enemy, time: number, after: () => void, clip = '') { e.windup = time; e.ai.after = after; playClip(e, clip); }
export function recover(e: Enemy, time: number, cooldown: number) { e.ai.phase = 'recover'; e.ai.t = time; e.cooldown = cooldown; }
export function dashAlong(e: Enemy, dir: Vec2, distance: number, time: number) { e.ai.phase = 'act'; e.ai.dashX = dir.x * distance / time; e.ai.dashZ = dir.z * distance / time; e.ai.dashT = time; }
// Calls off whatever it was about to do, along with the warnings it had on the floor.
export function interrupt(g: Game, e: Enemy, cooldown = .5) {
  if (e.kind === 'e08') e.ai.step = 0;
  if (e.windup > 0) { e.windup = 0; e.ai.after = null; playClip(e, ''); }
  g.blasts = g.blasts.filter(b => b.owner !== e.id);
  if (e.ai.phase === 'act') e.ai.phase = 'move';
  e.cooldown = Math.max(e.cooldown, cooldown);
}
// How far a line runs from here before something solid stops it.
export function rayLength(g: Game, from: Vec2, dir: Vec2, most = 40) {
  for (let d = .25; d < most; d += .25) if (isWall(g.room, from.x + dir.x * d, from.z + dir.z * d)) return d - .25;
  return most;
}

// ---- Who may attack right now. ----
const meleeWinding = (g: Game) => g.enemies.filter(o => o.windup > 0 && o.allied <= 0 && !statsOf(o)?.ranged && !o.boss).length;
const rangedWinding = (g: Game) => g.enemies.filter(o => o.windup > 0 && o.allied <= 0 && statsOf(o)?.ranged).length;
export function statsOf(e: Enemy): Stats | undefined { return (ENEMIES as Record<string, Stats>)[e.kind]; }
const canMelee = (g: Game, e: Enemy) => e.allied > 0 || meleeWinding(g) < (g.levelIndex === 0 ? 2 : 3);
function canFire(g: Game, e: Enemy) {
  if (e.allied > 0) return true;
  const h = g.hero, onScreen = Math.hypot(h.x - e.x, h.z - e.z) < ON_SCREEN;
  return onScreen && rangedWinding(g) < MAX_RANGED && g.time - g.lastFire >= FIRE_GAP;
}

// ---- Damage rules that depend on the kind. ----
export function shieldUp(e: Enemy) { return (e.kind === 'e02' || e.kind === 'e02e') && e.allied <= 0 && e.ai.shieldOff <= 0 && e.ai.phase !== 'recover'; }
// Whether the thrust from this point meets the shield.
export function shieldFaces(e: Enemy, from: Vec2) {
  if (!shieldUp(e)) return false;
  const to = unit(from.x - e.x, from.z - e.z), f = faceVector(e);
  return Math.acos(Math.max(-1, Math.min(1, to.x * f.x + to.z * f.z))) <= SHIELD_HALF;
}
export function breakShield(g: Game, e: Enemy) {
  interrupt(g, e, 1.5); e.ai.shieldOff = 6; e.stun = 1.5; playClip(e, 'shield_break');
  g.emit('shieldBreak', { id: e.id, x: e.x, z: e.z });
}
// Spec 8.2: damage x (1 - armour). A knight's back is bare, a card always finds the armour, and Claude cuts it by half.
export function armorAgainst(e: Enemy, kind: string, from: Vec2) {
  const thrust = kind === 'light' || kind === 'charge';
  let armor = 0;
  if (e.kind === 'e12e') armor = .5;
  if (e.kind === 'e09' || e.kind === 'e09e') { const to = unit(from.x - e.x, from.z - e.z), f = faceVector(e); armor = !thrust || to.x * f.x + to.z * f.z > 0 ? .5 : 0; }
  if (kind === 'trap') armor = 0;
  return kind === 'claude' ? armor / 2 : armor;
}
export const damageTaken = (e: Enemy) => (e.ai.overheat > 0 ? 1.5 : 1) * (e.ai.exposed > 0 ? 1.5 : 1);
// Which blows call off a wind-up and how far a body is thrown (spec 8.2).
export function interrupts(e: Enemy, tier: number, kind: string) {
  const tough = statsOf(e)?.tough ?? 'elite', blade = kind === 'light' || kind === 'charge';
  if (tough === 'elite') return false;
  if (tough === 'light') return blade || kind === 'ult';
  if (tough === 'mid') return (blade && tier >= 1) || kind === 'ult';
  return (blade && tier >= 2) || kind === 'ult';
}
export const knockShare = (e: Enemy) => { const tough = statsOf(e)?.tough; return tough === 'heavy' ? .3 : tough === 'elite' ? .1 : 1; };
export const noReward = (e: Enemy) => e.kind === 'echo' || e.kind === 'phantom' || e.kind === 'b02fake' || e.kind === 'chain';
// What does not hold a room open or take up a card's target.
export const notCounted = (e: Enemy) => e.kind === 'phantom' || e.kind === 'b02fake' || e.kind === 'chain';

// ---- Spawning. ----
export function makeEnemy(g: Game, kind: EnemyKind, at: Vec2, over: Partial<Enemy> = {}) {
  const stats = statsOf({ kind } as Enemy), hp = (stats?.hp ?? 1) * B;
  const e = g.newEnemy({ x: at.x, z: at.z, hp, maxHp: hp, radius: stats?.radius ?? .42, speed: stats?.speed ?? 2, kind, elite: /^e\d\de$/.test(kind), cooldown: .6 + Math.random() * .8, ...over });
  g.enemies.push(e);
  return e;
}

// ---- One enemy's turn. ----
const away = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
function walk(g: Game, e: Enemy, target: Vec2, dt: number, scale = 1) {
  const toward = unit(target.x - e.x, target.z - e.z), go = g.routeTo(e, target, toward);
  Object.assign(e, slide(g.room, e.x, e.z, go.x * e.speed * scale * dt, go.z * e.speed * scale * dt, e.radius));
}
function backAway(g: Game, e: Enemy, from: Vec2, dt: number) {
  const off = unit(e.x - from.x, e.z - from.z);
  Object.assign(e, slide(g.room, e.x, e.z, off.x * e.speed * dt, off.z * e.speed * dt, e.radius));
}
// Holds a distance band: closes in when too far or out of sight, backs off when too close.
function keepRange(g: Game, e: Enemy, target: Vec2, near: number, far: number, dt: number) {
  const d = away(e, target);
  if (d > far || !lineClear(g.room, e, target)) walk(g, e, target, dt);
  else if (d < near) backAway(g, e, target, dt);
}

// Spec: with the melee slots taken the rest wait in a ring 4 to 6 units off, instead of piling on.
function closeIn(g: Game, e: Enemy, target: Vec2, dt: number) {
  const d = away(e, target);
  if (canMelee(g, e) || d > 6) { walk(g, e, target, dt); return; }
  if (d < 4) { backAway(g, e, target, dt); return; }
  const off = unit(e.x - target.x, e.z - target.z), way = e.id % 2 ? 1 : -1;
  Object.assign(e, slide(g.room, e.x, e.z, -off.z * way * e.speed * .6 * dt, off.x * way * e.speed * .6 * dt, e.radius));
}
function pounce(g: Game, e: Enemy, dir: Vec2, delay: number) {
  setFacing(e, dir);
  blast(g, e, delay, { shape: 'line', dir: { ...dir }, length: 3.5, width: .8, damage: 8 });
  wind(e, delay, () => { dashAlong(e, dir, 3.5, .2); e.cooldown = 1.6; e.ai.t = .6; });
}
function worm(g: Game, e: Enemy, target: Vec2, dt: number) {
  const ai = e.ai, turned = e.allied > 0;
  if (ai.pause > 0) { ai.pause -= dt; return; }
  const team = turned ? [] : g.enemies.filter(o => o !== e && o.hp > 0 && o.allied <= 0 && (o.kind === 'e01' || o.kind === 'echo') && o.ai.team === ai.team);
  const lead = turned ? null : team.find(o => o.id === ai.lead);
  // The leader fell: the line stops for a moment and the first of the rest takes over.
  if (!turned && ai.lead !== e.id && !lead) { ai.lead = team.length && team[0].id < e.id ? team[0].id : e.id; ai.pause = .6; return; }
  if (lead) { const behind = unit(e.x - lead.x, e.z - lead.z); walk(g, e, { x: lead.x + behind.x * .9, z: lead.z + behind.z * .9 }, dt); setFacing(e, unit(lead.x - e.x, lead.z - e.z)); return; }
  const dir = unit(target.x - e.x, target.z - e.z);
  setFacing(e, dir);
  if (away(e, target) < 4 && e.cooldown === 0 && canMelee(g, e)) {
    pounce(g, e, dir, .45);
    team.forEach((o, i) => { if (o.windup <= 0 && o.ai.phase === 'move') pounce(g, o, dir, .45 + (i + 1) * .12); });
  } else closeIn(g, e, target, dt);
}
function shieldGuard(g: Game, e: Enemy, target: Vec2, dt: number) {
  const elite = e.kind === 'e02e', dir = unit(target.x - e.x, target.z - e.z), h = g.hero;
  turnToward(e, dir, elite ? 140 : 100, dt);
  if (elite && e.allied <= 0) {
    const to = unit(h.x - e.x, h.z - e.z), f = faceVector(e), behind = to.x * f.x + to.z * f.z < 0 && away(e, h) < 6;
    e.ai.behind = behind ? e.ai.behind + dt : 0;
    if (e.ai.behind > 1 && e.cooldown === 0) {
      e.ai.behind = 0; blast(g, e, .8, { radius: 3.5, damage: 12 });
      wind(e, .8, () => recover(e, .5, 1.6), 'stomp');
      return;
    }
  }
  if (away(e, target) < 3 && e.cooldown === 0 && canMelee(g, e)) {
    const lock = faceVector(e);
    blast(g, e, .6, { shape: 'line', dir: lock, length: 2.5, width: 1.5, damage: elite ? 12 : 10, push: 1.5 });
    wind(e, .6, () => { dashAlong(e, lock, 1, .15); e.ai.t = .8; e.cooldown = 2.4; });
  } else closeIn(g, e, target, dt);
}
function courier(g: Game, e: Enemy, target: Vec2, dt: number) {
  const dir = unit(target.x - e.x, target.z - e.z), d = away(e, target);
  setFacing(e, dir);
  if (d < 3.5 && e.ai.retreat < 1.2) { e.ai.retreat += dt; backAway(g, e, target, dt); return; }
  if (d > 3.5) e.ai.retreat = 0;
  // It only backs off for so long, so it can be caught.
  keepRange(g, e, target, 0, 9, dt);
  if (e.cooldown === 0 && d <= 12 && lineClear(g.room, e, target) && canFire(g, e)) {
    g.lastFire = g.time;
    for (const off of [-18, 0, 18]) { const a = Math.atan2(dir.z, dir.x) + deg(off), line = { x: Math.cos(a), z: Math.sin(a) }; blast(g, e, .7, { shape: 'line', dir: line, length: Math.min(12, rayLength(g, e, line)), width: .35, style: 'aim', preview: true }); }
    wind(e, .7, () => {
      const aim = faceVector(e), camp = e.allied > 0 ? 'ally' : 'enemy';
      for (const off of [-18, 0, 18]) { const a = Math.atan2(aim.z, aim.x) + deg(off); shoot(g, e.x, e.z, { x: Math.cos(a), z: Math.sin(a) }, 7, 12, 7, camp, 'data', false, 0, e.id); }
      recover(e, .6, 2.6);
    });
  }
}
function priest(g: Game, e: Enemy, target: Vec2, dt: number) {
  const d = away(e, target), echoes = g.enemies.filter(o => o.kind === 'echo' && o.ai.owner === e.id && o.hp > 0);
  setFacing(e, unit(target.x - e.x, target.z - e.z));
  if (d < 2 && e.ai.cd <= 0) {
    e.ai.cd = 3; blast(g, e, .6, { radius: 2, damage: 8 });
    wind(e, .6, () => recover(e, .5, e.cooldown));
    return;
  }
  keepRange(g, e, target, 5, 8, dt);
  if (e.allied <= 0 && e.cooldown === 0 && echoes.length === 0 && e.ai.summoned < 6 && canFire(g, e)) {
    g.lastFire = g.time;
    wind(e, 1, () => {
      for (const s of [-1, 1]) {
        const spot = slide(g.room, e.x, e.z, s * 1.2, -s * 1.2, .3), o = makeEnemy(g, 'echo', spot, { cooldown: .4 });
        o.ai.owner = e.id; o.ai.team = e.id * 1000; o.ai.lead = g.enemies.find(p => p.kind === 'echo' && p.ai.owner === e.id)?.id ?? o.id; e.ai.summoned++;
      }
      g.emit('echoSummon', { x: e.x, z: e.z });
      recover(e, .5, 5);
    }, 'summon');
  }
}
function splitInto(g: Game, e: Enemy) {
  e.ai.split = true; e.ai.respawn = 0; playClip(e, 'split');
  for (const s of [-1, 1]) {
    const a = g.time + s * 2, spot = slide(g.room, e.x, e.z, Math.cos(a) * 2.6, Math.sin(a) * 2.6, .4), o = makeEnemy(g, 'phantom', spot, { cooldown: e.cooldown });
    o.ai.owner = e.id;
  }
  g.emit('phantomSplit', { x: e.x, z: e.z });
}
function illusion(g: Game, e: Enemy, target: Vec2, dt: number) {
  const fake = e.kind === 'phantom', dir = unit(target.x - e.x, target.z - e.z);
  if (fake) {
    const owner = g.enemies.find(o => o.id === e.ai.owner && o.hp > 0);
    if (!owner || owner.allied > 0) { e.hp = 0; return; } // Gone with the original, and never a kill.
  } else if (e.allied <= 0) {
    const fakes = g.enemies.filter(o => o.kind === 'phantom' && o.ai.owner === e.id && o.hp > 0);
    if (!e.ai.split) splitInto(g, e);
    else if (!fakes.length && (e.ai.respawn += dt) >= 6) splitInto(g, e);
  }
  setFacing(e, dir);
  if (away(e, target) < 2.4 && e.cooldown === 0 && canMelee(g, e)) {
    blast(g, e, .6, { shape: 'fan', dir, radius: 2.5, arc: deg(90), damage: fake ? 0 : 10, style: fake ? 'fake' : 'enemy' });
    wind(e, .6, () => recover(e, .7, 2.2));
  } else closeIn(g, e, target, dt);
}
function crossbow(g: Game, e: Enemy, target: Vec2, dt: number) {
  const elite = e.kind === 'e06e', aimTime = elite ? 1 : .8, lockTime = elite ? .3 : .25, dir = unit(target.x - e.x, target.z - e.z);
  setFacing(e, dir);
  keepRange(g, e, target, 8, 11, dt);
  if (e.cooldown > 0 || !lineClear(g.room, e, target) || !canFire(g, e)) return;
  g.lastFire = g.time;
  const b = blast(g, e, aimTime + lockTime, { shape: 'line', dir, length: rayLength(g, e, dir), width: .5, style: 'aim', track: lockTime, damage: 0 });
  b.fire = () => {
    shoot(g, e.x, e.z, b.dir, 30, 40, elite ? 16 : 14, e.allied > 0 ? 'ally' : 'enemy', 'bolt', true, elite ? 1 : 0, e.id);
    recover(e, 1, elite ? 3 : 3.5);
  };
  if (elite) b.bent = blast(g, e, aimTime + lockTime, { shape: 'line', ...bounceOf(g, b), width: .5, style: 'aim', track: lockTime, damage: 0, preview: true });
  wind(e, aimTime + lockTime, () => { /* The blast fires it, and the blast knows where the line ended up. */ });
}
const nearDoor = (g: Game, at: Vec2) => [g.room.entrance, g.room.exit].some(d => d && Math.hypot(d.center.x - at.x, d.center.z - at.z) < 3);
function jelly(g: Game, e: Enemy, target: Vec2, dt: number) {
  setFacing(e, unit(target.x - e.x, target.z - e.z));
  keepRange(g, e, target, 6, 9, dt);
  const mine = g.mines.filter(m => m.owner === e.id).length;
  if (e.allied > 0 || e.cooldown > 0 || mine >= 3 || !canFire(g, e)) return;
  g.lastFire = g.time;
  wind(e, .5, () => {
    const toward = unit(target.x - e.x, target.z - e.z), reach = Math.min(5, Math.max(3, away(e, target))), spot = slide(g.room, e.x, e.z, toward.x * reach, toward.z * reach, .3);
    if (nearDoor(g, spot)) { recover(e, .5, 1); return; }
    g.mines.push({ id: nextThing++, owner: e.id, x: spot.x, z: spot.z, life: MINE.life, fuse: -1, camp: 'enemy' });
    recover(e, .5, 4);
  }, 'drop_mine');
}
function thief(g: Game, e: Enemy, target: Vec2, dt: number) {
  setFacing(e, unit(target.x - e.x, target.z - e.z));
  keepRange(g, e, target, 6, 8, dt);
  if (e.cooldown > 0 || !canMelee(g, e)) return;
  // Behind where she is facing now. Once chosen it stays, so walking away is the answer.
  const h = g.hero, facingAway = e.allied > 0 ? unit(target.x - e.x, target.z - e.z) : h.heading, back = nearestOpen(g.room, target.x - facingAway.x * 2, target.z - facingAway.z * 2, e.radius);
  blast(g, e, .7, { x: back.x, z: back.z, radius: .9, damage: 0 });
  wind(e, .7, () => {
    Object.assign(e, back); g.emit('thiefLand', { x: e.x, z: e.z });
    e.ai.phase = 'recover'; e.ai.t = .35;
    e.ai.after = null; e.ai.step = 1;
  }, 'teleport');
}
function thiefCut(g: Game, e: Enemy, target: Vec2) {
  e.ai.step = 0;
  if (e.charm > 0) { recover(e, .4, 4); return; }
  const dir = unit(target.x - e.x, target.z - e.z); setFacing(e, dir);
  blast(g, e, .3, { shape: 'fan', dir, radius: 2.5, arc: deg(110), damage: 9, steal: true });
  wind(e, .3, () => recover(e, .7, 4));
}
function knight(g: Game, e: Enemy, target: Vec2, dt: number) {
  const dir = unit(target.x - e.x, target.z - e.z), elite = e.kind === 'e09e';
  turnToward(e, dir, 80, dt);
  if (away(e, target) > 4 || e.cooldown > 0 || !canMelee(g, e)) { if (away(e, target) > 3) closeIn(g, e, target, dt); return; }
  if (elite && e.allied <= 0) blast(g, e, .5 + .35 + 1.1, { shape: 'line', dir: { ...g.hero.lastDash }, length: 2, width: .4, style: 'aim', preview: true, riding: true });
  const thrust = (delay: number, damage: number, track: number, then: () => void) => {
    const lock = faceVector(e), b = blast(g, e, delay, { shape: 'line', dir: lock, length: 4.5, width: 1, damage, track });
    wind(e, delay, () => { const f = track ? b.dir : lock; setFacing(e, f); Object.assign(e, slide(g.room, e.x, e.z, f.x, f.z, e.radius)); then(); }, track ? 'combo' : '');
  };
  thrust(.5, 10, 0, () => thrust(.35, 10, 0, () => {
    // The third has a beat of its own. It stops following her .3 seconds before it lands.
    thrust(1.1, elite ? 20 : 18, .3, () => recover(e, 1.4, 2));
    if (elite && e.allied <= 0) {
      const h = g.hero, past = h.lastDash, spot = { x: h.x + past.x * 4.5, z: h.z + past.z * 4.5 }, second = unit(spot.x - e.x, spot.z - e.z);
      blast(g, e, 1.1, { shape: 'line', dir: second, length: 5.5, width: 1, damage: 20 });
    }
  }));
}
function furnace(g: Game, e: Enemy, target: Vec2, dt: number) {
  setFacing(e, unit(target.x - e.x, target.z - e.z));
  if (e.ai.overheat > 0) return;
  if (away(e, target) > 8) walk(g, e, target, dt);
  if (e.cooldown > 0 || !canFire(g, e)) return;
  const first = e.facing + Math.PI / 2;
  g.lastFire = g.time;
  g.emit('furnaceHeat', { x: e.x, z: e.z });
  for (const gap of [first, first + Math.PI / 2, first + Math.PI]) blast(g, e, .8, { shape: 'fan', dir: { x: Math.cos(gap), z: Math.sin(gap) }, radius: 6, arc: deg(60), style: 'gap', preview: true });
  e.ai.step = 0;
  const pulse = () => {
    g.rings.push({ id: nextThing++, owner: e.id, x: e.x, z: e.z, reach: .4, max: 12, speed: 5, width: .8, gapAt: first + e.ai.step * Math.PI / 2, gapHalf: deg(30), damage: 9, camp: e.allied > 0 ? 'ally' : 'enemy', hit: new Set() });
    e.ai.step++;
    if (e.ai.step < 3) { e.ai.phase = 'act'; e.ai.dashT = 0; e.ai.dashX = e.ai.dashZ = 0; e.ai.t = 0; wind(e, .5, pulse); }
    else { e.ai.overheat = 2.5; e.ai.phase = 'move'; e.cooldown = 5.5; playClip(e, 'overheat'); }
  };
  wind(e, .8, pulse);
}
function weaver(g: Game, e: Enemy, target: Vec2, dt: number) {
  const h = g.hero, d = away(e, h);
  setFacing(e, unit(target.x - e.x, target.z - e.z));
  if (d < 7) backAway(g, e, h, dt); else if (d > 11) walk(g, e, target, dt);
  if (e.allied > 0 || e.cooldown > 0 || !canFire(g, e)) return;
  // The statue calls it in to keep its own shield up, wherever it has run to.
  const friends = g.enemies.filter(o => o !== e && o.hp > 0 && o.allied <= 0 && o.kind !== 'e11' && (!o.boss || o.kind === 'b03') && !notCounted(o) && (o.kind === 'b03' || away(o, e) <= 9)).sort((a, b) => away(a, e) - away(b, e)).slice(0, 2);
  g.lastFire = g.time;
  if (friends.length) {
    wind(e, .5, () => {
      for (const o of friends) if (o.hp > 0) { o.shieldHp = 3 * B; o.shieldBy = e.id; o.shieldTime = 6; }
      g.emit('weaverLink', { x: e.x, z: e.z });
      recover(e, .5, 6);
    }, 'link');
  } else {
    const dir = unit(target.x - e.x, target.z - e.z);
    blast(g, e, .5, { shape: 'line', dir, length: Math.min(12, rayLength(g, e, dir)), width: .35, style: 'aim', preview: true });
    wind(e, .5, () => { shoot(g, e.x, e.z, dir, 4, 12, 6, 'enemy', 'thread', false, 0, e.id); recover(e, .5, 3); });
  }
}
function reaper(g: Game, e: Enemy, target: Vec2, dt: number) {
  const dir = unit(target.x - e.x, target.z - e.z), d = away(e, target), elite = e.kind === 'e12e';
  setFacing(e, dir);
  if (e.cooldown === 0 && d <= 2 && e.ai.cd <= 0) {
    e.ai.cd = 2; blast(g, e, .5, { radius: 2.2, damage: 8 });
    wind(e, .5, () => recover(e, .6, 1));
    return;
  }
  if (e.cooldown === 0 && d <= 4.2 && canMelee(g, e)) {
    const cut = blast(g, e, 1, { shape: 'fan', dir, radius: 4.5, arc: deg(130), damage: elite ? 16 : 14, tokenLock: e.allied > 0 ? 0 : 3 });
    wind(e, 1, () => {
      if (elite) g.blocks.push({ id: nextThing++, owner: e.id, x: cut.x, z: cut.z, dir, radius: cut.radius, arc: cut.arc, life: 3, dps: 8, tick: 0 });
      recover(e, 1, 2.5);
    }, 'memory_cut');
  } else if (d > 3.8) closeIn(g, e, target, dt);
}

const BEHAVIOUR: Partial<Record<EnemyKind, (g: Game, e: Enemy, target: Vec2, dt: number) => void>> = {
  e01: worm, echo: worm, e02: shieldGuard, e02e: shieldGuard, e03: courier, e04: priest, e05: illusion, phantom: illusion, e06: crossbow, e06e: crossbow, e07: jelly, e08: thief, e09: knight, e09e: knight, e10: furnace, e11: weaver, e12: reaper, e12e: reaper,
};

// What turning or charming an enemy changes for what it was holding up.
function dropWhatItHeld(g: Game, e: Enemy) {
  for (const o of g.enemies) {
    if (o.kind === 'echo' && o.ai.owner === e.id) o.hp = 0;
    if (o.shieldBy === e.id) { o.shieldHp = 0; o.shieldBy = 0; }
  }
}
// Called once when an enemy dies, so nothing it left keeps working.
export function enemyGone(g: Game, e: Enemy) {
  dropWhatItHeld(g, e);
  if ((e.kind === 'e01' || e.kind === 'echo') && e.ai.team > 0 && e.ai.lead === e.id) for (const o of g.enemies) if (o !== e && o.ai.team === e.ai.team && o.windup > 0) interrupt(g, o, .6);
  g.blasts = g.blasts.filter(b => b.owner !== e.id);
  g.mines = g.mines.filter(m => m.owner !== e.id);
}

export function updateEnemy(g: Game, e: Enemy, dt: number, boss: (e: Enemy, target: Vec2, dt: number) => void) {
  const ai = e.ai;
  ai.shieldOff = Math.max(0, ai.shieldOff - dt); ai.cd = Math.max(0, ai.cd - dt); ai.overheat = Math.max(0, ai.overheat - dt); ai.exposed = Math.max(0, ai.exposed - dt); ai.invuln = Math.max(0, ai.invuln - dt); ai.adds = Math.max(0, ai.adds - dt); ai.judge = Math.max(0, ai.judge - dt);
  if (e.shieldTime > 0 && (e.shieldTime -= dt) <= 0) { e.shieldHp = 0; e.shieldBy = 0; }
  if (e.allied > 0 && !ai.seenStagger && !e.boss) { ai.seenStagger = true; interrupt(g, e, .4); dropWhatItHeld(g, e); }
  if (e.allied <= 0) ai.seenStagger = false;
  if (e.kind === 'chain') { if ((ai.life -= dt) <= 0) e.hp = 0; return; }
  if (e.staggered > 0) { e.staggered = Math.max(0, e.staggered - dt); return; }
  const landing = e.kind === 'e08' && ((e.windup > 0 && ai.clip === 'teleport') || ai.step === 1);
  if (e.charm > 0 && !e.boss && !landing) { interrupt(g, e, 0); ai.phase = 'move'; return; } // Sways where it stands, with nothing to throw.
  if (e.stun > 0) return;
  if (e.windup > 0) {
    e.windup -= dt;
    if (e.windup <= 0) { e.windup = 0; const then = ai.after; ai.after = null; then?.(); }
    return;
  }
  if (ai.phase === 'act') {
    if (ai.dashT > 0) { ai.dashT -= dt; Object.assign(e, slide(g.room, e.x, e.z, ai.dashX * dt, ai.dashZ * dt, e.radius)); return; }
    ai.phase = 'recover';
  }
  if (ai.phase === 'recover') {
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.phase = 'move';
      if (ai.step === 1 && (e.kind === 'e08')) { const target = g.targetOf(e); if (target) thiefCut(g, e, target); }
    }
    return;
  }
  const target = g.targetOf(e);
  if (!target) return;
  // A two-way picture shows which side its target is on, and holds through a wind-up, which returned above.
  if (e.boss) { e.side = side(target.x - e.x, target.z - e.z, e.side); boss(e, target, dt); }
  else BEHAVIOUR[e.kind]?.(g, e, target, dt);
}

// ---- Everything left in the room moves on. ----
export function shoot(g: Game, x: number, z: number, dir: Vec2, speed: number, range: number, damage: number, camp: 'enemy' | 'ally', look: Shot['look'], pierce = false, bounces = 0, owner = 0) {
  g.shots.push({ id: nextThing++, owner, x, z, vx: dir.x * speed, vz: dir.z * speed, radius: look === 'bolt' ? .25 : .22, damage, left: range, camp, pierce, bounces, look, hit: new Set() });
}
// Where a line carries on after the wall that stops it.
function bounceOf(g: Game, b: Blast) {
  const x = b.x + b.dir.x * b.length, z = b.z + b.dir.z * b.length, dir = isWall(g.room, x + b.dir.x * .25, z) ? { x: -b.dir.x, z: b.dir.z } : { x: b.dir.x, z: -b.dir.z };
  return { x, z, dir, length: rayLength(g, { x, z }, dir) };
}
function inBlast(b: Blast, t: Vec2 & { radius: number }) {
  if (b.shape === 'circle') return inRing(b, t, b.radius);
  const x = t.x - b.x, z = t.z - b.z;
  if (b.shape === 'line') { const along = x * b.dir.x + z * b.dir.z, across = Math.abs(x * b.dir.z - z * b.dir.x); return along > -t.radius && along < b.length + t.radius && across < b.width / 2 + t.radius; }
  const d = Math.hypot(x, z);
  if (d > b.radius + t.radius) return false;
  return d < .01 || Math.acos(Math.max(-1, Math.min(1, (x * b.dir.x + z * b.dir.z) / d))) <= b.arc / 2;
}
function hurtFrom(g: Game, damage: number, owner: Enemy | undefined) {
  const h = g.hero;
  if (h.invulnerable > 0) return false;
  g.hurtHero(Math.round(damage * (1 - (owner ? weakness(owner) : 0))));
  return true;
}
function landBlast(g: Game, b: Blast) {
  if (b.preview) return;
  const owner = g.enemies.find(o => o.id === b.owner), h = g.hero;
  if (b.fire) { b.fire(); if (!b.damage) return; }
  if (b.style === 'fake') { g.emit('enemyAttack', { x: b.x, z: b.z, radius: 0, allied: false, fake: true }); return; }
  g.emit('enemyAttack', { x: b.x, z: b.z, radius: b.radius || Math.max(b.width, 1.2), allied: b.camp === 'ally', boss: !!owner?.boss, dir: b.dir, shape: b.shape, length: b.length });
  if (!b.damage) return;
  for (const o of g.enemies) {
    if (o === owner || o.hp <= 0 || notCounted(o) || (o.allied > 0) === (b.camp === 'ally') || !inBlast(b, o)) continue;
    const push = unit(o.x - b.x, o.z - b.z);
    g.damage(o, b.camp === 'ally' ? GLM.allyDamage : b.damage, .25, push.x * .4, push.z * .4, false, b.camp === 'ally' ? 'ally' : 'trap', 0);
  }
  if (b.camp === 'ally') return;
  if (g.decoy && inBlast(b, { ...g.decoy, radius: .3 })) g.emit('decoyHit', { x: g.decoy.x, z: g.decoy.z });
  if (!inBlast(b, { x: h.x, z: h.z, radius: .25 }) || (b.safe && inRing(b.safe, { x: h.x, z: h.z, radius: 0 }, b.safe.radius))) return;
  if (!hurtFrom(g, b.damage, owner)) return;
  if (b.push) { const off = b.shape === 'circle' ? unit(h.x - b.x, h.z - b.z) : b.dir; Object.assign(h, slide(g.room, h.x, h.z, off.x * b.push, off.z * b.push, .3)); }
  if (b.slow) { h.slow = b.slow; h.slowTime = 1.5; }
  if (b.tokenLock) h.tokenLock = b.tokenLock;
  if (b.noHeal) h.noHeal = b.noHeal;
  if (b.steal && h.dashCharges > 0) { h.dashCharges--; if (h.dashCooldown <= 0) h.dashCooldown = DASH_RECHARGE; g.emit('dashStolen', { x: h.x, z: h.z }); }
}
export function detonateMine(g: Game, m: Mine, friendly: boolean) {
  g.mines = g.mines.filter(o => o !== m);
  g.emit('mineBurst', { x: m.x, z: m.z, radius: MINE.radius, friendly });
  if (friendly) {
    for (const o of g.enemies) if (o.hp > 0 && !notCounted(o) && inRing(m, o, MINE.radius)) g.damage(o, MINE.friendly, .3, 0, 0, false, 'trap', 0);
    return;
  }
  const h = g.hero;
  if (Math.hypot(h.x - m.x, h.z - m.z) < MINE.radius + .25 && hurtFrom(g, MINE.damage, undefined) && !h.dash) { h.slow = MINE.slow; h.slowTime = MINE.slowTime; }
}
export function updateHazards(g: Game, dt: number) {
  const h = g.hero;
  const landing: Blast[] = [];
  g.blasts = g.blasts.filter(b => {
    b.delay -= dt;
    // A line still following its target keeps turning until its last moment.
    if (b.riding) { const owner = g.enemies.find(o => o.id === b.owner); if (owner) { b.x = owner.x; b.z = owner.z; } }
    if (b.track > 0 && b.delay > b.track) {
      const owner = g.enemies.find(o => o.id === b.owner), target = owner && g.targetOf(owner);
      if (owner && target && !b.preview) { b.x = owner.x; b.z = owner.z; b.dir = unit(target.x - owner.x, target.z - owner.z); if (b.style === 'aim') b.length = rayLength(g, b, b.dir); if (b.bent) Object.assign(b.bent, bounceOf(g, b)); }
    } else if (b.style === 'aim' && b.track > 0) b.width = 1;
    if (b.delay > 0) return true;
    landing.push(b);
    return false;
  });
  for (const b of landing) landBlast(g, b);
  g.shots = g.shots.filter(s => {
    const step = Math.hypot(s.vx, s.vz) * dt, parts = Math.max(1, Math.ceil(step / .25));
    for (let i = 0; i < parts; i++) {
      const nx = s.x + s.vx * dt / parts, nz = s.z + s.vz * dt / parts;
      if (isWall(g.room, nx, nz)) {
        const mirror = s.look === 'bolt' && g.traps.find(t => t.kind === 'mirror' && t.state !== 'off' && inArea(t.rail, nx, nz, .1));
        if (mirror) { const speed = Math.hypot(s.vx, s.vz); s.vx = mirror.dir.x * speed; s.vz = mirror.dir.z * speed; s.x = mirror.rail.x + mirror.dir.x * (mirror.rail.halfX + .05); s.z = mirror.rail.z + mirror.dir.z * (mirror.rail.halfZ + .05); s.camp = 'ally'; s.hit.clear(); g.emit('trapStab', { kind: 'mirror', x: mirror.x, z: mirror.z, dirX: mirror.dir.x, dirZ: mirror.dir.z }); continue; }
        if (s.bounces <= 0) return false;
        s.bounces--;
        if (isWall(g.room, nx, s.z)) s.vx = -s.vx; else s.vz = -s.vz;
        continue;
      }
      s.x = nx; s.z = nz;
      if (s.camp === 'enemy') {
        if (!s.hit.has(0) && Math.hypot(h.x - s.x, h.z - s.z) < s.radius + .3 && h.invulnerable <= 0) { s.hit.add(0); hurtFrom(g, s.damage, g.enemies.find(o => o.id === s.owner)); if (!s.pierce) return false; }
      } else {
        for (const o of g.enemies) {
          if (o.hp <= 0 || o.allied > 0 || s.hit.has(o.id) || notCounted(o) || Math.hypot(o.x - s.x, o.z - s.z) > s.radius + o.radius) continue;
          s.hit.add(o.id); g.damage(o, s.damage, .2, 0, 0, false, 'ally', 0);
          if (!s.pierce) return false;
        }
      }
    }
    s.left -= step;
    return s.left > 0;
  });
  g.mines = g.mines.filter(m => {
    m.life -= dt;
    if (m.life <= 0) return false;
    if (m.fuse < 0 && Math.hypot(h.x - m.x, h.z - m.z) < MINE.radius) { m.fuse = MINE.fuse; g.emit('mineFuse', { x: m.x, z: m.z }); }
    if (m.fuse >= 0 && (m.fuse -= dt) <= 0) { detonateMine(g, m, false); return false; }
    return true;
  });
  g.rings = g.rings.filter(r => {
    r.reach += r.speed * dt;
    if (r.reach >= r.max) return false;
    const hitsAt = (t: Vec2 & { radius: number }) => {
      const x = t.x - r.x, z = t.z - r.z, d = Math.hypot(x, z);
      if (Math.abs(d - r.reach) > r.width / 2 + t.radius) return false;
      const off = Math.abs(((Math.atan2(z, x) - r.gapAt + Math.PI * 3) % TAU) - Math.PI);
      return off > r.gapHalf && lineClear(g.room, r, t);
    };
    if (r.camp === 'enemy' && !r.hit.has(0) && hitsAt({ x: h.x, z: h.z, radius: .2 }) && h.invulnerable <= 0) { r.hit.add(0); hurtFrom(g, r.damage, g.enemies.find(o => o.id === r.owner)); }
    if (r.camp === 'ally') for (const o of g.enemies) if (o.hp > 0 && o.allied <= 0 && !r.hit.has(o.id) && !notCounted(o) && hitsAt(o)) { r.hit.add(o.id); g.damage(o, r.damage, .2, 0, 0, false, 'ally', 0); }
    return true;
  });
  g.blocks = g.blocks.filter(b => {
    b.life -= dt; b.tick -= dt;
    if (b.tick <= 0 && inBlast({ ...b, shape: 'fan' } as unknown as Blast, { x: h.x, z: h.z, radius: .2 })) { b.tick = 1; hurtFrom(g, b.dps, g.enemies.find(o => o.id === b.owner)); }
    return b.life > 0;
  });
  // A rally set off from inside one of the lists above was written over by it.
  if (g.enemies.some(e => e.ai.rally)) { g.shots = []; g.rings = []; g.mines = []; g.blocks = []; }
}
