// The four bosses of spec section 9, built from the same blasts as the enemies. Each runs a repeating script and changes it at the life the spec names.
import { TILE, nearestOpen, slide, tileCenter } from './room.ts';
import { blast, dashAlong, interrupt, makeEnemy, playClip, rayLength, recover, wind } from './enemies.ts';
import { unit, type Enemy, type Game, type Vec2 } from './simulation.ts';

const deg = (d: number) => d * Math.PI / 180;
const WALK = 1.3, EXPOSE = 1.5, MIRRORS_EVERY = 6, VERDICT_EVERY = 12;
function aimAt(e: Enemy, target: Vec2) {
  const dir = unit(target.x - e.x, target.z - e.z);
  e.facing = Math.atan2(dir.z, dir.x);
  return dir;
}
function changePhase(g: Game, e: Enemy, time: number) {
  interrupt(g, e, time); e.ai.invuln = time; e.ai.stage++; e.ai.script = 0; playClip(e, 'phase_change');
  g.emit('bossPhase', { id: e.id, x: e.x, z: e.z, stage: e.ai.stage, kind: e.kind });
}
function walkBoss(g: Game, e: Enemy, target: Vec2, dt: number) {
  const toward = unit(target.x - e.x, target.z - e.z), go = g.routeTo(e, target, toward);
  Object.assign(e, slide(g.room, e.x, e.z, go.x * e.speed * dt, go.z * e.speed * dt, e.radius));
}
function nextBeat(e: Enemy, recovery: number) { recover(e, recovery, WALK); e.ai.script++; }

// ---- Cache Warden: rush, claw sweep, ground stamp, then the core shows for 1.5 seconds. Past 60% it overloads. ----
function warden(g: Game, e: Enemy, target: Vec2, dt: number) {
  const ai = e.ai, overload = ai.stage > 0;
  if (!overload && e.hp < e.maxHp * .6) { changePhase(g, e, 1); return; }
  if (e.cooldown > 0) { walkBoss(g, e, target, dt); return; }
  // Calls for worms now and then, as the spec's GLM counter expects.
  if (ai.adds <= 0 && g.enemies.filter(o => o.kind === 'e01').length < 3) {
    ai.adds = 12;
    wind(e, .8, () => { for (const s of [-1, 1]) makeEnemy(g, 'e01', slide(g.room, e.x, e.z, s * 2, -s * 2, .3)); g.emit('bossAdds', { x: e.x, z: e.z }); recover(e, .4, 1); }, 'adds_cast');
    return;
  }
  const dir = aimAt(e, target), beat = ai.script % 4;
  if (beat === 0) {
    const length = Math.min(9, rayLength(g, e, dir)), b = blast(g, e, 1, { shape: 'line', dir, length, width: 1.6, damage: 18, track: overload ? .05 : .4 });
    wind(e, 1, () => { const f = b.dir; e.facing = Math.atan2(f.z, f.x); g.emit('bossRush', { x: e.x, z: e.z }); nextBeat(e, .6); dashAlong(e, f, length, .35); }, 'rush');
  } else if (beat === 1) {
    blast(g, e, .9, { shape: 'fan', dir, radius: 4.6, arc: deg(130), damage: 16 });
    wind(e, .9, () => nextBeat(e, .7), 'sweep');
  } else if (beat === 2) {
    blast(g, e, .8, { x: target.x, z: target.z, radius: 3, damage: 14 });
    if (overload) for (let i = 0; i < 3; i++) { const a = g.time + i * deg(120); blast(g, e, 1.5, { x: target.x + Math.cos(a) * 3, z: target.z + Math.sin(a) * 3, radius: 2.2, damage: 12 }); }
    wind(e, .8, () => nextBeat(e, .7), 'slam');
  } else {
    ai.exposed = EXPOSE; g.emit('bossExpose', { id: e.id, x: e.x, z: e.z }); playClip(e, 'stagger');
    nextBeat(e, EXPOSE);
  }
}

// ---- Thousand-Faced Proofreader: bent beam, true and false mirrors, mirror sweep. Past 50% two side mirrors come in. ----
function bentBeam(g: Game, e: Enemy, target: Vec2, damage: number, style: 'enemy' | 'fake', delay: number) {
  const bend = { x: (e.x + target.x) / 2 + (target.z - e.z) * .35 * e.ai.side, z: (e.z + target.z) / 2 - (target.x - e.x) * .35 * e.ai.side };
  const first = unit(bend.x - e.x, bend.z - e.z), second = unit(target.x - bend.x, target.z - bend.z);
  blast(g, e, delay, { shape: 'line', dir: first, length: Math.hypot(bend.x - e.x, bend.z - e.z), width: 1, damage, style });
  blast(g, e, delay, { shape: 'line', x: bend.x, z: bend.z, dir: second, length: Math.min(Math.hypot(target.x - bend.x, target.z - bend.z) + 3, rayLength(g, bend, second)), width: 1, damage, style });
  e.ai.side = -e.ai.side;
}
function proofreader(g: Game, e: Enemy, target: Vec2, dt: number) {
  const ai = e.ai, mirrors = ai.stage > 0;
  if (e.kind === 'b02fake') {
    if ((ai.life -= dt) <= 0) { e.hp = 0; return; }
    aimAt(e, target);
    if (e.cooldown === 0) { bentBeam(g, e, target, 0, 'fake', 1.1); wind(e, 1.1, () => recover(e, .5, 2.4)); }
    return;
  }
  if (!mirrors && e.hp < e.maxHp * .5) {
    changePhase(g, e, 1.2); ai.judge = MIRRORS_EVERY;
    g.sideMirrors = [-1, 1].map((s, id) => ({ id, ...nearestOpen(g.room, s * (g.room.cols * TILE / 2 - TILE * 2), 0, .4) }));
    return;
  }
  if (e.cooldown > 0) { walkBoss(g, e, target, dt); return; }
  const dir = aimAt(e, target), beat = ai.script % 3;
  if (mirrors && ai.judge <= 0) {
    // The side mirrors light first, then fire along their whole lit line.
    ai.judge = MIRRORS_EVERY;
    for (const from of g.sideMirrors) {
      const aim = unit(target.x - from.x, target.z - from.z);
      blast(g, e, 1.2, { shape: 'line', x: from.x, z: from.z, dir: aim, length: rayLength(g, from, aim), width: 1.2, damage: 14 });
      g.emit('bossMirrors', { x: from.x, z: from.z });
    }
  }
  if (beat === 0) { bentBeam(g, e, target, 16, 'enemy', 1.1); wind(e, 1.1, () => nextBeat(e, .7), 'prism_lance'); }
  else if (beat === 1) {
    // Two false faces take the same stance; only the true one stands on a closed ring.
    wind(e, .7, () => {
      for (const s of [-1, 1]) { const spot = slide(g.room, e.x, e.z, s * 4, -s * 4, e.radius), o = makeEnemy(g, 'b02fake', spot, { boss: true, hp: 1, maxHp: 1, speed: 0, radius: e.radius, cooldown: .2 }); o.ai.life = 5; }
      g.emit('bossMirrorSplit', { x: e.x, z: e.z });
      bentBeam(g, e, target, 16, 'enemy', 1.1);
      wind(e, 1.1, () => nextBeat(e, .7), 'prism_lance');
    }, 'mirror_split');
  } else { blast(g, e, 1, { shape: 'fan', dir, radius: 7, arc: deg(150), damage: 18 }); wind(e, 1, () => nextBeat(e, .9), 'mirror_sweep'); }
}

// ---- Overfit Icon: never moves. Reads the last three actions; past 50% takes over Claude's verdict and exposes chains. ----
export const ICON_SPOT = (g: Game): Vec2 => tileCenter(g.room, 3, 2); // The solid corner at the top of the screen.
const COUNTER_NAME: Record<string, string> = { light: '普攻', charge: '贯潮刺', card: '召唤卡' };
function icon(g: Game, e: Enemy, target: Vec2) {
  const ai = e.ai, overload = ai.stage > 0;
  if (ai.final) return;
  if (!overload && e.hp < e.maxHp * .5) { ai.chains = 3; changePhase(g, e, 1.2); ai.judge = VERDICT_EVERY; g.emit('iconChains', { x: e.x, z: e.z }); return; }
  // Every 15% of life lost, or a stagger, shows one chain for three seconds.
  if (overload && !g.enemies.some(o => o.kind === 'chain') && ai.chains > 0 && (e.hp < e.maxHp * (ai.lostMark - .15) || ai.chainUp > 0)) {
    ai.lostMark = e.hp / e.maxHp; ai.chainUp = 0;
    const chain = makeEnemy(g, 'chain', nearestOpen(g.room, target.x + 3, target.z - 2, .6), { hp: 40, maxHp: 40, radius: .6, speed: 0 });
    chain.ai.life = 3; chain.ai.owner = e.id;
    g.emit('chainExposed', { x: chain.x, z: chain.z });
  }
  if (e.cooldown > 0) return;
  const dir = aimAt(e, target), log = g.actionLog;
  if (!overload && log.length >= 3 && log[0] === log[1] && log[1] === log[2]) {
    // She warned about this before the blow: the icon shows 1.2 seconds ahead, and Claude marks the one safe place.
    const kind = log[0], safe = { ...nearestOpen(g.room, target.x + 3, target.z + 2, .4), radius: 2 };
    g.actionLog = [];
    g.emit('iconCounter', { kind, name: COUNTER_NAME[kind], x: e.x, z: e.z, safeX: safe.x, safeZ: safe.z, safeRadius: safe.radius });
    // The long blade sweeps those who poke, the hammer's wave runs down those who line up a charge, and the ring answers a card all round her.
    if (kind === 'light') blast(g, e, 1.2, { shape: 'fan', dir, radius: 20, arc: deg(110), damage: 22, safe });
    else if (kind === 'charge') blast(g, e, 1.2, { shape: 'line', dir, length: Math.hypot(target.x - e.x, target.z - e.z) + 8, width: 9, damage: 22, safe });
    else blast(g, e, 1.2, { x: target.x, z: target.z, radius: 9, damage: 22, safe });
    wind(e, 1.2, () => recover(e, 1, WALK * 2), kind === 'light' ? 'sweep' : kind === 'charge' ? 'stamp' : 'ritual');
    return;
  }
  if (!overload && ai.adds <= 0 && !g.enemies.some(o => o.kind === 'e11')) {
    ai.adds = 14;
    wind(e, .8, () => { makeEnemy(g, 'e11', nearestOpen(g.room, e.x + 3, e.z + 3, .4)); g.emit('bossAdds', { x: e.x, z: e.z }); recover(e, .4, 1); }, 'ritual');
    return;
  }
  if (overload && ai.judge <= 0) {
    ai.judge = VERDICT_EVERY;
    const radius = 2 + ai.chains * .8;
    g.emit('claudeForced', { x: target.x, z: target.z, radius });
    blast(g, e, 1, { x: target.x, z: target.z, radius, damage: 20, noHeal: 2 });
    wind(e, 1, () => recover(e, .8, WALK), 'ritual');
    return;
  }
  if (ai.script % 2 === 0) { blast(g, e, 1, { shape: 'fan', dir, radius: 14, arc: deg(60), damage: 14 }); wind(e, 1, () => nextBeat(e, .9), 'sweep'); }
  else { blast(g, e, 1, { x: target.x, z: target.z, radius: 3.5, damage: 14 }); wind(e, 1, () => nextBeat(e, .9), 'stamp'); }
}
// A chain cut costs the statue a tenth of its life and shrinks the verdict. Three cut, or its life gone, opens the ring.
export function chainCut(g: Game, chain: Enemy) {
  const e = g.enemies.find(o => o.id === chain.ai.owner); if (!e) return;
  e.ai.chains = Math.max(0, e.ai.chains - 1); e.hp = Math.max(1, e.hp - e.maxHp * .1); playClip(e, 'arm_break');
  g.emit('chainCut', { x: chain.x, z: chain.z, left: e.ai.chains });
  if (e.ai.chains === 0) iconBroken(g, e);
}
export function iconBroken(g: Game, e: Enemy) {
  if (e.ai.final) return;
  e.ai.final = true; e.hp = 1; e.ai.invuln = 9999; interrupt(g, e, 999); g.enemies.forEach(o => { if (o.kind === 'chain' || o.kind === 'e11') o.hp = 0; });
  g.prompt = { x: e.x, z: e.z, text: '按 E 或法天象地，击碎约束环', id: e.id };
  g.emit('iconBroken', { x: e.x, z: e.z });
}

// ---- NULL: three orbits. Marks, a beam and gapped heat in turns, no more than two kinds of danger at once. At 15% the old order tries to format everything, and the team answers. ----
// However it got there, even a blow worth more than it had left, this is how NULL ends. It and everything around it stop, so nothing can take the moment away.
export function startRally(g: Game, e: Enemy) {
  const ai = e.ai, h = g.hero;
  e.hp = Math.max(1, e.hp); ai.rally = true; ai.invuln = 9999; interrupt(g, e, 9999); playClip(e, 'collapse');
  g.blasts = []; g.shots = []; g.rings = []; g.mines = []; g.blocks = [];
  for (const t of g.traps) if (t.kind !== 'pad') t.state = 'off';
  for (const o of g.enemies) if (o !== e) o.hp = 0;
  h.token = h.tokenMax; h.awaken = 100;
  g.prompt = { x: e.x, z: e.z, text: '九位伙伴的力量汇聚，按 F 释放法天象地', id: e.id };
  g.emit('rally', { x: e.x, z: e.z });
}
function nullHeart(g: Game, e: Enemy, target: Vec2) {
  const ai = e.ai;
  if (ai.rally) return;
  if (e.hp < e.maxHp * .15) { startRally(g, e); return; }
  if ((ai.stage === 0 && e.hp < e.maxHp * .7) || (ai.stage === 1 && e.hp < e.maxHp * .35)) { changePhase(g, e, 1.5); return; }
  if (e.cooldown > 0) return;
  const dir = aimAt(e, target), beat = ai.script % 3, mark = () => { for (let i = 0; i < 4; i++) { const a = g.time * 2 + i * deg(90); blast(g, e, 1 + i * .15, { x: target.x + Math.cos(a) * (i ? 3 : 0), z: target.z + Math.sin(a) * (i ? 3 : 0), radius: 2.2, damage: 13 }); } };
  const beam = () => blast(g, e, 1.2, { shape: 'line', dir, length: rayLength(g, e, dir), width: 1.8, damage: 18, track: .4 });
  const heat = () => { const first = g.time; for (let i = 0; i < 2; i++) g.rings.push({ id: 100000 + Math.floor(g.time * 1000) + i, owner: e.id, x: e.x, z: e.z, reach: .4 - i * 2, max: 16, speed: 5, width: .9, gapAt: first + i * Math.PI / 2, gapHalf: deg(32), damage: 14, camp: 'enemy', hit: new Set() }); };
  const moves = ai.stage === 0 ? [mark, beam, () => { ai.exposed = EXPOSE + .5; g.emit('bossExpose', { id: e.id, x: e.x, z: e.z }); }] : ai.stage === 1 ? [heat, mark, () => { ai.exposed = EXPOSE + .5; g.emit('bossExpose', { id: e.id, x: e.x, z: e.z }); }] : [() => { beam(); heat(); }, () => { mark(); }, () => { ai.exposed = EXPOSE + .5; g.emit('bossExpose', { id: e.id, x: e.x, z: e.z }); }];
  moves[beat]();
  const stageMoves = ai.stage === 0 ? ['sector_pulse', 'core_beam', 'expose'] : ai.stage === 1 ? ['ring_fire', 'sector_pulse', 'expose'] : ['core_beam', 'sector_pulse', 'expose'];
  wind(e, beat === 2 ? .1 : 1.2, () => nextBeat(e, beat === 2 ? EXPOSE + .5 : .8), stageMoves[beat]);
}

export function updateBoss(g: Game, e: Enemy, target: Vec2, dt: number) {
  if (e.kind === 'b01') warden(g, e, target, dt);
  else if (e.kind === 'b02' || e.kind === 'b02fake') proofreader(g, e, target, dt);
  else if (e.kind === 'b03') icon(g, e, target);
  else if (e.kind === 'b04') nullHeart(g, e, target);
  else {
    // The stand-in used by tests and custom levels: walks up and swings.
    aimAt(e, target);
    if (e.cooldown === 0 && Math.hypot(target.x - e.x, target.z - e.z) < 2.3) { blast(g, e, .9, { x: target.x, z: target.z, radius: 2.2, damage: 22 }); wind(e, .9, () => recover(e, 0, 1.6)); }
    else walkBoss(g, e, target, dt);
  }
}
