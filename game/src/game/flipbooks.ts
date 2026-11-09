// The painted effects. Each is a 2x2 flipbook, public/assets/vfx/fx-<art id>.webp, played top left, top right, bottom left, bottom right.
// Which one goes with which event is the table below; the shapes in summonView.ts still play underneath, since they carry the exact reach of a skill.
import * as THREE from 'three/webgpu';
import { texture as sample, uniform, uv } from 'three/tsl';
import type { GameEvent } from './simulation';

interface Play { id: string; size?: number; y?: number; flat?: boolean; life?: number; at?: 'to' | 'mid' | 'ahead'; turn?: boolean }
type PositionedEvent = Extract<GameEvent, { x: number; z: number }>;
const FRAMES = 4, SPRITE_ORDER = 6, FLAT_ORDER = -1, FLAT_Y = .06, DEFAULT_LIFE = .5;
// Lifted toward the camera like the characters, or the top of a wall behind one would cut through it.
const LIFT = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(.9);
const ON_EVENT: Partial<Record<PositionedEvent['type'], Play[]>> = {
  summonStart: [{ id: '120', size: 3, y: 1.2 }],
  glmThread: [{ id: '012', size: 2.6, y: 1, at: 'to' }, { id: '013', size: 2.2, flat: true, at: 'to', life: .8 }, { id: '014', size: 2.6, y: 1, at: 'to', life: .8 }],
  allyEnd: [{ id: '015', size: 2.4, y: 1 }],
  qwenOn: [{ id: '019', size: 3.4, y: 1.2 }, { id: '020', size: 3, y: 1, life: .9 }, { id: '021', size: 1.6, y: 2.6, life: .8 }],
  qwenOff: [{ id: '022', size: 3.2, y: 1 }],
  kimiPrism: [{ id: '026', size: 2.6, y: 1.2, life: .7 }],
  kimiBolt: [{ id: '027', size: 3, y: 1, at: 'mid', life: .3 }, { id: '028', size: 2.2, y: 1, at: 'to', life: .4 }],
  kimiEnd: [{ id: '029', size: 2.6, y: 1.2 }],
  seedHeal: [{ id: '033', size: 3, y: 1 }],
  decoyDrop: [{ id: '034', size: 3.2, flat: true, life: .7 }],
  decoyEnd: [{ id: '036', size: 3, y: .8 }],
  trainStart: [{ id: '040', size: 2.8, y: 1, at: 'ahead' }],
  trainHit: [{ id: '042', size: 2.6, y: .9 }],
  trainWall: [{ id: '042', size: 3.2, y: .9 }],
  trainEnd: [{ id: '043', size: 2.6, y: .9 }],
  gptReset: [{ id: '047', size: 4, flat: true, life: .7 }, { id: '049', size: 2.2, flat: true, life: .6 }, { id: '048', size: 1.6, y: 2.6 }, { id: '050', size: 3.6, y: 1.4, life: .8 }],
  claudeMark: [{ id: '054', size: 3.2, y: 1.5, life: 1 }],
  claudeStrike: [{ id: '055', size: 5.8, y: 2, life: .65 }],
  claudeExecute: [{ id: '056', size: 4.2, y: 1.5, life: .7 }, { id: '057', size: 4.6, y: 1.5, life: .7 }],
  grokWave: [{ id: '061', size: 3.6, y: 1.1, at: 'ahead' }],
  grokCharm: [{ id: '062', size: 1.5, y: 2.3, life: .7 }, { id: '063', size: 2.4, y: .9, life: .9 }],
  charmEnd: [{ id: '064', size: 2.2, y: 1.1 }],
  geminiStart: [{ id: '068', size: 2.8, y: 1.1 }],
  geminiDash: [{ id: '069', size: 3, y: 1, at: 'mid', life: .28 }, { id: '070', size: 2.4, y: 1, at: 'to', life: .32 }],
  geminiEnd: [{ id: '071', size: 3, y: 1.1 }],
  dash: [{ id: '117', size: 2.4, y: .7, life: .32 }],
  hurt: [{ id: '121', size: 2, y: 1.1, life: .3 }],
  bossStagger: [{ id: '125', size: 3.6, y: 1.8, life: 1 }],
  ultStart: [{ id: '204', size: 4, y: 1.3, life: .8 }],
  ultPunch: [{ id: '205', size: 7, y: 1, life: .6 }],
  rewardTaken: [{ id: '126', size: 2.2, y: 1 }],
  shieldBreak: [{ id: '228', size: 2.6, y: 1 }],
  phantomBreak: [{ id: '230', size: 1.8, y: 1, life: .3 }],
  mineBurst: [{ id: '230', size: 4.4, y: .6, life: .35 }],
  bossExpose: [{ id: '125', size: 4.4, y: 1.8, life: .5 }, { id: '331', size: 3.6, y: 1.8, life: 1.5 }],
  chainExposed: [{ id: '213', size: 3, y: 1.2, life: 1 }],
  chainCut: [{ id: '217', size: 3.6, y: 1.2, life: .7 }],
  iconFreed: [{ id: '217', size: 7, y: 3.6, life: 1.2 }],
  claudeForced: [{ id: '216', size: 5, y: 1.4, life: 1 }],
  bossPhase: [{ id: '125', size: 7, y: 1.4, life: 1.1 }],
  rally: [{ id: '218', size: 12, y: 1.6, life: 1.4 }, { id: '219', size: 8, y: 1.6, life: 2.2 }, { id: '333', size: 7, y: 1.6, life: 1.6 }],
  bossRush: [{ id: '301', size: 6, y: 1, life: .45 }],
  bossAdds: [{ id: '302', size: 4, y: 1.2, life: .6 }],
  bossMirrors: [{ id: '303', size: 3.4, y: 1.5, life: 1.2 }],
  bossMirrorSplit: [{ id: '304', size: 6, y: 1.6, life: .6 }],
  iconChains: [{ id: '305', size: 7, y: 3, life: 1 }],
  echoSummon: [{ id: '306', size: 3.4, flat: true, life: .7 }],
  phantomSplit: [{ id: '307', size: 3.6, y: 1.1, life: .6 }],
  thiefLand: [{ id: '308', size: 3, y: .6, life: .4 }],
  furnaceHeat: [{ id: '309', size: 3.6, y: 1.1, life: .8 }],
  weaverLink: [{ id: '310', size: 2.6, y: 1.2, life: .5 }],
  mineFuse: [{ id: '311', size: 1.6, y: .5, life: .5 }],
  decoyHit: [{ id: '312', size: 1.8, y: .9, life: .35 }],
  dashStolen: [{ id: '313', size: 2.8, y: 1, life: .5 }],
  beacon: [{ id: '329', size: 3.2, y: 1.2, life: .7 }],
};
// What a mechanism shows the moment it goes off, laid over the exact area the room draws.
const TRAP_FIRE: Record<string, Play> = { press: { id: '321', size: 4.4, y: .4, life: .4 }, stamper: { id: '326', size: 5, y: .5, life: .45 }, valve: { id: '322', size: 3.6, y: .8, life: .45 }, mirror: { id: '323', size: 3, y: 1, life: .4 }, shelf: { id: '324', size: 3, y: .6, life: .4 }, vent: { id: '325', size: 5.4, flat: true, life: .55 }, scan: { id: '327', size: 3, y: 1, life: .4 }, erase: { id: '328', size: 4, y: .8, life: .6 } };
// A hit is seen so often that it stays small and short.
const HIT: Play = { id: '121', size: 1.25, y: .8, life: .22 }, THRUST: Play = { id: '115', size: 1.8, y: 1, life: .25 }, CHARGED: Play = { id: '116', size: 3.2, y: 1, life: .4 };
const SPAWN: Play = { id: '122', size: 1.8, y: .8, life: .5 };
const BOSS_BLOW: Record<string, string> = { port: '102', library: '106', forge: '110', zero: '114' }, ENEMY_BLOW: Record<string, string> = { port: '228', library: '230', forge: '231', zero: '232' };
const IDS = [...new Set(['215', '231', '330', '332', ...Object.values(ON_EVENT).flat().map(p => p.id), ...Object.values(TRAP_FIRE).map(p => p.id), HIT.id, THRUST.id, CHARGED.id, SPAWN.id, ...Object.values(BOSS_BLOW), ...Object.values(ENEMY_BLOW)])];
// What a first run cannot start without: her own moves, the two cards she sets out with and the first region. The rest follows behind it.
const FIRST = ['115', '116', '117', '120', '121', '122', '125', '126', '204', '205', '330', '331', '012', '013', '014', '015', '026', '027', '028', '029', '102', '228', '301', '302', '306', '321', '322'];
type Track = <T>(job: Promise<T>) => Promise<T>;

interface Live { object: THREE.Object3D; offset: { value: THREE.Vector2 }; material: THREE.Material; age: number; life: number }

export class Flipbooks {
  private textures: Record<string, THREE.Texture> = {};
  private live: Live[] = [];
  private scene: THREE.Scene;
  constructor(scene: THREE.Scene) { this.scene = scene; }

  private loads: Record<string, Promise<void>> = {};
  private one(id: string, track: Track = job => job) {
    return this.loads[id] ??= track(new THREE.TextureLoader().loadAsync(`./assets/vfx/fx-${id}.webp`)).then(t => {
      t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      this.textures[id] = t;
    }).catch(error => { delete this.loads[id]; throw error; });
  }
  load(track: Track) { return Promise.all(FIRST.map(id => this.one(id, track))); }
  loadAll(track: Track) { return Promise.all(IDS.map(id => this.one(id, track))); }
  // Behind the first load, one at a time, so a slow line is not kept busy while she plays. Whatever fails here is asked for again by the next region.
  async fill() { for (const id of IDS) await this.one(id).catch(() => {}); }
  textureOf(id: string) { return this.textures[id]; }
  play(p: Play, x: number, z: number) {
    const map = this.textures[p.id]; if (!map) return;
    const offset = uniform(new THREE.Vector2(0, .5)), size = p.size ?? 2, node = sample(map, uv().mul(.5).add(offset));
    let object: THREE.Object3D, material: THREE.Material;
    if (p.flat) {
      const flat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); flat.colorNode = node; material = flat;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), flat); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, FLAT_Y, z); mesh.renderOrder = FLAT_ORDER; object = mesh;
    } else {
      const face = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false }); face.colorNode = node; material = face;
      const sprite = new THREE.Sprite(face as unknown as THREE.SpriteMaterial); sprite.scale.set(size, size, 1); sprite.position.set(x, p.y ?? 1, z).add(LIFT); sprite.renderOrder = SPRITE_ORDER; object = sprite;
    }
    this.scene.add(object);
    this.live.push({ object, offset, material, age: 0, life: p.life ?? DEFAULT_LIFE });
  }
  // What the event shows, placed from what the event says. `region` picks the blow of its enemies and boss.
  event(e: GameEvent, region: string) {
    const place = (p: Play, e: PositionedEvent) => {
      const ahead = 'aim' in e ? e.aim : 'dir' in e ? e.dir : undefined;
      const target = 'toX' in e ? { x: e.toX, z: e.toZ } : e;
      const x = p.at === 'to' ? target.x : p.at === 'mid' ? (e.x + target.x) / 2 : p.at === 'ahead' && ahead ? e.x + ahead.x * 2 : e.x, z = p.at === 'to' ? target.z : p.at === 'mid' ? (e.z + target.z) / 2 : p.at === 'ahead' && ahead ? e.z + ahead.z * 2 : e.z;
      this.play(p, x, z);
    };
    if ('x' in e) for (const p of ON_EVENT[e.type] ?? []) place(p, e);
    if (e.type === 'hit' && e.damage) place(HIT, e);
    if (e.type === 'trapFire' && TRAP_FIRE[e.kind]) this.play(TRAP_FIRE[e.kind], e.area?.x ?? e.x, e.area?.z ?? e.z);
    if (e.type === 'bossPhase' && e.kind === 'b04') { this.play({ id: '332', size: 14, y: 1.6, life: 1.2 }, e.x, e.z); this.play({ id: '218', size: 9, y: 1.4, life: 1.1 }, e.x, e.z); }
    if (e.type === 'iconCounter') this.play({ id: '215', size: e.safeRadius * 2.2, flat: true, life: 1.3 }, e.safeX, e.safeZ);
    if (e.type === 'kill') this.play({ id: '330', y: .9, size: e.boss ? 5 : 2.6, life: e.boss ? .8 : .45 }, e.x, e.z);
    if (e.type === 'strike' && e.hits) { const tip = e.range * .7; this.play(e.kind === 'charge' ? CHARGED : THRUST, e.x + e.aim.x * tip, e.z + e.aim.z * tip); }
    if (e.type === 'wave') for (const s of e.spawns) this.play({ ...SPAWN, size: s.boss ? 4 : 1.8 }, s.x, s.z);
    if (e.type === 'enemyAttack') { if (e.fake) return; const reach = e.shape === 'line' ? (e.length ?? 0) / 2 : 0; this.play({ id: (e.boss ? BOSS_BLOW : ENEMY_BLOW)[region], size: e.boss ? 4.4 : 2.6, y: .9, life: .4 }, e.x + (e.dir?.x ?? 0) * reach, e.z + (e.dir?.z ?? 0) * reach); }
  }
  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      if (f.age >= f.life) { this.remove(f); this.live.splice(i, 1); continue; }
      const frame = Math.min(FRAMES - 1, Math.floor(f.age / f.life * FRAMES));
      f.offset.value.set(frame % 2 * .5, frame < 2 ? .5 : 0);
    }
  }
  clear() { for (const f of this.live) this.remove(f); this.live.length = 0; }
  private remove(f: Live) {
    this.scene.remove(f.object); f.material.dispose();
    if ((f.object as THREE.Mesh).isMesh) (f.object as THREE.Mesh).geometry.dispose();
  }
}
