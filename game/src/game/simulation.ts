// The whole fight as plain data and rules, with no rendering, so it runs the same in the browser, the tests and the art tools.
import { FLOOR, MACHINE, TILE, blocked, clearanceFor, distanceField, inArea, inDoor, lineClear, lineFrom, nearestOpen, openDoor, parseRoom, pathClear, railTiles, setTiles, slide, slotOn, stepToward, tileCenter, tileOf, wallAtTile, type Area, type Room } from './room.ts';
import { CAMPAIGN, type Dir, type Level, type RoomPlan, type TrapPlan } from './level.ts';
import { B, CARDS, DEFAULT_LOADOUT, GLM, GROK, MINIMAX, SEED, SUMMON, TOKEN, WORLD_PER_METRE, BASE_CARDS, SLOTS, UNLOCKS, cardPrice, levelCap, seedStats, type Branch, type CardId } from './cards.ts';
import { MODS, TOKEN_CEILING, allUpgrades, applyReward, freshCard, modOffer, rewardOptions, supplyOptions, type Reward, type WeaponMod } from './rewards.ts';
import { STORY } from './story.ts';
import { trialRoom } from './trial.ts';
import { addStagger, cardRefusal, castCard, comboHesitate, hostile, updateSummons, weakness, type Blitz, type Decoy, type Prism, type Seal, type Train, type Weaken } from './summons.ts';
import { armorAgainst, artOf, bodyOf, breakShield, damageTaken, detonateMine, enemyGone, freshAi, interrupt, interrupts, knockShare, makeEnemy, noReward, notCounted, playClip, shieldFaces, updateEnemy, updateHazards, type AiState, type Blast, type Block, type EnemyKind, type HeatRing, type Mine, type Shot } from './enemies.ts';
import { ICON_SPOT, chainCut, iconBroken, startRally, updateBoss } from './bosses.ts';
import type { GameEvent, GameEventArgs } from './gameEvents.ts';
export type { GameEvent } from './gameEvents.ts';

export { B, WORLD_PER_METRE };
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export interface Vec2 { x: number; z: number }
export const unit = (x = 0, z = 0): Vec2 => { const d = Math.hypot(x, z); return d > 0.001 ? { x: x / d, z: z / d } : { x: 0, z: 0 }; };
export const screenToWorld = (x: number, y: number): Vec2 => ({ x: (x + y) / Math.SQRT2, z: (y - x) / Math.SQRT2 });
export const worldToScreen = (x: number, z: number) => ({ x: (x - z) / Math.SQRT2, y: (x + z) / Math.SQRT2 });

// The hero and the boss face eight screen directions, clockwise from up. Spec: a heading on the edge of two keeps the one it already had, with a little hysteresis so it cannot flicker.
export const FACINGS = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];
const FACING_STEP = Math.PI / 4, FACING_HOLD = 0.14;
export function facing(x: number, z: number, previous = 3) {
  const d = worldToScreen(x, z);
  if (Math.hypot(d.x, d.y) < 0.01) return previous;
  const angle = Math.atan2(d.x, -d.y), away = Math.abs(((angle - previous * FACING_STEP) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return away < FACING_STEP / 2 + FACING_HOLD ? previous : (Math.round(angle / FACING_STEP) + 8) % 8;
}
// Ordinary enemies only face left (-1) or right (1). Straight up or down the screen keeps the side it was on.
const SIDE_HOLD = 0.15;
export function side(x: number, z: number, previous = 1) {
  const d = worldToScreen(x, z), length = Math.hypot(d.x, d.y);
  if (length < 0.01 || Math.abs(d.x) / length < SIDE_HOLD) return previous;
  return d.x < 0 ? -1 : 1;
}
export function inThrust(origin: Vec2, direction: Vec2, target: Vec2 & { radius: number }, range = 4.4, width = 0.6) {
  if (Math.hypot(direction.x, direction.z) < 0.1) return false;
  const x = target.x - origin.x, z = target.z - origin.z;
  const along = x * direction.x + z * direction.z;
  const across = Math.abs(x * direction.z - z * direction.x);
  return along > -0.25 - target.radius && along < range + target.radius && across < width + target.radius; // Standing inside it counts, whichever way she is turned.
}
// The floor is seen at a slant, so a step toward or away from the camera moves a third less on screen, while everyone stands up from the floor as a flat picture.
// A blade held at chest height crosses the picture of someone who is well off its line on the floor, and that has to count, or a hit you can see misses.
const FLOOR_SLANT = 1 / Math.sqrt(3), BLADE_HEIGHT = 1;
export function bladeTouches(origin: Vec2, direction: Vec2, target: Vec2 & { width: number; tall: number; foot: number }, range: number, thickness: number) {
  const x = target.x - origin.x, z = target.z - origin.z;
  const left = (x - z) / Math.SQRT2 - target.width / 2 - thickness, right = left + target.width + thickness * 2;
  const low = -(x + z) / Math.SQRT2 * FLOOR_SLANT + target.foot - thickness, high = low + target.tall + thickness * 2;
  const dx = (direction.x - direction.z) / Math.SQRT2 * range, dy = -(direction.x + direction.z) / Math.SQRT2 * FLOOR_SLANT * range;
  // Where the blade's line enters and leaves the box, from the hilt at 0 to the tip at 1.
  let enter = 0, leave = 1;
  for (const [from, step, near, far] of [[0, dx, left, right], [BLADE_HEIGHT, dy, low, high]]) {
    if (Math.abs(step) < 1e-6) { if (from < near || from > far) return false; continue; }
    const a = (near - from) / step, b = (far - from) / step;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave;
}
export function inRing(center: Vec2, target: Vec2 & { radius: number }, radius: number) { return Math.hypot(target.x - center.x, target.z - center.z) < radius + target.radius; }

const M = WORLD_PER_METRE;
// Every animation plays at 8 frames a second, and attack timings are authored in those frames.
export const ANIMATION_FPS = 8;
const F = 1 / ANIMATION_FPS;

export type AttackKind = 'light' | 'charge';
interface Blow { damage: number; range: number; stun: number; push: number; hitstop: number; shake: number; tier: number }
export interface Attack extends Blow { action: string; duration: number; hitAt: number; cancelAt: number; interruptAt?: number; width: number; travel: number; more?: (Partial<Blow> & { at: number })[] }
// The hits of the chain: the frames, hit frame and travel match the clips. From cancelAt on, the recovery gives way to the next hit, to running or to a dash.
// Shake is in world units, tier scales the impact effects. `more` lists the further thrusts of one clip, each overriding what it needs.
export const LIGHT_CHAIN: Attack[] = [
  { action: 'light1', duration: 4 * F, hitAt: 1 * F, cancelAt: 2 * F, damage: 10, range: 3.9, width: 0.6, travel: 0.60 * M, stun: 0.2, push: 0.35, hitstop: 0.05, shake: 0.05, tier: 0 },
  { action: 'light1', duration: 4 * F, hitAt: 1 * F, cancelAt: 2 * F, damage: 12, range: 3.9, width: 0.7, travel: 0.60 * M, stun: 0.22, push: 0.4, hitstop: 0.055, shake: 0.06, tier: 0 },
  { action: 'flurry', duration: 10 * F, hitAt: 1 * F, cancelAt: 8 * F, interruptAt: 2 * F, damage: 5, range: 4.1, width: 0.7, travel: 0.85 * M, stun: 0.12, push: 0.12, hitstop: 0.02, shake: 0.03, tier: 0,
    more: [{ at: 3 * F }, { at: 5 * F }, { at: 7 * F, damage: 7, stun: 0.34, push: 1, hitstop: 0.09, shake: 0.14, tier: 1 }] },
];
// An attack that leaves a dash, or follows one within DASH_LINGER, comes straight out of the glide as a longer thrust worth 1.3 of the first hit.
export const DASH_THRUST: Attack = { action: 'dash_attack', duration: 3 * F, hitAt: 1 * F, cancelAt: 2 * F, damage: 13, range: 3.9, width: 0.7, travel: 0.60 * M, stun: 0.22, push: 0.4, hitstop: 0.055, shake: 0.06, tier: 0 };
const DASH_LINGER = 0.2;
// Holding the attack button past holdAfter starts the charge; letting go releases it, and it goes by itself once full. The blow grows from weak to strong with the time held.
export const CHARGE = {
  holdAfter: 0.4, windup: 2 * F, full: 0.8, cost: 12, moveShare: 0.35,
  attack: { action: 'charge_release', duration: 5 * F, hitAt: 1 * F, cancelAt: 3 * F, width: 0.9, travel: 1.45 * M },
  weak: { damage: 20, range: 4.8, stun: 0.4, push: 1.2, hitstop: 0.11, shake: 0.2, tier: 1 } as Blow,
  strong: { damage: 30, range: 6, stun: 0.6, push: 1.8, hitstop: 0.17, shake: 0.36, tier: 2 } as Blow,
};
export const ATTACK_LABELS: Record<AttackKind, (index: number) => string> = { light: index => `轻击 ${index + 1} / ${LIGHT_CHAIN.length}`, charge: () => '蓄力刺' };
// How the endless trial grows, per room: enemy life, what hits her, and what she gets back on the way to the next room.
const TRIAL_LIFE = .08, TRIAL_HITS = .04, TRIAL_HEAL = 15, COMBO_WINDOW = 0.4, BUFFER = 0.3, DASH_TIME = 0.25, DASH_SPEED = 18, DASH_CHARGES = 2, RUN_SPEED = 6.5, RUN_RESPONSE = 0.035, KNOCK_DECAY = 10, HERO_RADIUS = 0.32, KILL_STOP = 0.04, BOSS_STOP = 0.22, SLOWMO_RATE = 0.3, CLEAR_DELAY = 1.1, WAVE_GAP = 2, ROOM_FADE = 0.3;
export const DASH_RECHARGE = 1;
const LOCK_RANGE = 7, LOCK_AIM = 0.12, LOCK_MOVE = 0.8, LOCK_STICKINESS = 0.6;
const START_AWAKEN = 0, AWAKEN_PER_B = 1, AWAKEN_RATE = 3;
// Enemies that have just come out of the wall show as a marker for this long, and cannot act or be touched.
const ARRIVE = .6;
// Liang Wenfeng's fist, timed from the cast, one thing after another: the avatar slides in and shows himself, he leaves, and only then does the fist come out of the corner of the screen and land, and the ground shakes. It has no direction, it lands on the thickest crowd in reach.
export const ULT = { cost: 100, duration: 16 * F, confirmAt: 2 * F, avatarAt: 3 * F, avatarOutAt: 8 * F, fistAt: 10 * F, punchAt: 13 * F, shockAt: 15 * F, reach: 16, radius: 5, damage: 20 * B, shockRadius: 9, shockDamage: 5 * B, bossStagger: 50 };
const travelCurve = (p: number) => 1 - (1 - clamp(p, 0, 1)) ** 2;

// The mechanisms of a room go through the four states of the spec, and stop for good once the room is cleared. They hurt both sides, so an enemy can be led into one.
export type TrapState = 'idle' | 'warn' | 'strike' | 'recover' | 'off';
// `rail` is the floor its mark covers and `area` where it acts right now: part of the rail for a shelf or stamper, the outgoing line for a valve or mirror, and the gap for a scan. A mirror's bolt also runs along `feed`.
// `step` counts tiles along a shelf's rail or the blows of a stamper, `back` means it is working its rail the other way, `sweep` is how far a ring or line has run, or the time since a shelf's last tile or an erased floor's last bite.
export interface Trap extends Vec2 { id: number; kind: TrapPlan['kind']; state: TrapState; timer: number; dir: Vec2; area: Area; rail: Area; feed: Area | null; size: number; step: number; back: boolean; sweep: number; lock: number; hit: Set<number>; used: boolean; plan: TrapPlan }
export const PRESS = { warn: 0.9, strike: 0.18, recover: 0.5, rest: 2.6, heroDamage: 16, enemyDamage: 30 };
export const VALVE = { warn: 0.5, strike: 0.25, recover: 6, rest: 0, heroDamage: 16, enemyDamage: 60, halfWidth: 1.1 };
export const BELT = { speed: 3, enemyShare: 0.6 }; // Slower on enemies than they walk, so a belt can delay one but never keep it from the hero.
export const SHELF = { warn: 0.9, strike: 0, recover: 0.2, rest: 3.6, heroDamage: 12, enemyDamage: 24, stride: 0.2 }; // Seconds a tile. Its strike lasts as long as the rail takes.
export const MIRROR = { warn: 0.9, strike: 0.25, recover: 0.3, rest: 3.8, heroDamage: 16, enemyDamage: 60, halfWidth: 0.75, turnLock: 1 }; // Long enough that the four thrusts of a flurry turn it only once.
export const VENT = { warn: 0.8, strike: 2, recover: 0.2, rest: 3.4, heroDamage: 11, enemyDamage: 36, speed: 7, width: 0.9, gapHalf: 0.55 };
export const STAMPER = { warn: 0.55, strike: 0.14, recover: 0.2, rest: 2.6, heroDamage: 18, enemyDamage: 40, second: 0.35, last: 1 }; // The warnings before the second and the late third blow.
export const SCAN = { warn: 1.4, strike: 0, recover: 0.1, rest: 6, heroDamage: 20, enemyDamage: 40, speed: 8, width: 0.5 }; // Its strike lasts as long as crossing the room takes.
export const ERASE = { warn: 1.1, strike: 4, recover: 0.5, rest: 3.4, heroDamage: 6, enemyDamage: 10, tick: 0.5 };
export const BEACON = { warn: 0, strike: 0, recover: 6, rest: 0, heroDamage: 0, enemyDamage: 0 };
export const TIMES = { press: PRESS, valve: VALVE, shelf: SHELF, mirror: MIRROR, vent: VENT, stamper: STAMPER, scan: SCAN, erase: ERASE, beacon: BEACON };
type Timed = keyof typeof TIMES;
export const warnTime = (t: Trap) => t.kind === 'stamper' ? [STAMPER.warn, STAMPER.second, STAMPER.last][t.step] : TIMES[t.kind as Timed].warn;
const SOLID_TRAPS = ['valve', 'mirror', 'vent', 'beacon'], HERO_ID = -1; // Stands in for her among the ids a mechanism has already hit.
export const DIRS: Record<Dir, Vec2> = { 'x+': { x: 1, z: 0 }, 'x-': { x: -1, z: 0 }, 'z+': { x: 0, z: 1 }, 'z-': { x: 0, z: -1 } };
export type RoomState = 'cleared' | 'current' | 'open' | 'locked';

export interface Enemy extends Vec2 {
  id: number; vx: number; vz: number; hp: number; maxHp: number; radius: number; boss: boolean; speed: number; windup: number; cooldown: number; flash: number; stun: number; attackX: number; attackZ: number; side: number; direction: number;
  // What it is and how it fights. A 'plain' enemy keeps the simple walk-up-and-swing, for tests and custom levels. facing is its true heading in radians, which shields and armour are read from.
  wallMark: number; kind: EnemyKind; art: string; facing: number; ai: AiState; shieldHp: number; shieldBy: number; shieldTime: number; arrive: number;
  // What summons have done to it. allied: fights for the hero. charm: cannot attack. lured: an elite pulled to the decoy. sealed: Claude's seal. wallCheck: the train's push can still hurt it against a wall.
  elite: boolean; allied: number; alliedImmune: number; charm: number; charmImmune: number; charmBonus: number; broken: number; breakPct: number; lured: number; sealed: number; weak: Weaken[]; stagger: number; staggered: number; staggerLock: number; wallCheck: number; alliedAttack: boolean;
}
const calm = () => ({ wallMark: 0, kind: 'plain' as EnemyKind, art: 'e01', facing: 0, ai: freshAi(), shieldHp: 0, shieldBy: 0, shieldTime: 0, arrive: 0, elite: false, allied: 0, alliedImmune: 0, charm: 0, charmImmune: 0, charmBonus: 0, broken: 0, breakPct: 0, lured: 0, sealed: 0, weak: [] as Weaken[], stagger: 0, staggered: 0, staggerLock: 0, wallCheck: 0, alliedAttack: false });
export interface CardSlot { id: CardId; cooldown: number; level: number; branch: Branch | null; boost: number }
export interface Hero extends Vec2 {
  rescued: boolean; bench: CardSlot[]; token: number; tokenMax: number; tokenBudget: number; attackPaid: boolean; zeroCharges: number; zeroRefund: number; haste: number; hasteTime: number; healBudget: number; cards: CardSlot[]; cardGap: number; cardBuffer: number; cardBufferTime: number; summon: { slot: number; age: number; confirmed: boolean } | null;
  vx: number; vz: number; hp: number; aim: Vec2; heading: Vec2; cardBufferAim: Vec2 | null; lockId: number | null; direction: number; action: string; age: number; moving: boolean;
  maxHp: number; coins: number; mods: WeaponMod[]; iconBonus: boolean; refractReady: boolean; comboCd: Record<string, number>; slow: number; slowTime: number; tokenLock: number; noHeal: number; lastDash: Vec2; dash: number; dashLinger: number; dashCharges: number; dashCooldown: number; dashBuffer: number; dashAim: Vec2; invulnerable: number;
  attack: Attack | null; attackAge: number; attackHit: boolean; attackMore: number; attackIndex: number; travel: number; travelAim: Vec2;
  combo: AttackKind | null; comboIndex: number; comboTimer: number; buffer: AttackKind | null; bufferTime: number; attackHeld: boolean; holdTime: number; holdDenied: boolean; charge: number | null;
  awaken: number; awakenBudget: number; ult: boolean; ultAge: number; ultBuffer: number; ultTarget: Vec2;
}
export interface ShopItem { name: string; text: string; icon: string; price: number; sold: boolean; reward: Reward }
// The door to a fight forks: the supply road keeps the fight as planned and pays only supplies, the risky one adds an enemy to each wave and pays the usual upgrades.
export type Route = '' | 'supply' | 'risk';
export interface RunSnapshot { route?: Route; levelIndex: number; roomIndex: number; kills: number; time: number; hero: { hp: number; maxHp: number; coins: number; mods: WeaponMod[]; iconBonus: boolean; token: number; tokenMax: number; awaken: number; rescued: boolean; healBudget: number; cards: CardSlot[]; bench: CardSlot[] } }
export interface GameInput { interact?: boolean; moveX?: number; moveZ?: number; aimX?: number; aimZ?: number; aimTargetId?: number; attack?: boolean; attackEdges?: boolean[]; dash?: boolean; ult?: boolean; card?: number }

export class Game {
  state = 'ready'; time = 0; wave = 0; kills = 0; events: GameEvent[] = []; enemies: Enemy[] = []; nextId = 1; nextWave = 0; hitstop = 0; slowmo = 0;
  hero!: Hero;
  levels: Level[]; levelIndex = 0; roomIndex = 0; room!: Room; traps: Trap[] = []; cleared = false; leaving = 0;
  reward: { options: Reward[] } | null = null;
  shop: ShopItem[] | null = null;
  // The endless trial's count of rooms, one of which she is in. It unlocks nothing, saves nothing and only ends when she falls.
  trial: { room: number } | null = null;
  route: Route = '';
  // The back door for checking the game: nothing hurts her and Token stays full. It outlasts a run.
  god = false;
  unlocked = new Set<CardId>(BASE_CARDS);
  blasts: Blast[] = []; shots: Shot[] = []; mines: Mine[] = []; rings: HeatRing[] = []; blocks: Block[] = []; sideMirrors: (Vec2 & { id: number })[] = []; lastFire = -9; actionLog: string[] = []; prompt: (Vec2 & { text: string; id: number }) | null = null;
  loadout: CardId[] = [...DEFAULT_LOADOUT]; decoy: Decoy | null = null; trains: Train[] = []; prisms: Prism[] = []; seals: Seal[] = []; blitzes: Blitz[] = [];
  private fields = new Map<number, Int32Array>();
  constructor(levels: Level | Level[] = CAMPAIGN) { this.levels = Array.isArray(levels) ? levels : [levels]; this.reset(); }
  get level() { return this.levels[this.levelIndex]; }
  get plan() { return this.level.rooms[this.roomIndex]; }
  reset() {
    this.state = 'ready'; this.time = 0; this.kills = 0; this.events = []; this.nextId = 1; this.levelIndex = 0; this.reward = null; this.shop = null; this.trial = null; this.route = '';
    this.hero = { rescued: false, bench: [], token: TOKEN.start, tokenMax: TOKEN.max, tokenBudget: TOKEN.rate, attackPaid: false, zeroCharges: 0, zeroRefund: 0, haste: 0, hasteTime: 0, healBudget: SEED.budget, cards: this.loadout.map(freshCard), cardGap: 0, cardBuffer: 0, cardBufferTime: 0, cardBufferAim: null, summon: null,
      x: 0, z: 0, vx: 0, vz: 0, hp: 100, aim: unit(1, 0), heading: unit(1, 0), lockId: null, direction: 3, action: 'idle', age: 0, maxHp: 100, coins: 0, mods: [], iconBonus: false, refractReady: false, comboCd: {}, slow: 0, slowTime: 0, tokenLock: 0, noHeal: 0, lastDash: unit(1, 0), dash: 0, dashLinger: 0, dashCharges: DASH_CHARGES, dashCooldown: 0, dashBuffer: 0, dashAim: unit(1, 0), invulnerable: 0, moving: false,
      attack: null, attackAge: 0, attackHit: false, attackMore: 0, attackIndex: 0, travel: 0, travelAim: unit(1, 0), combo: null, comboIndex: 0, comboTimer: 0, buffer: null, bufferTime: 0, attackHeld: false, holdTime: 0, holdDenied: false, charge: null,
      awaken: START_AWAKEN, awakenBudget: AWAKEN_RATE, ult: false, ultAge: 0, ultBuffer: 0, ultTarget: { x: 0, z: 0 } };
    this.enterRoom(0);
  }
  // A run starts at the first room unless it is told which, and that way in is the back door: fresh and alive in any room of any region, as if the run had begun there.
  start(roomId?: string | null) {
    this.reset();
    for (const [region, level] of this.levels.entries()) {
      const index = level.rooms.findIndex(r => r.id === roomId);
      if (index >= 0) { this.events = []; this.enterRoom(index, region); }
    }
    this.state = 'playing'; this.beginRoom();
  }
  // Trials use the same permanent album as story runs.
  startTrial() {
    this.reset(); this.trial = { room: 1 }; this.hero.rescued = this.unlocked.has('claude'); this.events = [];
    const next = trialRoom(this.levels, 1, ''); this.enterRoom(next.index, next.region);
    this.state = 'playing'; this.beginRoom();
  }
  private trialGrowth(rate: number) { return this.trial ? 1 + rate * (this.trial.room - 1) : 1; }
  // Enough to put a run back at the start of the room it was saved in.
  snapshot(): RunSnapshot {
    const h = this.hero, keep = ({ id, level, branch, boost }: CardSlot): CardSlot => ({ id, cooldown: 0, level, branch, boost });
    return { route: this.route, levelIndex: this.levelIndex, roomIndex: this.roomIndex, kills: this.kills, time: this.time, hero: { hp: h.hp, maxHp: h.maxHp, coins: h.coins, mods: [...h.mods], iconBonus: h.iconBonus, token: h.token, tokenMax: h.tokenMax, awaken: h.awaken, rescued: h.rescued, healBudget: h.healBudget, cards: h.cards.map(keep), bench: h.bench.map(keep) } };
  }
  restore(run: RunSnapshot, trialRoom = 0) {
    this.loadout = run.hero.cards.map(card => card.id); this.reset();
    if (trialRoom) this.trial = { room: trialRoom };
    this.route = run.route ?? '';
    Object.assign(this.hero, run.hero, { cards: run.hero.cards.map(card => ({ ...card })), bench: run.hero.bench.map(card => ({ ...card })) });
    this.kills = run.kills; this.time = run.time; this.events = [];
    this.enterRoom(run.roomIndex, run.levelIndex); this.state = 'playing'; this.beginRoom();
  }
  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }
  emit(...[type, data]: GameEventArgs) { this.events.push({ type, ...data } as GameEvent); }
  // The hero arrives just inside the door she came through, with the same health as she left the last room. The door is shut behind her.
  enterRoom(index: number, region = this.levelIndex) {
    this.levelIndex = region; this.roomIndex = index;
    const plan = this.plan, h = this.hero;
    this.room = parseRoom(plan.map); this.fields.clear();
    this.traps = this.buildTraps(plan);
    this.enemies = []; this.wave = 0; this.nextWave = 0; this.cleared = false; this.leaving = 0; this.hitstop = 0; this.slowmo = 0;
    this.decoy = null; this.trains = []; this.prisms = []; this.seals = []; this.blitzes = [];
    this.blasts = []; this.shots = []; this.mines = []; this.rings = []; this.blocks = []; this.sideMirrors = []; this.lastFire = -9; this.actionLog = []; this.prompt = null;
    // Every new room starts with the cards ready. Health and Token carry over.
    for (const card of h.cards) card.cooldown = 0;
    Object.assign(h, { x: this.room.start.x, z: this.room.start.z, vx: 0, vz: 0, dash: 0, attack: null, travel: 0, charge: null, ult: false, buffer: null, bufferTime: 0, combo: null, comboTimer: 0, moving: false, summon: null, zeroCharges: 0, zeroRefund: 0, hasteTime: 0, cardGap: 0, cardBufferTime: 0, cardBufferAim: null });
    this.setAction('idle');
    const inward = this.room.entrance?.inward;
    if (inward) { h.heading = { ...inward }; h.aim = { ...inward }; h.direction = facing(inward.x, inward.z, h.direction); }
    this.emit('roomEnter', { id: plan.id, name: plan.name, level: index === 0 ? this.level.name : '', trialRoom: this.trial?.room });
  }
  private beginRoom() { if (this.plan.waves.length) this.spawnWave(); else this.clearRoom(); }
  private buildTraps(plan: RoomPlan): Trap[] {
    const m = this.room, plans = Object.entries(plan.traps ?? {});
    // Some mechanisms are solid, and every blast has to stop at the others.
    for (const [mark, t] of plans) if (SOLID_TRAPS.includes(t.kind)) setTiles(m, m.marks[mark], MACHINE);
    const traps = plans.map(([mark, t], id): Trap => {
      const rail = m.marks[mark], dir = 'dir' in t ? DIRS[t.dir] : { x: 0, z: 0 };
      const trap: Trap = { id, kind: t.kind, state: 'idle', timer: 'delay' in t ? t.delay : 0, x: rail.x, z: rail.z, dir, area: rail, rail, feed: null, size: 'size' in t ? t.size : 1, step: 0, back: false, sweep: 0, lock: 0, hit: new Set(), used: false, plan: t };
      if (t.kind === 'valve') trap.area = lineFrom(m, rail, dir, VALVE.halfWidth);
      if (t.kind === 'shelf') { trap.area = slotOn(rail, dir, trap.size, 0); setTiles(m, trap.area, MACHINE); }
      if (t.kind === 'stamper') trap.area = this.stamperSlot(trap);
      if (t.kind === 'scan') trap.area = this.scanGap(trap);
      return trap;
    });
    // Lines are worked out last, once every shelf stands where it starts.
    for (const t of traps) if (t.kind === 'mirror') this.aimMirror(t);
    return traps;
  }
  private aimMirror(t: Trap) {
    if (t.plan.kind !== 'mirror') return;
    t.feed = lineFrom(this.room, t, DIRS[t.plan.from], MIRROR.halfWidth); t.area = lineFrom(this.room, t, t.dir, MIRROR.halfWidth);
  }
  // Start, middle and end of the rail, in the order it is working it.
  private stamperSlot(t: Trap) {
    const spare = railTiles(t.rail, t.dir) - t.size, blow = t.back ? 2 - t.step : t.step;
    return slotOn(t.rail, t.dir, t.size, blow * spare / 2);
  }
  // A scan's gap, as wide as its mark, across the whole room.
  private scanGap(t: Trap): Area {
    const halfX = this.room.cols * TILE / 2 - TILE, halfZ = this.room.rows * TILE / 2 - TILE;
    return t.dir.x ? { x: 0, z: t.rail.z, halfX, halfZ: t.rail.halfZ } : { x: t.rail.x, z: 0, halfX: t.rail.halfX, halfZ };
  }
  // The scan line as it stands: the stretches of it on either side of the gap.
  scanLines(t: Trap): Area[] {
    const m = this.room, gap = t.area, half = SCAN.width / 2, along = t.dir.x ? t.dir.x * (t.sweep - gap.halfX) : t.dir.z * (t.sweep - gap.halfZ);
    const end = (t.dir.x ? m.rows : m.cols) * TILE / 2 - TILE, middle = t.dir.x ? gap.z : gap.x, spread = t.dir.x ? gap.halfZ : gap.halfX, lines: Area[] = [];
    for (const [a, b] of [[-end, middle - spread], [middle + spread, end]]) {
      if (b <= a) continue;
      lines.push(t.dir.x ? { x: along, z: (a + b) / 2, halfX: half, halfZ: (b - a) / 2 } : { x: (a + b) / 2, z: along, halfX: (b - a) / 2, halfZ: half });
    }
    return lines;
  }
  private inHeat(t: Trap, x: number, z: number, r: number) {
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz);
    return Math.abs(d - t.sweep) < VENT.width / 2 + r && (dx * t.dir.x + dz * t.dir.z) / (d || 1) < Math.cos(VENT.gapHalf);
  }
  // Only a door to another fight forks. The trial does not know where it goes next.
  forksAhead() { return !this.trial && !!this.room.exit && this.level.rooms[this.roomIndex + 1]?.kind === 'battle'; }
  routeAt(at: Vec2): Route { const d = this.room.exit!; return (d.alongX ? at.x - d.center.x : at.z - d.center.z) < 0 ? 'supply' : 'risk'; }
  // Which rooms of the level the pause map may show: those walked through, this one, and the next once its door is open.
  roomStates(): RoomState[] {
    return this.level.rooms.map((_, i) => i < this.roomIndex ? 'cleared' : i === this.roomIndex ? 'current' : i === this.roomIndex + 1 && this.cleared ? 'open' : 'locked');
  }
  private clearRoom() {
    this.cleared = true; this.blasts = []; this.shots = []; this.mines = []; this.rings = []; this.blocks = []; this.sideMirrors = [];
    for (const t of this.traps) if (t.kind !== 'pad') t.state = 'off';
    if (this.plan.kind === 'boss' && !this.trial) { this.bossBeaten(); if (this.room.exit) this.emit('bossClear'); }
    if (!this.room.exit && !this.trial) { this.state = 'won'; this.emit('won'); return; } // Only the very last room has no way on.
    if (this.room.exit) { openDoor(this.room, this.room.exit); this.emit('doorOpen'); }
    if (this.plan.kind === 'battle' || (this.trial && this.plan.waves.length)) this.offerReward();
  }
  // A first win writes the partners into the album, for good and usable at once.
  private bossBeaten() {
    const ids = UNLOCKS[this.plan.id] ?? [], fresh = ids.filter(id => !this.unlocked.has(id));
    for (const id of fresh) this.unlocked.add(id);
    if (ids.includes('claude')) this.hero.rescued = true;
    if (ids.length) this.emit('unlock', { fresh });
  }
  // Who she could bring along right now.
  cardChoices() {
    return [...this.unlocked];
  }
  // The story keeps the top level for its last regions. A trial has no such order.
  private cardCap() { return this.trial ? undefined : levelCap(this.plan.id); }
  // The fight holds still until a choice is made, so no cooldown runs and nothing can hit her.
  private offerReward() {
    const pool = this.cardChoices().filter(id => !this.hero.cards.some(card => card.id === id));
    const options = this.route === 'supply' ? supplyOptions(this.hero) : rewardOptions(this.hero, this.cardCap(), pool);
    this.reward = { options }; this.state = 'reward'; this.emit('reward', { options });
  }
  chooseReward(index: number) {
    const picked = this.reward?.options[index];
    if (!picked) return;
    applyReward(this.hero, picked);
    this.reward = null; this.state = 'playing';
    this.emit('rewardTaken', { ...picked, x: this.hero.x, z: this.hero.z });
  }
  // A supply room's stock: what keeps her going, one mod, and upgrades to the cards she carries. Prices are in the coins kills pay.
  private openShop() {
    const h = this.hero, upgrades = allUpgrades(h, this.cardCap());
    const mod = modOffer(h)[0];
    this.shop = [
      { name: '紧急修复', text: '回复 30 生命', icon: 'reward-life', price: 8, sold: false, reward: { kind: 'heal', name: '紧急修复', text: '' } },
      { name: '算力补给', text: '回复 40 Token', icon: 'res-token', price: 8, sold: false, reward: { kind: 'refill', name: '算力补给', text: '' } },
      ...(h.tokenMax < TOKEN_CEILING ? [{ name: '扩容', text: 'Token 上限 +10', icon: 'reward-tokencap', price: 15, sold: false, reward: { kind: 'cap', name: '扩容', text: '' } as Reward }] : []),
      ...(mod ? [{ name: mod.name, text: mod.text, icon: 'reward-weapon', price: 25, sold: false, reward: mod }] : []),
      ...upgrades.map(reward => ({ name: reward.name, text: `${CARDS[reward.id].name} · ${reward.text}`, icon: 'reward-upgrade', price: 20, sold: false, reward })),
    ];
    this.state = 'shop'; this.emit('shop', { items: this.shop });
  }
  buy(index: number) {
    const item = this.shop?.[index], h = this.hero;
    if (!item || item.sold || item.price > h.coins) return;
    h.coins -= item.price; item.sold = true; applyReward(h, item.reward);
    // Once a branch is chosen the other one of that card is gone, and so is any upgrade the card has outgrown.
    if (item.reward.kind === 'upgrade') for (const other of this.shop!) if (other !== item && other.reward.kind === 'upgrade' && other.reward.slot === item.reward.slot) other.sold = true;
    this.emit('shopBuy', { name: item.name });
  }
  closeShop() { if (this.state === 'shop') { this.shop = null; this.state = 'playing'; this.emit('shopClosed'); } }
  // The event rooms end in a choice from their scene.
  chooseStory(index: number) {
    if (this.state !== 'dialog') return;
    const effect = STORY[this.plan.id]?.choices?.[index]?.effect, h = this.hero;
    this.state = 'playing';
    if (effect === 'cap') { h.tokenMax = Math.min(TOKEN_CEILING, h.tokenMax + 10); h.token = Math.min(h.tokenMax, h.token + 10); }
    if (effect === 'icon') h.iconBonus = true;
    if (effect === 'mod') { const mod = modOffer(h)[0]; if (mod) h.mods = [...h.mods, mod.mod]; this.emit('modGained', { name: mod ? MODS[mod.mod].name : '' }); }
    if (effect === 'upgrade') this.offerReward();
    this.emit('storyDone');
  }
  // Between regions, out of the fight. She can rearrange the team from everyone she has; a card left off keeps its level for this run.
  confirmPrep(ids?: CardId[]) {
    if (this.state !== 'prep') return;
    const h = this.hero, owned = [...h.cards, ...h.bench], allowed = this.cardChoices();
    const chosen = [...new Set(ids ?? h.cards.map(card => card.id))].filter(id => allowed.includes(id)).slice(0, SLOTS);
    h.cards = chosen.map(id => owned.find(card => card.id === id) ?? freshCard(id));
    h.bench = owned.filter(card => !chosen.includes(card.id));
    // A safe place between regions: no one should walk into the next one, least of all the last fight, on what the boss left them.
    h.hp = h.maxHp;
    this.refreshHeal(); this.state = 'playing'; this.enterRoom(0, this.levelIndex + 1); this.beginRoom();
  }
  // Seed's healing is budgeted per region.
  private refreshHeal() { const h = this.hero, seed = [...h.cards, ...h.bench].find(card => card.id === 'seed'); h.healBudget = seed ? seedStats(seed).budget : SEED.budget; }
  // Enemies come out of the walls a little way off, far enough not to appear on top of the hero or on a working trap, and walk to her.
  spawnWave() {
    const plan = this.plan.waves[this.wave];
    this.wave++; this.nextWave = 0;
    // The risky road brings one more of the last ordinary enemy the wave names, which the table keeps for the lightest.
    const extra = this.route === 'risk' ? plan.units?.findLast(kind => /^e\d\d$/.test(kind)) : undefined, units = extra ? [...plan.units!, extra] : plan.units;
    const count = units?.length ?? plan.count, m = this.room, field = distanceField(m, this.hero), places: { c: number; r: number }[] = [];
    const roomy = (c: number, r: number, reach: number) => { for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) if (wallAtTile(m, c + x, r + y)) return false; return true; };
    const onTrap = (c: number, r: number) => { const at = tileCenter(m, c, r); return this.traps.some(t => !SOLID_TRAPS.includes(t.kind) && inArea(t.rail, at.x, at.z, 0.5)); };
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) { const d = field[r * m.cols + c]; if (d >= 9 && roomy(c, r, 1) && !onTrap(c, r)) places.push({ c, r }); }
    for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
    const spread = (a: { c: number; r: number }, chosen: { c: number; r: number }[]) => chosen.every(b => Math.abs(a.c - b.c) + Math.abs(a.r - b.r) > 2);
    const chosen: { c: number; r: number }[] = [];
    for (const place of places) { if (chosen.length === count) break; if (spread(place, chosen)) chosen.push(place); }
    for (const place of places) { if (chosen.length === count) break; if (!chosen.includes(place)) chosen.push(place); } // A tight corner of the room may not have space to keep them apart.
    const bossPlace = chosen.findIndex(p => roomy(p.c, p.r, 2));
    // A team of worms shares a number, and the first of them leads.
    const worms = this.wave * 1000 + this.levelIndex, already = this.enemies.length;
    let leader = 0;
    chosen.forEach((place, i) => {
      const unit = units?.[i], boss = unit ? unit.startsWith('b') : !!plan.boss && i === (bossPlace >= 0 ? bossPlace : 0), at = tileCenter(m, place.c, place.r);
      if (unit && !boss) {
        const e = makeEnemy(this, unit, at, { cooldown: 1 + i * .14 });
        if (unit === 'e01') { e.ai.team = worms; leader ||= e.id; e.ai.lead = leader; }
        return;
      }
      const hp = boss ? plan.bossHp ?? 420 : plan.hp, spot = unit === 'b03' ? ICON_SPOT(this) : unit === 'b04' ? { x: 0, z: 0 } : at;
      this.enemies.push(this.newEnemy({ x: spot.x, z: spot.z, hp, maxHp: hp, radius: unit === 'b03' ? 2.4 : boss ? 0.8 : 0.42, boss, speed: unit === 'b03' || unit === 'b04' ? 0 : boss ? 1.8 : 2.2 + this.wave * 0.15, cooldown: 1 + i * 0.14, kind: unit ?? 'plain' }));
    });
    // A boss comes on with its entrance, and gives her a moment to see it.
    for (const e of this.enemies.slice(already)) { e.arrive = ARRIVE; if (e.boss) { playClip(e, 'enter'); e.cooldown = Math.max(e.cooldown, 1); } }
    this.emit('wave', { wave: this.wave, spawns: this.enemies.map(e => ({ x: e.x, z: e.z, boss: e.boss, kind: e.kind })) });
  }
  newEnemy(over: Partial<Enemy>): Enemy {
    const e: Enemy = { id: this.nextId++, x: 0, z: 0, vx: 0, vz: 0, hp: 1, maxHp: 1, radius: .42, boss: false, speed: 2, windup: 0, cooldown: 1, flash: 0, stun: 0, attackX: 0, attackZ: 0, side: 1, direction: 3, ...calm(), ...over };
    e.art = artOf(e.kind);
    // What is only a target keeps its life, since the number of hits it takes is part of its rule.
    if (!notCounted(e)) e.hp = e.maxHp = Math.round(e.maxHp * this.trialGrowth(TRIAL_LIFE));
    return e;
  }
  // Manual aim stays exact. Automatic aim follows a nearby enemy with a small
  // preference for the current target; moving outside the cone releases it.
  lockOn(aim: Vec2 | null, move: Vec2 | null, preferredId?: number) {
    const h = this.hero, wanted = aim || move, cone = aim ? LOCK_AIM : LOCK_MOVE;
    let best: Enemy | null = null, score = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.allied > 0 || e.arrive > 0) continue;
      const x = e.x - h.x, z = e.z - h.z, d = Math.hypot(x, z);
      if (d > LOCK_RANGE || (e.kind !== 'b03' && !lineClear(this.room, h, e))) continue;
      const off = wanted && d > 0.001 ? Math.acos(clamp((x * wanted.x + z * wanted.z) / d, -1, 1)) : 0;
      const pointed = !!aim && e.id === preferredId;
      if (!pointed && off > cone) continue;
      const s = pointed ? -Infinity : aim ? off * 100 + d * .001 : d + off * 4 - (e.id === h.lockId ? LOCK_STICKINESS : 0);
      if (s < score) { score = s; best = e; }
    }
    h.lockId = best ? best.id : null;
    // With no enemy in reach anything ready for the blade draws the attack, so it can be stabbed without a mouse.
    let target: Trap | null = null, nearest = LOCK_RANGE;
    if (!best && !aim) for (const t of this.traps) {
      if (!this.stabbable(t) || !this.bladeReaches(t)) continue;
      const x = t.x - h.x, z = t.z - h.z, d = Math.hypot(x, z), off = wanted ? Math.acos(clamp((x * wanted.x + z * wanted.z) / d, -1, 1)) : 0;
      if (d < nearest && off <= cone) { nearest = d; target = t; }
    }
    // Standing right on top of the target gives no direction to aim in, and an aim of nothing hits nothing.
    const toBest = best ? unit(best.x - h.x, best.z - h.z) : target ? unit(target.x - h.x, target.z - h.z) : null;
    return aim || (toBest && (toBest.x || toBest.z) ? toBest : move || h.heading);
  }
  private bladeHits(e: Enemy, origin: Vec2, aim: Vec2, range: number, width: number) {
    return (inThrust(origin, aim, e, range, width) || bladeTouches(origin, aim, { x: e.x, z: e.z, ...bodyOf(e) }, range, width / 3))
      && (e.kind === 'b03' || lineClear(this.room, origin, e));
  }
  // Predict the next blow's reach using the same geometry as strike(), including
  // its lunge and walls. Selection alone does not mean the blade can reach it.
  targetInRange(e: Enemy) {
    const h = this.hero;
    if (e.hp <= 0 || e.allied > 0 || e.arrive > 0) return false;
    const next = h.dashLinger > 0 ? DASH_THRUST : LIGHT_CHAIN[h.combo === 'light' && h.comboTimer > 0 ? (h.comboIndex + 1) % LIGHT_CHAIN.length : 0];
    const charge = h.charge !== null, a = charge ? CHARGE.attack : next;
    const k = clamp((h.charge ?? 0) / CHARGE.full, 0, 1);
    const range = charge ? CHARGE.weak.range + (CHARGE.strong.range - CHARGE.weak.range) * k : next.range;
    const width = a.width * (charge && h.mods.includes('wide') ? 1.4 : 1);
    const travel = a.travel * travelCurve(a.hitAt / a.duration);
    const at = slide(this.room, h.x, h.z, h.aim.x * travel, h.aim.z * travel, HERO_RADIUS);
    return this.bladeHits(e, at, h.aim, range, width);
  }
  // Its own tile is solid, so the look stops just short of it.
  private bladeReaches(t: Trap) {
    const h = this.hero, d = Math.hypot(h.x - t.x, h.z - t.z);
    return d <= TILE || lineClear(this.room, h, { x: t.x + (h.x - t.x) / d * TILE, z: t.z + (h.z - t.z) / d * TILE });
  }
  // Which mechanisms answer to the blade right now: a valve at rest, a mirror unless it is firing, a beacon with something to bring back.
  stabbable(t: Trap) {
    if (t.kind === 'valve') return t.state === 'idle';
    if (t.kind === 'mirror') return t.state !== 'strike' && t.state !== 'off' && t.lock === 0;
    return t.kind === 'beacon' && t.state === 'idle' && this.traps.some(b => b.kind === 'erase' && (b.state === 'warn' || b.state === 'strike'));
  }
  private stab(t: Trap) {
    const h = this.hero;
    if (t.kind === 'valve') { t.state = 'warn'; t.timer = VALVE.warn; }
    if (t.kind === 'mirror') { t.dir = { x: -t.dir.x, z: -t.dir.z }; t.lock = MIRROR.turnLock; this.aimMirror(t); }
    if (t.kind === 'beacon') {
      const gone = this.traps.filter(b => b.kind === 'erase' && (b.state === 'warn' || b.state === 'strike')), d = (b: Trap) => Math.hypot(b.x - t.x, b.z - t.z), back = gone.reduce((a, b) => d(b) < d(a) ? b : a);
      back.state = 'recover'; back.timer = ERASE.recover; t.state = 'recover'; t.timer = BEACON.recover;
      this.emit('beacon', { x: back.x, z: back.z });
    }
    this.emit('trapStab', { kind: t.kind, x: t.x, z: t.z, dirX: h.aim.x, dirZ: h.aim.z });
  }
  gainAwaken(amount: number) {
    const h = this.hero, paid = Math.min(amount, h.awakenBudget);
    h.awakenBudget -= paid; h.awaken = Math.min(ULT.cost, h.awaken + paid);
  }
  // The statue reads what she has been doing: a whole flurry is one action, and so is a card.
  private logAction(kind: string) { this.actionLog = [...this.actionLog, kind].slice(-3); }
  gainToken(amount: number) {
    const h = this.hero, paid = Math.min(amount, h.tokenBudget);
    h.tokenBudget -= paid; h.token = Math.min(h.tokenMax, h.token + paid);
  }
  // Each Qwen charge pays for one charged thrust or another card, and lasts for this room.
  cardCost(card: CardSlot) { return card.id !== 'qwen' && this.hero.zeroCharges > 0 ? 0 : cardPrice(card); }
  private spendZeroCharge() {
    const h = this.hero;
    if (h.zeroCharges <= 0 || --h.zeroCharges > 0) return;
    const refund = h.zeroRefund;
    h.zeroRefund = 0; h.token = Math.min(h.tokenMax, h.token + refund);
    this.emit('qwenOff', { x: h.x, z: h.z, refund });
  }
  cardRefusal(slot: number) {
    const card = this.hero.cards[slot];
    return !card ? '这个位置没有卡' : card.cooldown > 0 ? '冷却中' : this.cardCost(card) > this.hero.token ? 'Token 不足' : cardRefusal(this, card);
  }
  private refuseCard(slot: number, reason: string) { this.emit('cardDenied', { slot, reason }); }
  private beginSummon(slot: number) {
    const h = this.hero;
    if (h.cardBufferAim) h.aim = { ...h.cardBufferAim };
    h.cardBufferAim = null;
    const reason = this.cardRefusal(slot);
    h.cardBufferTime = 0;
    if (reason) { this.refuseCard(slot, reason); return; }
    h.summon = { slot, age: 0, confirmed: false }; h.attack = null; h.travel = 0; h.vx = h.vz = 0; h.buffer = null; h.bufferTime = 0;
    h.heading = { ...h.aim }; h.direction = facing(h.aim.x, h.aim.z, h.direction);
    this.setAction('summon'); h.age = 0; this.emit('summonStart', { id: h.cards[slot].id, x: h.x, z: h.z });
  }
  private updateSummon(dt: number, moving: boolean) {
    const h = this.hero, s = h.summon!;
    s.age += dt;
    if (!s.confirmed && s.age >= SUMMON.confirmAt) {
      const reason = this.cardRefusal(s.slot), card = h.cards[s.slot];
      if (reason) { this.refuseCard(s.slot, reason); h.summon = null; return; }
      const free = card.id !== 'qwen' && h.zeroCharges > 0;
      s.confirmed = true; this.logAction('card'); h.token -= this.cardCost(card); card.cooldown = CARDS[card.id].cooldown; h.cardGap = SUMMON.gap; this.hitstop = Math.max(this.hitstop, SUMMON.freeze);
      this.emit('summonConfirm', { id: card.id, slot: s.slot, x: h.x, z: h.z, aim: { ...h.aim } });
      castCard(this, card);
      // Gemini still receives its free-cast combo on the final charge.
      if (free) this.spendZeroCharge();
    }
    if (s.age >= SUMMON.duration || (moving && s.age >= SUMMON.cancelAt)) h.summon = null;
  }
  // Who an enemy goes for. One turned by GLM hunts its old friends. The rest go for a decoy they can reach, then for a turned enemy closer than the hero, then for the hero.
  targetOf(e: Enemy): Vec2 | null {
    const nearest = (list: Enemy[]) => list.reduce<Enemy | null>((best, o) => o !== e && (!best || Math.hypot(o.x - e.x, o.z - e.z) < Math.hypot(best.x - e.x, best.z - e.z)) ? o : best, null);
    if (e.allied > 0) return nearest(hostile(this));
    const decoy = this.decoy, h = this.hero;
    if (decoy && !e.boss && (e.elite ? e.lured > 0 : Math.hypot(decoy.x - e.x, decoy.z - e.z) <= SEED.taunt)) return decoy;
    const friend = nearest(this.enemies.filter(o => o.hp > 0 && o.allied > 0));
    return friend && Math.hypot(friend.x - e.x, friend.z - e.z) < Math.hypot(h.x - e.x, h.z - e.z) ? friend : h;
  }
  // The blow lands on the side the enemy is on: a turned one hits its old friends, any other hits the hero, turned enemies and the decoy alike.
  private landBlow(e: Enemy) {
    const h = this.hero, radius = e.boss ? 2.2 : 1.35, at = { x: e.attackX, z: e.attackZ }, power = e.boss ? 22 : 12, turned = e.alliedAttack;
    this.emit('enemyAttack', { ...at, radius, allied: turned });
    for (const o of this.enemies) {
      if (o === e || o.hp <= 0 || (o.allied > 0) === turned || !inRing(at, o, radius)) continue;
      const push = unit(o.x - at.x, o.z - at.z);
      this.damage(o, turned ? GLM.allyDamage : power, .25, push.x * .4, push.z * .4, false, turned ? 'ally' : 'light', 0);
    }
    if (turned) return;
    if (!h.invulnerable && Math.hypot(h.x - at.x, h.z - at.z) < radius + 0.25) this.hurtHero(Math.round(power * (1 - weakness(e))));
    if (this.decoy && inRing(at, { ...this.decoy, radius: .3 }, radius)) this.emit('decoyHit', { x: this.decoy.x, z: this.decoy.z });
  }
  damage(e: Enemy, damage: number, stun: number, pushX: number, pushZ: number, direct = true, kind = 'light', tier = 0) {
    if (e.hp <= 0 || e.arrive > 0) return;
    if (e.ai.invuln > 0) { this.emit('hit', { id: e.id, x: e.x, z: e.z, damage: 0, kind, tier: 0, boss: e.boss, dirX: 0, dirZ: 0 }); return; }
    const plain = e.kind === 'plain', reward = direct && !noReward(e);
    if (!plain) damage = Math.max(1, Math.round(damage * (1 - armorAgainst(e, kind, this.hero)) * damageTaken(e)));
    if (e.broken > 0) damage = Math.round(damage * (1 + e.breakPct));
    // A woven shield takes it first, unless Claude's seal has shut it off. A hit on it still counts as a hit.
    if (e.shieldHp > 0 && e.sealed <= 0) { const taken = Math.min(e.shieldHp, damage); e.shieldHp -= taken; e.hp += taken; }
    e.hp -= damage; e.flash = 0.16;
    if (plain) {
      e.stun = e.boss ? 0.05 : stun;
      if (!e.boss) {
        e.vx = pushX * KNOCK_DECAY; e.vz = pushZ * KNOCK_DECAY;
        if (stun >= 0.3) { e.windup = 0; e.cooldown = Math.max(e.cooldown, 0.5); } // Solid hits interrupt a normal enemy's attack.
      }
    } else if (!e.boss) {
      const share = knockShare(e); e.vx = pushX * KNOCK_DECAY * share; e.vz = pushZ * KNOCK_DECAY * share;
      if (interrupts(e, tier, kind)) { interrupt(this, e, e.kind === 'e04' ? 5 : .5); e.stun = stun; }
    }
    if (reward) this.gainAwaken(damage / B * AWAKEN_PER_B);
    const dir = unit(pushX, pushZ);
    this.emit('hit', { id: e.id, x: e.x, z: e.z, damage, kind, tier, boss: e.boss, dirX: dir.x, dirZ: dir.z });
    // Two of the bosses do not simply fall: the statue's ring has to be broken by hand, and NULL ends in the rally.
    if (e.hp <= 0 && e.kind === 'b03' && !e.ai.final) { iconBroken(this, e); return; }
    if (e.hp <= 0 && e.kind === 'b04' && !e.ai.rally) { startRally(this, e); return; }
    if (e.hp <= 0) this.kill(e, direct, kind, dir);
  }
  // Execution is a death condition, not another hit for armour or shields to reduce.
  executeEnemy(e: Enemy) {
    if (e.boss || e.hp <= 0 || e.arrive > 0 || e.ai.invuln > 0) return;
    const damage = e.hp; e.hp = 0;
    this.emit('claudeExecute', { x: e.x, z: e.z });
    this.emit('hit', { id: e.id, x: e.x, z: e.z, damage, kind: 'claude', tier: 2, boss: false, dirX: 0, dirZ: 0 });
    this.kill(e, false, 'claude', { x: 0, z: 0 });
  }
  private kill(e: Enemy, direct: boolean, kind: string, dir: Vec2) {
    if (e.kind === 'chain') chainCut(this, e);
    enemyGone(this, e);
    if (!noReward(e)) { this.kills++; this.hero.coins += e.boss ? 20 : e.elite ? 5 : 1; if (direct) { this.hero.awaken = Math.min(ULT.cost, this.hero.awaken + (e.boss || e.elite ? 10 : 2)); this.gainToken(TOKEN.perKill); } }
    this.emit('kill', { id: e.id, x: e.x, z: e.z, boss: e.boss, real: !noReward(e), kind, dirX: dir.x, dirZ: dir.z });
    if (e.boss) this.hitstop = Math.max(this.hitstop, BOSS_STOP);
    if (!this.enemies.some(o => o.hp > 0 && !notCounted(o))) this.slowmo = this.wave < this.plan.waves.length ? 0.4 : this.plan.kind === 'battle' ? 0.6 : 0.9;
  }
  hurtHero(damage: number) {
    if (this.god) return;
    const h = this.hero;
    h.hp = Math.max(0, h.hp - Math.round(damage * this.trialGrowth(TRIAL_HITS))); h.invulnerable = 0.72; this.hitstop = Math.max(this.hitstop, 0.07);
    if (h.summon && !h.summon.confirmed) h.summon = null; // Knocked out of it before the card was shown: nothing is spent.
    this.emit('hurt', { damage, x: h.x, z: h.z });
  }
  strike(a: Attack) {
    const h = this.hero, killsBefore = this.kills;
    let hits = 0, landed = 0;
    // Nearest first along the line, so a shield stops what is behind it.
    const along = (e: Enemy) => (e.x - h.x) * h.aim.x + (e.z - h.z) * h.aim.z, line = this.enemies.filter(e => e.hp > 0 && e.allied <= 0 && e.arrive <= 0 && this.bladeHits(e, h, h.aim, a.range, a.width)).sort((p, q) => along(p) - along(q));
    for (const e of line) {
      if (e.kind === 'phantom' || e.kind === 'b02fake') { e.hp = 0; this.emit('phantomBreak', { x: e.x, z: e.z }); continue; } // No freeze, no Token, no gauge: breaking a false one pays nothing.
      if (shieldFaces(e, h) && !(h.mods.includes('pierce') && a.action === 'flurry')) {
        const breaks = h.combo === 'charge' && (e.kind === 'e02' || a.tier >= CHARGE.strong.tier);
        if (!breaks) { this.emit('shieldBlock', { id: e.id, x: e.x, z: e.z }); hits++; break; }
        breakShield(this, e);
      }
      if (e.ai.final) { this.emit('hit', { id: e.id, x: e.x, z: e.z, damage: 0, kind: 'light', tier: 0, boss: true, dirX: 0, dirZ: 0 }); continue; }
      if (e.ai.invuln <= 0) landed++;
      this.damage(e, e.charm > 0 ? Math.round(a.damage * (1 + e.charmBonus)) : a.damage, a.stun, h.aim.x * a.push, h.aim.z * a.push, true, h.combo ?? 'light', a.tier);
      hits++;
    }
    for (const m of [...this.mines]) if (inThrust(h, h.aim, { x: m.x, z: m.z, radius: .5 }, a.range, a.width) && lineClear(this.room, h, m)) { detonateMine(this, m, true); hits++; }
    // A shield or a stabbed mine stops the blade, but pays nothing.
    if (landed && h.combo === 'light' && !h.attackPaid) { h.attackPaid = true; if (h.tokenLock <= 0) this.gainToken(TOKEN.perHit); }
    for (const t of this.traps) {
      if (!this.stabbable(t) || !inThrust(h, h.aim, { x: t.x, z: t.z, radius: 0.6 }, a.range, a.width) || !this.bladeReaches(t)) continue;
      this.stab(t); hits++;
    }
    if (hits) this.hitstop = Math.max(this.hitstop, a.hitstop + (this.kills > killsBefore ? KILL_STOP : 0));
    this.emit('strike', { x: h.x, z: h.z, aim: { ...h.aim }, range: a.range, width: a.width, shake: a.shake, kind: h.combo, index: h.attackIndex, tier: a.tier, hits });
  }
  // The blow that actually ends the statue or NULL, whichever way it came.
  finishBoss(e: Enemy) {
    this.prompt = null; e.ai.final = false; e.ai.rally = false; e.ai.invuln = 0; e.hp = 0;
    if (e.kind === 'b03') this.emit('iconFreed', { x: e.x, z: e.z });
    this.kill(e, false, 'ult', { x: 0, z: 1 }); this.slowmo = .9;
  }
  // The context button: frees the statue's core, or lets turned enemies go when only they are left.
  interact() {
    const p = this.prompt;
    if (p) { const e = this.enemies.find(o => o.id === p.id); if (e?.ai.final) this.finishBoss(e); return; }
    const left = this.enemies.filter(e => e.hp > 0 && !notCounted(e));
    if (left.length && left.every(e => e.allied > 0)) for (const e of left) e.allied = Math.min(e.allied, GLM.wake);
  }
  // Where the fist lands: on the enemy with the most others inside the blast, the nearest of those if it is a tie, or just ahead of the hero with no one around.
  ultLanding(): Vec2 {
    const h = this.hero, alive = hostile(this).filter(e => Math.hypot(e.x - h.x, e.z - h.z) < ULT.reach);
    let best: Enemy | null = null, most = 0, nearest = Infinity;
    for (const e of alive) {
      const count = alive.filter(o => inRing(e, o, ULT.radius)).length, d = Math.hypot(e.x - h.x, e.z - h.z);
      if (count > most || (count === most && d < nearest)) { best = e; most = count; nearest = d; }
    }
    return best ? { x: best.x, z: best.z } : { x: h.x + h.heading.x * 4, z: h.z + h.heading.z * 4 };
  }
  updateUlt(dt: number) {
    const h = this.hero, before = h.ultAge;
    h.ultAge += dt;
    const reached = (t: number) => before < t && h.ultAge >= t;
    if (reached(ULT.confirmAt)) { h.awaken = 0; h.ultTarget = this.ultLanding(); this.emit('ultConfirm', { ...h.ultTarget, radius: ULT.radius }); }
    if (reached(ULT.avatarAt)) this.emit('ultAvatar');
    if (reached(ULT.avatarOutAt)) this.emit('ultAvatarOut');
    if (reached(ULT.fistAt)) this.emit('ultFist', { ...h.ultTarget, flight: ULT.punchAt - ULT.fistAt });
    if (reached(ULT.punchAt)) {
      this.emit('ultPunch', { ...h.ultTarget, radius: ULT.radius });
      const finished = this.enemies.find(e => e.ai.final || e.ai.rally);
      if (finished) { finished.ai.invuln = 0; this.finishBoss(finished); }
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.allied > 0 || !inRing(h.ultTarget, e, ULT.radius)) continue;
        const push = unit(e.x - h.ultTarget.x, e.z - h.ultTarget.z);
        this.damage(e, ULT.damage, 0.8, push.x * 1.6, push.z * 1.6, false, 'ult', 2);
        if (e.boss && e.hp > 0) addStagger(this, e, ULT.bossStagger);
      }
      this.hitstop = Math.max(this.hitstop, 0.16);
    }
    if (reached(ULT.shockAt)) {
      this.emit('ultShock', { ...h.ultTarget, radius: ULT.shockRadius });
      for (const e of this.enemies) if (e.hp > 0 && e.allied <= 0 && inRing(h.ultTarget, e, ULT.shockRadius)) this.damage(e, ULT.shockDamage, 0.5, 0, 0, false, 'ult', 1);
    }
    if (h.ultAge >= ULT.duration) h.ult = false;
  }
  // Presses are remembered for a moment, so a press during a hit queues the next one. Holding queues nothing: it builds toward the charge.
  readButtons(input: GameInput, dt: number) {
    const h = this.hero;
    if (input.attack && !h.attackHeld) { h.buffer = 'light'; h.bufferTime = BUFFER; }
    h.attackHeld = !!input.attack;
    h.holdTime = input.attack ? h.holdTime + dt : 0;
    if (!input.attack) h.holdDenied = false;
    if (input.dash) h.dashBuffer = BUFFER;
    if (input.ult) { if (h.awaken >= ULT.cost) h.ultBuffer = BUFFER; else if (!h.ult) this.emit('ultDenied'); }
    if (input.card !== undefined && input.card >= 0 && input.card < SLOTS) {
      const reason = this.cardRefusal(input.card);
      if (reason) this.refuseCard(input.card, reason);
      else {
        h.cardBuffer = input.card; h.cardBufferTime = BUFFER;
        const aim = Math.hypot(input.aimX ?? 0, input.aimZ ?? 0) > .1 ? unit(input.aimX, input.aimZ) : null;
        const move = Math.hypot(input.moveX ?? 0, input.moveZ ?? 0) > .1 ? unit(input.moveX, input.moveZ) : null;
        // Keep a drag/release or stick direction through hitstop and attack recovery.
        h.cardBufferAim = { ...this.lockOn(aim, move, input.aimTargetId) };
      }
    }
  }
  beginAttack(attack: Attack, kind: AttackKind) {
    const h = this.hero;
    h.summon = null; h.attackPaid = false; h.combo = kind; h.attack = attack; h.attackAge = 0; h.attackHit = false; h.attackMore = 0; h.travel = 0; h.travelAim = { ...h.aim }; h.vx = h.vz = 0; h.bufferTime = 0; h.buffer = null;
    this.logAction(kind); this.setAction(attack.action); h.age = 0; this.emit('attack', { x: h.x, z: h.z, aim: { ...h.aim }, kind, index: h.attackIndex });
  }
  update(dt: number, input: GameInput = {}) {
    this.events = [];
    if (this.state !== 'playing') return;
    dt = clamp(dt, 0, 1 / 30);
    if (this.leaving > 0) {
      this.leaving -= dt;
      if (this.leaving <= 0 && this.trial) {
        const next = trialRoom(this.levels, ++this.trial.room, this.plan.id);
        if (next.region !== this.levelIndex) this.refreshHeal();
        this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + TRIAL_HEAL); this.enterRoom(next.index, next.region); this.beginRoom();
      } else if (this.leaving <= 0) {
        // A boss room's door leads to the preparation point, and from there on to the next region.
        if (this.roomIndex + 1 < this.level.rooms.length) { this.enterRoom(this.roomIndex + 1); this.beginRoom(); }
        else { this.state = 'prep'; this.emit('prep', { next: this.levels[this.levelIndex + 1].name }); }
      }
      return;
    }
    if (this.god) { this.hero.token = this.hero.tokenMax; this.hero.tokenLock = 0; this.hero.awaken = ULT.cost; }
    const realDt = dt;
    if (this.slowmo > 0) { this.slowmo = Math.max(0, this.slowmo - dt); dt *= SLOWMO_RATE; }
    this.time += dt;
    this.readButtons(input, dt);
    // Impact freeze: everything holds its pose for a moment; the buttons were read above, so nothing pressed during it is lost.
    if (this.hitstop > 0) { this.hitstop = Math.max(0, this.hitstop - realDt); return; }
    const h = this.hero;
    h.age += dt; h.invulnerable = Math.max(0, h.invulnerable - dt);
    if (h.dash > 0 && h.dash <= dt) h.lastDash = { ...h.dashAim };
    h.dash = Math.max(0, h.dash - dt); h.comboTimer = Math.max(0, h.comboTimer - dt); h.dashBuffer = Math.max(0, h.dashBuffer - dt); h.ultBuffer = Math.max(0, h.ultBuffer - dt);
    // Keep one next light attack through the current attack's commitment. Repeated
    // taps replace that intent; they never build a backlog of attacks.
    if (!h.attack || h.attackAge >= h.attack.cancelAt) h.bufferTime = Math.max(0, h.bufferTime - dt);
    h.dashLinger = h.dash > 0 ? DASH_LINGER : Math.max(0, h.dashLinger - dt);
    for (const key in h.comboCd) h.comboCd[key] = Math.max(0, h.comboCd[key] - dt);
    h.tokenLock = Math.max(0, h.tokenLock - dt); h.noHeal = Math.max(0, h.noHeal - dt); if ((h.slowTime = Math.max(0, h.slowTime - dt)) === 0) h.slow = 0;
    if (input.interact) this.interact();
    if (h.dashCharges < DASH_CHARGES) {
      h.dashCooldown -= dt;
      if (h.dashCooldown <= 0) { h.dashCharges++; h.dashCooldown = h.dashCharges < DASH_CHARGES ? DASH_RECHARGE : 0; }
    }
    h.awakenBudget = Math.min(AWAKEN_RATE, h.awakenBudget + AWAKEN_RATE * dt);
    h.tokenBudget = Math.min(TOKEN.rate, h.tokenBudget + TOKEN.rate * dt);
    h.cardGap = Math.max(0, h.cardGap - dt); h.cardBufferTime = Math.max(0, h.cardBufferTime - dt);
    for (const card of h.cards) card.cooldown = Math.max(0, card.cooldown - dt);
    h.hasteTime = Math.max(0, h.hasteTime - dt);
    const move = unit(input.moveX || 0, input.moveZ || 0);
    const strength = Math.min(1, Math.hypot(input.moveX || 0, input.moveZ || 0)), moving = strength > 0.1;
    const aimInput = Math.hypot(input.aimX || 0, input.aimZ || 0) > 0.1 ? unit(input.aimX, input.aimZ) : null;
    const run = (share = 1) => {
      const k = 1 - Math.exp(-dt / RUN_RESPONSE);
      const speed = RUN_SPEED * share * (h.hasteTime > 0 ? 1 + h.haste : 1) * (1 - h.slow);
      h.vx += (move.x * strength * speed - h.vx) * k; h.vz += (move.z * strength * speed - h.vz) * k;
      this.moveHero(h.vx * dt, h.vz * dt);
    };
    const free = () => !h.attack && !h.dash && !h.ult && h.charge === null && !h.summon;
    const canAct = () => free() || (h.attack !== null && h.attackAge >= h.attack.cancelAt) || (h.summon !== null && h.summon.age >= SUMMON.cancelAt);
    // A flurry can be abandoned early for movement or a skill. Chaining another
    // light still waits for all four thrusts, so tapping cannot skip its finisher.
    const canInterrupt = () => canAct() || (h.attack !== null && h.attackAge >= (h.attack.interruptAt ?? h.attack.cancelAt));
    // Spec: moving faces the movement, standing still keeps the last facing; only starting an attack turns the body to the aim. A charge keeps tracking the aim while it builds.
    if (canAct()) {
      if (moving) h.heading = move;
      h.aim = this.lockOn(aimInput, moving ? move : null, input.aimTargetId);
      h.direction = facing(h.heading.x, h.heading.z, h.direction);
    }
    const faceAim = () => { h.heading = { ...h.aim }; h.direction = facing(h.aim.x, h.aim.z, h.direction); };
    // Releasing a touch drag removes its live aim. Keep the last charge direction
    // instead of snapping to a different enemy on the release frame.
    if (h.charge !== null && (input.attack || aimInput)) { h.aim = this.lockOn(aimInput, moving ? move : null, input.aimTargetId); faceAim(); }
    // Spec: the dash may cancel a recovery, never a wind-up.
    const dashAllowed = (!h.attack || h.attackAge >= h.attack.hitAt) && (!h.ult || h.ultAge >= ULT.shockAt);
    const wanted = h.bufferTime > 0 ? h.buffer : null;
    const wantsCharge = input.attack && h.holdTime >= CHARGE.holdAfter;
    const canPayCharge = h.zeroCharges > 0 || h.token >= CHARGE.cost;
    if (h.ultBuffer > 0 && (canInterrupt() || h.charge !== null) && h.awaken >= ULT.cost) {
      h.ult = true; h.ultAge = 0; h.ultBuffer = 0; h.attack = null; h.charge = null; h.summon = null; h.travel = 0; h.vx = h.vz = 0; h.buffer = null; h.bufferTime = 0; h.invulnerable = Math.max(h.invulnerable, ULT.shockAt);
      this.setAction('cast'); h.age = 0; this.emit('ultStart', { x: h.x, z: h.z });
    } else if (h.dashBuffer > 0 && h.dashCharges > 0 && !h.dash && dashAllowed) {
      if (h.dashCharges === DASH_CHARGES) h.dashCooldown = DASH_RECHARGE;
      h.dash = DASH_TIME; h.dashCharges--; h.dashBuffer = 0; h.invulnerable = Math.max(h.invulnerable, 0.27); h.ult = false; h.charge = null; h.summon = null;
      if (h.attack) { h.attack = null; h.travel = 0; h.comboTimer = COMBO_WINDOW; }
      h.dashAim = moving ? move : { ...h.heading }; h.heading = { ...h.dashAim }; h.direction = facing(h.dashAim.x, h.dashAim.z, h.direction);
      this.setAction('dash'); h.age = 0; this.emit('dash', { x: h.x, z: h.z, aim: { ...h.dashAim } });
    } else if (h.charge !== null && (!input.attack || h.charge >= CHARGE.full)) {
      const k = clamp(h.charge / CHARGE.full, 0, 1), { weak, strong } = CHARGE, mix = (key: keyof Blow) => weak[key] + (strong[key] - weak[key]) * k, cost = h.zeroCharges > 0 ? 0 : CHARGE.cost;
      h.charge = null; h.holdTime = 0; // A continued hold can build another charge after this recovery.
      if (cost > h.token) this.emit('tokenDenied');
      else {
        h.token -= cost; h.attackIndex = 0; h.comboIndex = 0;
        this.beginAttack({ ...CHARGE.attack, width: CHARGE.attack.width * (h.mods.includes('wide') ? 1.4 : 1), damage: Math.round(mix('damage')), range: mix('range'), stun: mix('stun'), push: mix('push'), hitstop: mix('hitstop'), shake: mix('shake'), tier: k >= 1 ? strong.tier : weak.tier }, 'charge');
        if (cost === 0) this.spendZeroCharge();
      }
    } else if (canInterrupt() && h.cardBufferTime > 0 && h.cardGap === 0) {
      this.beginSummon(h.cardBuffer);
    } else if (canAct() && (wanted || (wantsCharge && !canPayCharge))) {
      // A held attack still works without enough Token. Warn once for this hold,
      // then use light attacks until there is enough to charge again.
      if (!wanted) { h.holdTime = 0; if (!h.holdDenied) { h.holdDenied = true; this.emit('tokenDenied'); } }
      const thrust = h.dashLinger > 0, opener = thrust && h.mods.includes('opener');
      h.attackIndex = !thrust && h.combo === 'light' && (h.attack || h.comboTimer > 0) ? (h.comboIndex + 1) % LIGHT_CHAIN.length : 0;
      h.comboIndex = h.attackIndex; h.dashLinger = 0;
      faceAim();
      this.beginAttack(opener ? { ...DASH_THRUST, damage: Math.round(DASH_THRUST.damage * 1.3) } : thrust ? DASH_THRUST : LIGHT_CHAIN[h.attackIndex], 'light');
    } else if (canAct() && wantsCharge) {
      h.attack = null; h.summon = null; h.charge = 0; h.travel = 0; h.vx = h.vz = 0;
      faceAim();
      this.setAction('charge_start'); h.age = 0; this.emit('chargeStart', { x: h.x, z: h.z });
    }
    if (h.dash) {
      const speed = DASH_SPEED * (0.5 + h.dash / DASH_TIME); // Bursts out and eases off, covering the same distance as a flat DASH_SPEED.
      h.vx = h.dashAim.x * speed * 0.5; h.vz = h.dashAim.z * speed * 0.5;
      this.moveHero(h.dashAim.x * speed * dt, h.dashAim.z * speed * dt);
    } else if (h.attack) {
      const a = h.attack;
      h.attackAge += dt;
      const want = a.travel * travelCurve(h.attackAge / a.duration), step = want - h.travel;
      h.travel = want; this.moveHero(h.travelAim.x * step, h.travelAim.z * step);
      if (!h.attackHit && h.attackAge >= a.hitAt) { h.attackHit = true; this.strike(a); }
      const more = a.more ?? [];
      while (h.attackMore < more.length && h.attackAge >= more[h.attackMore].at) this.strike({ ...a, ...more[h.attackMore++] });
      const moveCancel = moving && h.attackAge >= (a.interruptAt ?? a.cancelAt);
      if (h.attackAge >= a.duration || moveCancel) {
        h.attack = null; h.travel = 0; h.comboTimer = COMBO_WINDOW;
        if (moveCancel && h.attackAge < a.cancelAt) { h.buffer = null; h.bufferTime = 0; }
      }
    } else if (h.ult) this.updateUlt(dt);
    else if (h.summon) this.updateSummon(dt, moving);
    else if (h.charge !== null) {
      const before = h.charge;
      h.charge += dt;
      if (before < CHARGE.windup && h.charge >= CHARGE.windup) this.setAction('charge_hold');
      if (before < CHARGE.full && h.charge >= CHARGE.full) this.emit('chargeFull', { x: h.x, z: h.z });
      run(CHARGE.moveShare);
    } else run();
    h.moving = moving;
    if (free()) this.setAction(h.moving ? 'run' : 'idle');
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.arrive > 0) { e.arrive = Math.max(0, e.arrive - dt); continue; }
      e.flash = Math.max(0, e.flash - dt); e.stun = Math.max(0, e.stun - dt); e.cooldown = Math.max(0, e.cooldown - dt);
      e.alliedImmune = Math.max(0, e.alliedImmune - dt); e.charmImmune = Math.max(0, e.charmImmune - dt); e.lured = Math.max(0, e.lured - dt); e.sealed = Math.max(0, e.sealed - dt); e.staggerLock = Math.max(0, e.staggerLock - dt); e.wallCheck = Math.max(0, e.wallCheck - dt); e.broken = Math.max(0, e.broken - dt); e.wallMark = Math.max(0, e.wallMark - dt);
      if (e.weak.length) e.weak = e.weak.map(w => ({ ...w, time: w.time - dt })).filter(w => w.time > 0);
      if (e.allied > 0 && (e.allied -= dt) <= 0) { e.allied = 0; e.alliedImmune = GLM.immune; e.windup = 0; e.cooldown = Math.max(e.cooldown, .6); comboHesitate(this, e); this.emit('allyEnd', { id: e.id, x: e.x, z: e.z }); }
      if (e.charm > 0 && (e.charm -= dt) <= 0) { e.charm = 0; e.charmImmune = GROK.immune; comboHesitate(this, e); this.emit('charmEnd', { id: e.id, x: e.x, z: e.z }); }
      if (e.vx || e.vz) {
        const wanted = Math.hypot(e.vx, e.vz) * dt, to = slide(this.room, e.x, e.z, e.vx * dt, e.vz * dt, e.radius), moved = Math.hypot(to.x - e.x, to.z - e.z);
        Object.assign(e, to);
        // Shoved by the train into something solid: one extra hit, however long it stays pressed there.
        if (e.wallCheck > 0 && moved < wanted * .5 && wanted > 1 * dt) { e.wallCheck = 0; e.wallMark = 3; this.damage(e, MINIMAX.wallDamage, .3, 0, 0, false, 'minimax', 1); this.emit('trainWall', { x: e.x, z: e.z }); }
        const decay = Math.exp(-KNOCK_DECAY * dt); e.vx *= decay; e.vz *= decay;
        if (Math.hypot(e.vx, e.vz) < 0.05) e.vx = e.vz = 0;
      }
      if (e.hp <= 0) continue;
      if (e.kind !== 'plain') { updateEnemy(this, e, dt, (b, target, step) => updateBoss(this, b, target, step)); continue; }
      if (e.staggered > 0) { e.staggered = Math.max(0, e.staggered - dt); continue; }
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) { this.landBlow(e); e.cooldown = e.boss ? 1.6 : 1.3; }
      } else if (!e.stun) {
        const target = this.targetOf(e);
        if (!target) continue;
        const distance = Math.hypot(target.x - e.x, target.z - e.z), toward = unit(target.x - e.x, target.z - e.z);
        e.side = side(toward.x, toward.z, e.side); e.direction = facing(toward.x, toward.z, e.direction);
        if (distance < (e.boss ? 2.3 : 1.65) && e.cooldown === 0 && e.charm <= 0) {
          e.windup = e.boss ? 0.9 : 0.65; e.attackX = target.x; e.attackZ = target.z; e.alliedAttack = e.allied > 0;
        } else if (distance > 0.9 + e.radius) {
          const go = this.routeTo(e, target, toward);
          Object.assign(e, slide(this.room, e.x, e.z, go.x * e.speed * dt, go.z * e.speed * dt, e.radius));
        }
      }
    }
    updateSummons(this, dt);
    updateHazards(this, dt);
    this.updateTraps(dt);
    // Keep enemies apart so telegraphs remain readable.
    for (let i = 0; i < this.enemies.length; i++) for (let j = i + 1; j < this.enemies.length; j++) {
      const a = this.enemies[i], b = this.enemies[j]; if (a.hp <= 0 || b.hp <= 0 || a.speed === 0 || b.speed === 0) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z), min = a.radius + b.radius + 0.18;
      if (d > 0.001 && d < min) {
        const n = unit(a.x - b.x, a.z - b.z), push = (min - d) * 0.5;
        Object.assign(a, slide(this.room, a.x, a.z, n.x * push, n.z * push, a.radius)); Object.assign(b, slide(this.room, b.x, b.z, -n.x * push, -n.z * push, b.radius));
      }
    }
    this.enemies = this.enemies.filter(e => e.hp > 0);
    const real = this.enemies.filter(e => !notCounted(e));
    // With only turned enemies left the room would wait on their timers, so they come round after a short warning. They still have to be beaten.
    if (real.length && !hostile(this).length) for (const e of real) e.allied = Math.min(e.allied, GLM.wake);
    if (h.hp === 0) { this.state = 'lost'; this.emit('lost'); return; }
    // The trial goes through the last room too, which has no door to walk to.
    if (this.cleared) { if (this.room.exit ? inDoor(this.room, this.room.exit, h) : this.trial) { this.route = this.forksAhead() ? this.routeAt(h) : ''; this.leaving = ROOM_FADE; this.emit('roomLeave'); } }
    else if (!real.length) {
      this.enemies = [];
      this.nextWave += dt;
      if (this.wave < this.plan.waves.length) { if (this.nextWave > WAVE_GAP) this.spawnWave(); }
      else if (this.nextWave > CLEAR_DELAY) this.clearRoom();
    }
  }
  private updateTraps(dt: number) {
    const h = this.hero;
    for (const t of this.traps) {
      if (t.kind === 'pad') {
        if (t.plan.kind === 'pad' && !t.used && inArea(t.area, h.x, h.z)) {
          t.used = true; h.hp = t.plan.awaken ? h.maxHp : Math.min(h.maxHp, h.hp + t.plan.heal); if (t.plan.awaken) h.awaken = ULT.cost;
          this.emit('pad', { x: t.x, z: t.z, text: t.plan.text });
          if (this.plan.kind === 'shop') this.openShop();
          else if (STORY[this.plan.id]) { this.state = 'dialog'; this.emit('story', { id: this.plan.id }); }
          else if (t.plan.upgrade) this.offerReward();
        }
      } else if (t.state === 'off') continue;
      else if (t.kind === 'belt') {
        if (!h.dash && inArea(t.area, h.x, h.z)) this.moveHero(t.dir.x * BELT.speed * dt, t.dir.z * BELT.speed * dt);
        const carry = BELT.speed * BELT.enemyShare * dt;
        for (const e of this.enemies) if (e.hp > 0 && !e.boss && inArea(t.area, e.x, e.z)) Object.assign(e, slide(this.room, e.x, e.z, t.dir.x * carry, t.dir.z * carry, e.radius));
      } else this.stepTrap(t, dt);
    }
  }
  private stepTrap(t: Trap, dt: number) {
    const times = TIMES[t.kind as Timed];
    t.lock = Math.max(0, t.lock - dt);
    if (t.state === 'idle' && (t.kind === 'valve' || t.kind === 'beacon')) return; // These wait for the blade.
    t.timer -= dt;
    if (t.state === 'strike') this.trapActs(t, dt);
    if (t.timer > 0 || t.state === 'off') return; // What it did may have ended the fight.
    if (t.state === 'idle') { t.state = 'warn'; t.timer = warnTime(t); this.emit('trapWarn', { x: t.x, z: t.z }); }
    else if (t.state === 'warn') { t.state = 'strike'; this.fireTrap(t); }
    else if (t.state === 'strike') {
      if (t.kind === 'stamper' && t.step < 2) { t.step++; t.area = this.stamperSlot(t); t.state = 'warn'; t.timer = warnTime(t); }
      else { t.state = 'recover'; t.timer = times.recover; }
    } else {
      t.state = 'idle'; t.timer = times.rest; t.sweep = 0;
      if (t.kind === 'shelf') t.back = !t.back;
      if (t.kind === 'stamper') { t.back = !t.back; t.step = 0; t.area = this.stamperSlot(t); }
      if (t.kind === 'vent') t.dir = { x: -t.dir.z, z: t.dir.x }; // The gap comes round a quarter turn each time, so it has to be read.
    }
  }
  private fireTrap(t: Trap) {
    const h = this.hero, times = TIMES[t.kind as Timed];
    t.hit.clear(); t.sweep = t.kind === 'erase' ? ERASE.tick : 0; // Erased floor bites at once, then keeps biting.
    t.timer = t.kind === 'shelf' ? (railTiles(t.rail, t.dir) - t.size) * SHELF.stride + 0.02 : t.kind === 'scan' ? (t.dir.x ? t.area.halfX : t.area.halfZ) * 2 / SCAN.speed : times.strike;
    if (t.kind === 'mirror') this.aimMirror(t);
    this.emit('trapFire', { kind: t.kind, x: t.x, z: t.z, area: t.area, feed: t.feed, dir: t.dir });
    if (t.kind === 'shelf' || t.kind === 'vent' || t.kind === 'scan' || t.kind === 'erase') return; // These act for as long as the strike lasts.
    const inBlast = (x: number, z: number, margin = 0) => inArea(t.area, x, z, margin) || (!!t.feed && inArea(t.feed, x, z, margin));
    if (!h.invulnerable && inBlast(h.x, h.z)) this.hurtHero(times.heroDamage);
    for (const e of this.enemies) {
      if (e.hp <= 0 || !inBlast(e.x, e.z, e.radius)) continue;
      const push = t.kind === 'press' || t.kind === 'stamper' ? unit(e.x - t.area.x, e.z - t.area.z) : t.dir;
      this.damage(e, times.enemyDamage, 0.5, push.x, push.z, false, 'trap', 1);
    }
  }
  // What a mechanism does for as long as its strike lasts.
  private trapActs(t: Trap, dt: number) {
    const h = this.hero, times = TIMES[t.kind as Timed];
    if (t.kind === 'shelf') {
      const last = railTiles(t.rail, t.dir) - t.size;
      t.sweep += dt;
      while (t.sweep >= SHELF.stride && (t.back ? t.step > 0 : t.step < last)) { t.sweep -= SHELF.stride; this.moveShelf(t); }
    } else if (t.kind === 'erase') {
      t.sweep += dt;
      if (t.sweep < ERASE.tick) return;
      t.sweep -= ERASE.tick;
      if (!h.invulnerable && inArea(t.area, h.x, h.z)) this.hurtHero(ERASE.heroDamage);
      for (const e of this.enemies) if (e.hp > 0 && inArea(t.area, e.x, e.z, e.radius)) this.damage(e, ERASE.enemyDamage, 0.1, 0, 0, false, 'trap', 0);
    } else if (t.kind === 'vent' || t.kind === 'scan') {
      t.sweep += (t.kind === 'vent' ? VENT.speed : SCAN.speed) * dt;
      const touches = t.kind === 'vent' ? (x: number, z: number, r: number) => this.inHeat(t, x, z, r) : (x: number, z: number, r: number) => this.scanLines(t).some(line => inArea(line, x, z, r));
      if (!h.invulnerable && touches(h.x, h.z, HERO_RADIUS)) this.hurtHero(times.heroDamage);
      for (const e of this.enemies) {
        if (e.hp <= 0 || t.hit.has(e.id) || !touches(e.x, e.z, e.radius)) continue;
        t.hit.add(e.id);
        const push = t.kind === 'vent' ? unit(e.x - t.x, e.z - t.z) : t.dir;
        this.damage(e, times.enemyDamage, 0.4, push.x, push.z, false, 'trap', 1);
      }
    }
  }
  // One tile along the rail. Whatever it runs into is shoved ahead of it, or to the nearest room if it is up against something, and hurt.
  private moveShelf(t: Trap) {
    const m = this.room, h = this.hero, way = t.back ? -1 : 1, push = { x: t.dir.x * way, z: t.dir.z * way };
    setTiles(m, t.area, FLOOR); t.step += way; t.area = slotOn(t.rail, t.dir, t.size, t.step); setTiles(m, t.area, MACHINE);
    this.fields.clear();
    for (const o of this.traps) if (o.kind === 'mirror') this.aimMirror(o);
    const shove = (body: Vec2, r: number) => {
      if (!inArea(t.area, body.x, body.z, r)) return false;
      const x = push.x ? t.area.x + push.x * (t.area.halfX + r + 0.02) : body.x, z = push.z ? t.area.z + push.z * (t.area.halfZ + r + 0.02) : body.z;
      Object.assign(body, blocked(m, x, z, r) ? nearestOpen(m, x, z, r) : { x, z });
      return true;
    };
    if (shove(h, HERO_RADIUS) && !t.hit.has(HERO_ID) && !h.invulnerable) { t.hit.add(HERO_ID); this.hurtHero(SHELF.heroDamage); }
    for (const e of this.enemies) {
      if (e.hp <= 0 || !shove(e, e.radius) || t.hit.has(e.id)) continue;
      t.hit.add(e.id); this.damage(e, SHELF.enemyDamage, 0.4, push.x, push.z, false, 'trap', 1);
    }
  }
  private moveHero(dx: number, dz: number) { const h = this.hero; Object.assign(h, slide(this.room, h.x, h.z, dx, dz, HERO_RADIUS)); }
  // Straight at the target when nothing is in the way, otherwise round the crates and machines. A route is kept for each tile a target stands on.
  routeTo(e: Enemy, target: Vec2, toward: { x: number; z: number }) {
    const m = this.room;
    if (pathClear(m, e, target, e.radius)) return toward;
    const t = tileOf(m, target.x, target.z), clearance = clearanceFor(e.radius), key = (t.r * m.cols + t.c) * 2 + clearance;
    let field = this.fields.get(key);
    if (!field) { if (this.fields.size > 32) this.fields.clear(); field = distanceField(m, target, clearance); this.fields.set(key, field); }
    const next = stepToward(m, field, e.x, e.z);
    return next ? unit(next.x - e.x, next.z - e.z) : toward;
  }
  setAction(action: string) { if (this.hero.action !== action) { this.hero.action = action; this.hero.age = 0; } }
}
