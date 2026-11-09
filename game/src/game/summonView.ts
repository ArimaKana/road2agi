// How the summon cards look and sound. The rules are in summons.ts; this only reads them, so the fight runs the same without it.
import * as THREE from 'three/webgpu';
import { texture as sample, uniform, uv, vec2 } from 'three/tsl';
import { CARDS, CLAUDE, MINIMAX, SEED, SUMMON, type CardId } from './cards';
import { glow, ring, type EnemyEntry } from './engine';
import { hud } from './hud';
import { CHUNK, GLOW, SPARK, type Particles } from './particles';
import { glyph, type Glyph } from './summonArt';
import type { Sfx } from './sfx';
import { ANIMATION_FPS, WORLD_PER_METRE, type Enemy, type Game, type GameEvent, type Vec2 } from './simulation';

interface Host {
  scene: THREE.Scene; camera: THREE.Camera; game: Game; fx: Particles; sfx: Sfx;
  addEffect(mesh: THREE.Object3D, life?: number, velocity?: THREE.Vector3 | null, grow?: number, extra?: { tick?: (dt: number, t: number) => void; ramp?: boolean }): void;
  jolt(amount: number, aim?: Vec2 | null, push?: number, zoom?: number): void;
  number(x: number, z: number, text: string, tier?: number): void;
  notice(text: string): void;
  banner(text: string): void;
  dispose(object: THREE.Object3D): void;
  decoyArt(): { map: THREE.Texture; entry: EnemyEntry };
}
// How one shape behaves over its life: grow from one size to another (`narrow` only across), turn, rise, fly to a point. `normal` is ordinary blending instead of glowing, `under` draws a sprite behind the hero.
interface Motion { grow?: [number, number]; narrow?: boolean; spin?: number; angle?: number; rise?: number; alpha?: number; fadeIn?: number; to?: Vec2; normal?: boolean; under?: boolean }
type Status = 'allied' | 'charm' | 'sealed' | 'broken' | 'lured' | 'stagger' | 'shield' | 'immune';
const TAU = Math.PI * 2, BEHIND_HERO = 4, OVER_HERO = 6;
const BOLT_COLORS = [0xff6f7d, 0xffe27a, 0x7fd8ff], GEMINI_EYES = [0xff5fd2, 0xffe27a];
const STATUS: Record<Status, number> = { allied: 0x58a6ff, charm: 0xff5f86, lured: 0x5fe3e8, sealed: 0xff9a4d, broken: 0xc08cff, stagger: 0xf0c36a, shield: 0xffb868, immune: 0xdfe8ef };
// What hangs over an enemy's head and lies under its feet while something has been done to it. The soft dark patch under a charmed one stands in for its outline.
const MARK: Record<Status, { head: Glyph; foot?: Glyph; dark?: boolean; turn?: number }> = {
  allied: { head: 'fox', foot: 'z' }, charm: { head: 'heartSealed', foot: 'halo', dark: true }, lured: { head: 'spiral', turn: 5 }, sealed: { head: 'seal', foot: 'runes', turn: 1 }, broken: { head: 'crack' }, stagger: { head: 'crack' }, shield: { head: 'crack' }, immune: { head: 'crack' },
};
// The painted icon each mark shows over the head, loaded once.
const STATUS_ICON: Record<Status, string> = { allied: 'status-turned', charm: 'status-charmed', lured: 'status-confused', sealed: 'status-sealed', broken: 'status-armorbreak', stagger: 'status-stagger', shield: 'status-shield', immune: 'status-immune' };
const icons = new Map<Status, THREE.Texture>();
function statusIcon(status: Status) {
  let icon = icons.get(status);
  if (!icon) { icon = new THREE.TextureLoader().load(`./assets/ui/${STATUS_ICON[status]}.webp`); icon.colorSpace = THREE.SRGBColorSpace; icons.set(status, icon); }
  return icon;
}
const creations = new Map<string, THREE.Texture>();
function creation(name: string) {
  let picture = creations.get(name);
  if (!picture) { picture = new THREE.TextureLoader().load(`./assets/creations/${name}.webp`); picture.colorSpace = THREE.SRGBColorSpace; creations.set(name, picture); }
  return picture;
}
// Toward the left of the screen or the right: the camera's right is +x -z.
const screenSide = (x: number, z: number) => x - z < 0 ? 'L' : 'R';
const showFrame = (entry: EnemyEntry, offset: { value: THREE.Vector2 }, index: number) => offset.value.set((index % entry.columns) / entry.columns, 1 - (Math.floor(index / entry.columns) + 1) / entry.rows);
function picture(name: string, width: number, height = width, footY = .08) {
  const mat = new THREE.SpriteNodeMaterial({ map: creation(name), transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial); sprite.center.set(.5, footY); sprite.scale.set(width, height, 1); sprite.renderOrder = BEHIND_HERO + 1;
  return { sprite, mat };
}
const basic = (color: number, extra: Record<string, unknown> = {}) => new THREE.MeshBasicNodeMaterial({ color, ...extra });
const faded = (color: number, extra: Record<string, unknown> = {}) => basic(color, { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, ...extra });
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const spread = (n: number) => (Math.random() * 2 - 1) * n;
function shake(selector: string) { const el = document.querySelector(selector); if (!el) return; el.classList.remove('denied'); void (el as HTMLElement).offsetWidth; el.classList.add('denied'); }

export class SummonView {
  private host: Host;
  private figures = new Map<CardId, HTMLImageElement>();
  private cutIns = 0;
  private geminiStep = 0;
  private decoy: { group: THREE.Group; doll: THREE.Group; sprite: THREE.Sprite; entry: EnemyEntry; offset: { value: THREE.Vector2 }; pose: string; poseAt: number; at: number; landed: boolean } | null = null;
  private live = new Map<object, THREE.Object3D>();
  private markers = new Map<number, { status: Status; group: THREE.Group; head: THREE.Sprite; foot: THREE.Mesh | null }>();
  private band: THREE.Group | null = null;
  private tracks = new WeakMap<object, Vec2>();
  constructor(host: Host) { this.host = host; }

  // Decoded ahead, or a card's first summon would slide in blank.
  load(ids: CardId[]) {
    for (const id of ids) {
      if (this.figures.has(id)) continue;
      const figure = new Image(); figure.src = `./assets/cards/${id}-figure.webp`; figure.decode().catch(() => {});
      this.figures.set(id, figure);
    }
  }
  clear() {
    for (const o of this.live.values()) this.host.dispose(o);
    for (const m of this.markers.values()) this.host.dispose(m.group);
    this.live.clear(); this.markers.clear();
    if (this.decoy) this.host.dispose(this.decoy.group);
    if (this.band) this.host.dispose(this.band);
    this.decoy = null; this.band = null;
  }

  levelUp(x: number, z: number, id: CardId, slot: number) {
    const color = CARDS[id].color;
    this.floorRing(x, z, 2.4, color, .7, .2); this.floorRing(x, z, 1.3, 0xffffff, .5);
    for (let i = 0; i < 18; i++) this.host.fx.gather(x, z, 1, 3, color);
    this.host.sfx.tone(440, 1320, .4, .08, 'triangle');
    const card = document.querySelector(`.card-slot[data-slot="${slot}"]`);
    if (card) { card.classList.remove('refreshed'); void (card as HTMLElement).offsetWidth; card.classList.add('refreshed'); }
  }

  // The parts everything below is built from.
  private sprite(name: Glyph, color: number, m: Motion = {}) {
    const mat = new THREE.SpriteNodeMaterial({ map: glyph(name), color, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false, opacity: 0 });
    if (!m.normal) mat.blending = THREE.AdditiveBlending;
    const sprite = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial); sprite.renderOrder = m.under ? BEHIND_HERO : OVER_HERO;
    return sprite;
  }
  private plane(name: Glyph, color: number, m: Motion = {}) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faded(color, { map: glyph(name), toneMapped: false, ...(m.normal ? { blending: THREE.NormalBlending } : {}) }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12; mesh.rotation.z = m.angle ?? 0;
    return mesh;
  }
  private animate(object: THREE.Object3D, material: THREE.Material, w: number, h: number, life: number, m: Motion, turn: (amount: number) => void) {
    const [from, to] = m.grow ?? [1, 1], alpha = m.alpha ?? 1, fadeIn = m.fadeIn ?? 14, start = object.position.clone();
    const size = (t: number) => { const k = from + (to - from) * easeOut(t); object.scale.set(w * k, m.narrow ? h : h * k, 1); material.opacity = alpha * Math.min(1, t * fadeIn) * (1 - t * t * t); };
    size(0);
    this.host.addEffect(object, life, null, 0, { tick: (dt, t) => {
      size(t);
      if (m.spin) turn(m.spin * dt);
      if (m.rise) object.position.y += m.rise * dt;
      if (m.to) { const k = easeOut(t); object.position.x = start.x + (m.to.x - start.x) * k; object.position.z = start.z + (m.to.z - start.z) * k; }
    } });
  }
  // One shape facing the camera, that comes in fast so that even a short effect reads.
  private flash(name: Glyph, x: number, y: number, z: number, color: number, size: number | [number, number], life: number, m: Motion = {}) {
    const [w, h] = Array.isArray(size) ? size : [size, size], sprite = this.sprite(name, color, m), mat = sprite.material;
    sprite.position.set(x, y, z); mat.rotation = m.angle ?? 0;
    this.animate(sprite, mat, w, h, life, m, amount => { mat.rotation += amount; });
    return sprite;
  }
  // A shape standing on the floor, tall as this. A sprite faces the camera, which looks down, so its middle sits higher than half its height to bring its foot to the floor.
  private column(name: Glyph, x: number, z: number, color: number, width: number, height: number, life: number, m: Motion = {}) { return this.flash(name, x, height * .61, z, color, [width, height], life, { narrow: true, ...m }); }
  // One shape lying on the floor.
  private decal(name: Glyph, x: number, z: number, color: number, size: number | [number, number], life: number, m: Motion = {}) {
    const [w, h] = Array.isArray(size) ? size : [size, size], mesh = this.plane(name, color, m);
    mesh.position.x = x; mesh.position.z = z;
    this.animate(mesh, mesh.material, w, h, life, m, amount => { mesh.rotation.z += amount; });
    return mesh;
  }
  private after(delay: number, act: () => void) {
    let left = delay, done = false;
    this.host.addEffect(new THREE.Group(), delay + .05, null, 0, { tick: dt => { left -= dt; if (left <= 0 && !done) { done = true; act(); } } });
  }
  private floorRing(x: number, z: number, radius: number, color: number, life = .45, thickness = .16) { const r = glow(ring(radius, color, .9, thickness)); r.position.set(x, .12, z); this.host.addEffect(r, life, null, 3); }
  // A ring that runs out to exactly this radius, or in from it to the middle.
  private wave(x: number, z: number, radius: number, color: number, life = .5, thickness = .12, inward = false) {
    const r = glow(ring(radius, color, .9, thickness)), mat = r.material; r.position.set(x, .12, z); r.scale.setScalar(inward ? 1 : .1);
    this.host.addEffect(r, life, null, 0, { tick: (_, t) => { const k = easeOut(t); r.scale.setScalar(inward ? Math.max(.02, 1 - k) : .1 + .9 * k); mat.opacity = .9 * (1 - t * t); } });
  }
  // A band of an arc running out across the floor.
  private arc(x: number, z: number, start: number, length: number, radius: number, color: number, life = .5) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * .82, radius, 36, 1, start, length), faded(color)), mat = mesh.material;
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .13, z);
    this.host.addEffect(mesh, life, null, 0, { tick: (_, t) => { const k = easeOut(t); mesh.scale.set(.12 + .88 * k, .12 + .88 * k, 1); mat.opacity = .6 * Math.min(1, t * 10) * (1 - t * t); } });
  }
  // A glowing line between two points, with a white core.
  private beam(x: number, z: number, toX: number, toZ: number, color: number, life = .2, width = .22, y = 1) {
    const dx = toX - x, dz = toZ - z, length = Math.hypot(dx, dz); if (length < .01) return;
    const aim = { x: dx / length, z: dz / length }, mx = x + dx / 2, mz = z + dz / 2, half = length / 2, { fx } = this.host;
    fx.line(mx, y, mz, aim, half, { kind: GLOW, color, alpha: .9, size: width, sizeEnd: .6, life });
    fx.line(mx, y, mz, aim, half, { kind: SPARK, color: 0xffffff, colorEnd: color, size: width * .3, sizeEnd: .4, life: life * .8 });
  }
  private burst(x: number, z: number, color: number, count = 16, y = 1) {
    const { fx } = this.host;
    fx.emit(x, y, z, { kind: GLOW, color: 0xffffff, colorEnd: color, alpha: .9, size: .8, sizeEnd: 1.4, life: .14 });
    fx.emit(x, y, z, { count, kind: SPARK, color: 0xffffff, colorEnd: color, speed: [3, 9], drag: 4, stretch: .05, size: [.03, .06], life: [.2, .4] });
  }

  // GLM: a fox runs out along a thread and goes into the enemy.
  private foxInto(x: number, z: number, toX: number, toZ: number) {
    const { fx, sfx } = this.host, side = Math.random() < .5 ? -1 : 1, dx = toX - x, dz = toZ - z, time = .26, life = time + .08;
    this.beam(x, z, toX, toZ, STATUS.allied, .6, .09);
    const fox = this.flash('fox', x, 1.3, z, 0xcfe6ff, 1.5, life, { to: { x: toX, z: toZ }, alpha: .95 });
    let arrived = false;
    this.host.addEffect(new THREE.Group(), life, null, 0, { tick: (_, t) => {
      const k = Math.min(1, t * life / time), bow = Math.sin(k * Math.PI) * .22 * side, px = x + dx * k - dz * bow, pz = z + dz * k + dx * bow;
      fox.position.x = px; fox.position.z = pz;
      fx.emit(px, 1.05, pz, { count: 3, kind: GLOW, color: STATUS.allied, colorEnd: 0x1f4fa0, size: [.06, .13], sizeEnd: .3, life: [.3, .6], scatter: .05 });
      if (k < 1 || arrived) return;
      arrived = true;
      this.flash('fox', toX, 1.5, toZ, 0xffffff, 1.5, .34, { grow: [.7, 1.5], alpha: .9 }); this.wave(toX, toZ, 1.5, STATUS.allied, .4); this.burst(toX, toZ, STATUS.allied, 12); sfx.tone(980, 620, .1, .05, 'sine');
    } });
  }
  // Qwen: a folding fan that opens behind the hero.
  private openFan(x: number, z: number) {
    const group = new THREE.Group(), blades = 9, step = 2.8 / blades, radius = 3.6, parts: { blade: THREE.Group; angle: number }[] = [], mats: { mat: THREE.Material; base: number }[] = [];
    const part = (geometry: THREE.BufferGeometry, color: number, base: number, parent: THREE.Group) => { const mat = faded(color, { depthTest: false, toneMapped: false }), mesh = new THREE.Mesh(geometry, mat); mesh.renderOrder = BEHIND_HERO; parent.add(mesh); mats.push({ mat, base }); return mesh; };
    for (let i = 0; i < blades; i++) {
      const blade = new THREE.Group(), from = Math.PI / 2 - step * .52, width = step * 1.04;
      part(new THREE.CircleGeometry(radius, 6, from, width), i % 2 ? 0xc9a2ff : 0x8e6fe0, .62, blade);
      part(new THREE.RingGeometry(radius - .16, radius, 6, 1, from, width), 0xe8c67a, 1, blade);
      part(new THREE.PlaneGeometry(.06, radius), 0xe8c67a, .9, blade).position.y = radius / 2;
      group.add(blade); parts.push({ blade, angle: (i - (blades - 1) / 2) * step });
    }
    group.position.set(x, .4, z); group.quaternion.copy(this.host.camera.quaternion);
    this.host.addEffect(group, .9, null, 0, { tick: (_, t) => {
      const open = easeOut(Math.min(1, t / .26));
      for (const { blade, angle } of parts) blade.rotation.z = angle * open;
      group.scale.setScalar(.8 + .24 * open);
      for (const { mat, base } of mats) mat.opacity = base * Math.min(1, t * 12) * (1 - t ** 4);
    } });
  }
  private bandView() {
    const group = new THREE.Group(), gold = glow(new THREE.Mesh(new THREE.TorusGeometry(1.45, .035, 6, 64), basic(0xe8c67a, { transparent: true, opacity: .95, depthWrite: false }))), violet = glow(new THREE.Mesh(new THREE.TorusGeometry(1.2, .03, 6, 64), basic(0xc9a2ff, { transparent: true, opacity: .9, depthWrite: false })));
    const runes = this.plane('runes', 0xe8c67a), coins = [0, 1].map(() => { const coin = this.sprite('zero', 0xf6ecc8); coin.scale.setScalar(.56); coin.material.opacity = 1; group.add(coin); return coin; });
    runes.scale.set(5, 5, 1); group.add(gold, violet, runes);
    group.userData.place = (time: number, uses: number) => {
      gold.position.y = 1.15 + Math.sin(time * 3) * .08; gold.rotation.set(Math.PI / 2 + .36, 0, time * 1.4); violet.position.y = .9 + Math.sin(time * 3 + 1.5) * .08; violet.rotation.set(Math.PI / 2 - .36, .2, -time * 1.9);
      runes.rotation.z = time * .7; runes.material.opacity = .36;
      coins.forEach((coin, i) => { const a = time * 2.4 + i * Math.PI; coin.position.set(Math.cos(a) * 1.45, 1.2 + Math.sin(a) * .5, Math.sin(a) * 1.45); coin.visible = i < uses; });
    };
    return group;
  }
  // Kimi: three crystals over a crescent, in a slow turn. They come in and go out by scale.
  private prismView() {
    const group = new THREE.Group(), moon = this.plane('crescent', 0xd9dcff), halo = this.plane('halo', 0xaab0ff);
    moon.scale.set(3, 3, 1); moon.material.opacity = .8; halo.scale.set(3.6, 3.6, 1); halo.material.opacity = .5; group.add(halo, moon);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU, p = this.sprite('prism', 0xffffff, { normal: true }); p.scale.set(.92, .92, 1); p.position.set(Math.cos(a) * .66, 1.1, Math.sin(a) * .66); p.material.opacity = 1; group.add(p); }
    return group;
  }
  // Claude: the seal, the chains of pages drawing in on the target, and the blade waiting above it.
  private sealView(radius: number) {
    const group = new THREE.Group(), color = CARDS.claude.color, outer = glow(ring(1.4, color, .95, .12)), inner = glow(ring(.8, 0xffd9a8, .9, .07)), flower = this.plane('flower', color), blade = this.sprite('blade', 0xffe3c0);
    outer.position.y = inner.position.y = .14; flower.material.opacity = .85; blade.scale.set(1.5, 6.4, 1); group.add(outer, inner, flower, blade);
    const boundary = glow(ring(radius, color, .65, .075)), runes = this.plane('runes', color);
    boundary.position.y = .1; runes.scale.set(radius * 2, radius * 2, 1); runes.material.opacity = .22; group.add(boundary, runes);
    const chains = Array.from({ length: 6 }, (_, i) => { const c = this.plane('chain', 0xffe9cf); c.material.opacity = .95; c.rotation.z = i / 6 * TAU + Math.PI / 4; group.add(c); return c; });
    group.userData.place = (k: number, time: number) => {
      outer.scale.setScalar(1.5 - k * .8); inner.scale.setScalar(1.5 - k * .8); flower.scale.set(4.2 - k * 1.4, 4.2 - k * 1.4, 1); flower.rotation.z = time * 2.4;
      blade.position.y = 8.8 - Math.pow(k, 4) * 6.4; blade.material.opacity = Math.min(1, k * 3);
      boundary.material.opacity = .35 + k * .45; runes.rotation.z = -time * .4; runes.material.opacity = .18 + k * .3;
      const reach = radius * (1 - k) + .5;
      for (const c of chains) { const d = .4 + reach / 2, a = c.rotation.z; c.scale.set(reach, .62, 1); c.position.set(Math.cos(a) * d, .16, -Math.sin(a) * d); }
    };
    return group;
  }
  private trainView(t: { dir: Vec2; width: number }) {
    const group = new THREE.Group(), side = screenSide(t.dir.x, t.dir.z), scale = t.width / MINIMAX.width;
    // A long train of the painted locomotive and two rails of film laid under it along the way it runs.
    const engine = picture(`train-${side}`, 3 * scale, 3 * scale, .18); engine.sprite.position.set(0, .1, 0); group.add(engine.sprite);
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(1.8 * scale, 1.8 * scale), new THREE.MeshBasicNodeMaterial({ map: creation(`rail-${side}`), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    rail.rotation.x = -Math.PI / 2; rail.position.y = .06; group.add(rail);
    return group;
  }
  // MiniMax: the clapper snaps shut where the train comes out.
  private clap(x: number, z: number) {
    const { fx, sfx } = this.host, life = .62, closeAt = .22, board = this.flash('clapper', x, 2, z, 0xffffff, 2, life, { normal: true }), stick = this.sprite('clapstick', 0xffffff, { normal: true }), mat = stick.material;
    stick.center.set(.1, .5); stick.scale.set(1.8, 1.8, 1); stick.position.set(x - .71, 2.5, z + .71); stick.material.rotation = .62;
    let shut = false;
    this.host.addEffect(stick, life, null, 0, { tick: (_, t) => {
      const k = Math.min(1, t / closeAt); mat.rotation = .62 * (1 - k * k); mat.opacity = Math.min(1, t * 14) * (1 - t * t * t);
      if (k < 1 || shut) return;
      shut = true;
      this.flash('halo', x, 2.3, z, 0xffe6d0, 3.4, .22, { grow: [.5, 1.3] }); sfx.tone(1800, 500, .05, .14, 'square');
      fx.emit(board.position.x, 2.3, board.position.z, { count: 16, kind: CHUNK, color: 0xffe6d0, colorEnd: CARDS.minimax.color, speed: [3, 8], drag: 3, gravity: 9, size: [.06, .12], sizeEnd: .5, life: [.3, .6] });
    } });
  }

  event(e: GameEvent) {
    const { fx, sfx } = this.host;
    switch (e.type) {
      case 'cardDenied': this.host.notice(e.reason); shake(`.card-slot[data-slot="${e.slot}"]`); sfx.tone(200, 150, .08, .05, 'square'); break;
      case 'tokenDenied': this.host.notice('Token 不足'); shake('#token'); sfx.tone(200, 150, .08, .05, 'square'); break;
      case 'summonStart': sfx.hiss(600, 1800, SUMMON.confirmAt, .05); break;
      case 'summonConfirm': {
        const color = CARDS[e.id as CardId].color;
        hud.cutIns.push({ key: ++this.cutIns, id: e.id }); this.floorRing(e.x, e.z, 1.1, color); sfx.tone(520, 880, .16, .07, 'triangle'); this.host.jolt(.1, null, 0, .012);
        for (let i = 0; i < 10; i++) fx.gather(e.x, e.z, .8, 2.4, color);
        break;
      }
      case 'glmPulse':
        this.wave(e.x, e.z, e.radius, STATUS.allied, .55, .1); this.decal('fox', e.x, e.z, STATUS.allied, 3, .7, { grow: [.5, 1.1], alpha: .6, angle: -Math.PI / 4 }); this.decal('halo', e.x, e.z, 0x1f4fa0, e.radius * 2, .55, { alpha: .35 });
        sfx.hiss(2600, 700, .22, .06);
        break;
      case 'glmThread': this.foxInto(e.x, e.z, e.toX, e.toZ); break;
      // The turning wears off: it cracks across and flashes.
      case 'allyEnd': this.flash('crack', e.x, 1.1, e.z, 0xe6f2ff, 2, .36, { grow: [.6, 1.15] }); this.flash('halo', e.x, 1.1, e.z, 0xffffff, 2.4, .16); this.burst(e.x, e.z, 0xcfe6ff, 14); sfx.tone(1500, 500, .1, .05, 'triangle'); break;
      case 'qwenOn':
        this.band = this.bandView(); this.host.scene.add(this.band); this.openFan(e.x, e.z);
        this.decal('runes', e.x, e.z, 0xe8c67a, 7, 1, { grow: [.3, 1], spin: 1.8, alpha: .9 }); this.wave(e.x, e.z, 3.4, 0xc9a2ff, .6, .14);
        fx.emit(e.x, 1.2, e.z, { count: 24, kind: GLOW, color: 0xf6ecc8, colorEnd: 0xc9a2ff, speed: [1.5, 5], drag: 2.4, size: [.05, .11], life: [.5, .9] });
        sfx.tone(440, 990, .3, .07, 'triangle'); sfx.tone(660, 1320, .36, .04, 'sine');
        break;
      // Everything the state spread out draws back into her.
      case 'qwenOff':
        if (this.band) { this.host.dispose(this.band); this.band = null; }
        this.wave(e.x, e.z, 3, 0xe8c67a, .34, .14, true); this.wave(e.x, e.z, 2, 0xc9a2ff, .28, .1, true); this.flash('zero', e.x, 1.4, e.z, 0xf6ecc8, 1, .34, { grow: [1.4, .3] });
        for (let i = 0; i < 14; i++) fx.gather(e.x, e.z, 1, 3, 0xe8c67a);
        if (e.refund) this.host.number(e.x, e.z, `+${e.refund} Token`, 1);
        sfx.tone(700, 350, .2, .05, 'triangle');
        break;
      // A shaft of white light comes down to where the crystals form.
      case 'kimiPrism':
        this.column('pillar', e.x, e.z, 0xffffff, 1.7, 11, .42, { grow: [1.2, .2] }); this.wave(e.x, e.z, 2, CARDS.kimi.color, .45); this.decal('runes', e.x, e.z, 0xbfc4ff, 3.4, .55, { grow: [.6, 1], spin: 2, alpha: .7 });
        fx.emit(e.x, 4, e.z, { count: 18, kind: SPARK, color: 0xffffff, colorEnd: 0xbfc4ff, vel: { x: 0, y: -7, z: 0 }, stretch: .05, size: [.03, .06], life: [.25, .5], scatter: .7 });
        sfx.tone(1200, 1800, .14, .05, 'sine');
        break;
      // Three colours part on the way and meet again on the target, with a star where they land.
      case 'kimiBolt': {
        const dx = e.toX - e.x, dz = e.toZ - e.z, length = Math.hypot(dx, dz) || 1, nx = -dz / length, nz = dx / length, midX = e.x + dx / 2, midZ = e.z + dz / 2;
        this.beam(e.x, e.z, e.toX, e.toZ, 0xffffff, .18, .1);
        for (let i = 0; i < 3; i++) { const off = (i - 1) * Math.min(.8, length * .14), mx = midX + nx * off, mz = midZ + nz * off, tint = BOLT_COLORS[(i + e.index) % 3]; this.beam(e.x, e.z, mx, mz, tint, .36, .32); this.beam(mx, mz, e.toX, e.toZ, tint, .36, .32); }
        this.flash('star', e.toX, 1.1, e.toZ, 0xffffff, 2.8, .34, { grow: [.3, 1], spin: 6 }); this.flash('star', e.x, 1.1, e.z, 0xd9dcff, 1.3, .2, { spin: -5 });
        for (const color of BOLT_COLORS) fx.emit(e.toX, 1.1, e.toZ, { count: 7, kind: GLOW, color: 0xffffff, colorEnd: color, speed: [2, 6], drag: 3, gravity: 3, size: [.04, .09], life: [.35, .7] });
        sfx.tone(1500, 900, .1, .06, 'sine');
        break;
      }
      case 'armorBroken': this.flash('crack', e.x, 1.1, e.z, STATUS.broken, 2.2, .4, { grow: [.5, 1.2] }); this.burst(e.x, e.z, STATUS.broken, 12, 1.1); break;
      // The crystals go, and a crescent opens and thins out where they were.
      case 'kimiEnd':
        this.flash('crescent', e.x, 1.4, e.z, 0xd9dcff, 2.6, .55, { grow: [.6, 1.3], spin: .8, alpha: .85 });
        fx.emit(e.x, 1, e.z, { count: 20, kind: GLOW, color: 0xd9dcff, colorEnd: 0x7d84ff, speed: [.5, 2.4], drag: 2, gravity: -1.5, size: [.04, .08], life: [.4, .9] });
        break;
      // A pulse the shape of a heart runs out from her, and more of them drift up.
      case 'seedHeal':
        if (e.amount) this.host.number(e.x, e.z, `+${e.amount}`, 1);
        this.decal('heart', e.x, e.z, 0x8ff0d8, 4.2, .6, { grow: [.3, 1], alpha: .85, angle: -Math.PI / 4 }); this.after(.14, () => this.decal('heart', e.x, e.z, 0x5fe3e8, 3, .5, { grow: [.3, 1], alpha: .6, angle: -Math.PI / 4 }));
        this.column('pillar', e.x, e.z, 0x8ff0d8, 2.4, 5, .6, { alpha: .55, under: true });
        for (let i = 0; i < 6; i++) this.flash('heart', e.x + spread(1), .8 + Math.random(), e.z + spread(1), i % 2 ? 0x8ff0d8 : 0x5fe3e8, .4 + Math.random() * .3, .8 + Math.random() * .3, { rise: 1.8, fadeIn: 6 });
        fx.emit(e.x, .4, e.z, { count: 30, kind: GLOW, color: 0x8ff0d8, colorEnd: 0x5fe3e8, vel: { x: 0, y: 2.4, z: 0 }, size: [.05, .1], sizeEnd: .4, life: [.5, 1], scatter: .8, fadeIn: 4 });
        this.floorRing(e.x, e.z, 1.4, 0x5fe3e8, .5); sfx.tone(660, 990, .25, .06, 'sine'); sfx.tone(990, 1320, .3, .03, 'sine');
        break;
      case 'decoyDrop': this.dropDecoy(e.x, e.z); break;
      case 'decoyHit': this.burst(e.x, e.z, 0x5fe3e8, 6, .6); if (this.decoy) { this.decoy.pose = 'hit'; this.decoy.poseAt = this.host.game.time; } break;
      case 'decoyEnd':
        if (this.decoy) { const d = this.decoy, clip = d.entry.actions.disappear; d.doll.remove(d.sprite); d.sprite.position.copy(d.group.position); this.host.addEffect(d.sprite, clip.frames / ANIMATION_FPS, null, 0, { tick: (_, t) => showFrame(d.entry, d.offset, clip.start + Math.min(clip.frames - 1, Math.floor(t * clip.frames))) }); this.host.dispose(d.group); this.decoy = null; }
        this.flash('halo', e.x, .8, e.z, 0xbff5ec, 2.6, .24, { grow: [.5, 1.3] }); this.burst(e.x, e.z, 0x5fe3e8, 16, .6); this.floorRing(e.x, e.z, 1.2, 0x5fe3e8, .35); this.host.fx.dust(e.x, e.z, 8, 2.4, 0xbff5ec);
        for (let i = 0; i < 4; i++) this.flash('heart', e.x + spread(.6), .9, e.z + spread(.6), 0x8ff0d8, .36, .6, { rise: 2.2, fadeIn: 8 });
        break;
      case 'decoyShock': this.wave(e.x, e.z, e.radius, 0x5fe3e8, .45, .24); this.decal('runes', e.x, e.z, 0x8ff0d8, e.radius * 2, .45, { grow: [.3, 1], spin: 2, alpha: .7 }); this.burst(e.x, e.z, 0x5fe3e8, 26, .6); this.host.jolt(.14); sfx.tone(160, 60, .2, .16, 'sine'); break;
      case 'trainStart':
        this.clap(e.x + e.dir.x * 1.5, e.z + e.dir.z * 1.5);
        this.decal('spiral', e.x, e.z, CARDS.minimax.color, 3, .5, { grow: [.3, 1], spin: 7, alpha: .75 }); this.host.fx.dust(e.x, e.z, 8, 3, 0xffe6d0);
        sfx.tone(180, 90, .5, .12, 'sawtooth'); sfx.hiss(500, 1600, .5, .09);
        break;
      case 'trainHit': {
        const color = CARDS.minimax.color;
        this.flash('star', e.x, 1, e.z, 0xffe6d0, 1.9, .24, { grow: [.4, 1], spin: 5 }); this.burst(e.x, e.z, color, 12, .8); this.host.jolt(.1, e.dir, .04);
        fx.emit(e.x, .8, e.z, { count: 9, kind: CHUNK, color: 0xffe6d0, colorEnd: color, dir: { x: e.dir.x, y: .5, z: e.dir.z }, spread: .8, speed: [3, 7], drag: 2, gravity: 10, size: [.05, .1], sizeEnd: .5, life: [.3, .55] });
        sfx.tone(240, 110, .1, .12, 'square');
        break;
      }
      case 'trainEnd': this.burst(e.x, e.z, CARDS.minimax.color, 18, .6); fx.dust(e.x, e.z, 8, 2.6); fx.emit(e.x, .7, e.z, { count: 14, kind: CHUNK, color: 0xffe6d0, colorEnd: 0x2b1a1c, speed: [1.5, 5], drag: 2, gravity: 8, size: [.06, .12], sizeEnd: .6, life: [.4, .8] }); break;
      case 'trainBlast': this.wave(e.x, e.z, e.radius, CARDS.minimax.color, .42, .28); this.flash('star', e.x, 1, e.z, 0xffe6d0, e.radius * 1.5, .3, { grow: [.3, 1], spin: 3 }); this.burst(e.x, e.z, CARDS.minimax.color, 26, .6); this.host.jolt(.18); sfx.tone(140, 50, .22, .18, 'sine'); break;
      case 'trainWall': this.flash('crack', e.x, .9, e.z, 0xffe6d0, 2.2, .3, { grow: [.5, 1.1] }); this.burst(e.x, e.z, CARDS.minimax.color, 22, .6); this.host.jolt(.18); sfx.tone(120, 50, .16, .2, 'sine'); break;
      // The clock runs back, ripples go out, her feet light up, and the dragon's wings open once behind her.
      case 'gptReset': {
        const color = CARDS.gpt.color;
        this.clockBack(e.x, e.z); this.flash('wings', e.x, 2.4, e.z, 0xece8ff, [6.4, 5], .85, { grow: [.35, 1], fadeIn: 8, alpha: .85, under: true, rise: .35 });
        for (let i = 0; i < 3; i++) this.after(i * .11, () => this.wave(e.x, e.z, 4.6, i ? color : 0xffffff, .55, .14));
        this.decal('halo', e.x, e.z, 0xece8ff, 2.8, .7, { alpha: .9 }); fx.dust(e.x, e.z, 8, 2, color);
        fx.emit(e.x, .1, e.z, { count: 24, kind: SPARK, color: 0xffffff, colorEnd: color, vel: { x: 0, y: 5.5, z: 0 }, stretch: .05, size: [.03, .06], life: [.25, .55], scatter: .5 });
        sfx.tone(1200, 300, .28, .05, 'triangle'); sfx.tone(300, 1200, .22, .07, 'triangle');
        for (const el of document.querySelectorAll('.card-slot')) { el.classList.remove('refreshed'); void (el as HTMLElement).offsetWidth; el.classList.add('refreshed'); }
        break;
      }
      case 'claudeMark':
        sfx.tone(180, 560, CLAUDE.delay * .9, .08, 'triangle'); sfx.tone(720, 1080, .6, .035, 'sine');
        this.wave(e.x, e.z, 4.4, CARDS.claude.color, .65, .12, true);
        this.flash('seal', e.x, 2.7, e.z, 0xffd9a8, 2.2, CLAUDE.delay, { grow: [.6, 1], fadeIn: 10 });
        break;
      // The blade falls, the flower opens under it and pages blow out.
      case 'claudeStrike': {
        const color = CARDS.claude.color;
        this.column('blade', e.x, e.z, 0xffe9cf, 2.2, 11, .42, { grow: [1, .35], fadeIn: 30 }); this.column('pillar', e.x, e.z, color, 4.8, 11, .32, { alpha: .65 });
        this.decal('flower', e.x, e.z, color, e.splash * 2, .8, { grow: [.3, 1], spin: 1.2 }); this.wave(e.x, e.z, e.splash, 0xffd9a8, .48, .28);
        this.after(.12, () => this.wave(e.x, e.z, e.splash, color, .6, .12));
        this.decal('crack', e.x, e.z, 0xffd9a8, e.splash * 1.7, .65, { grow: [.8, 1], alpha: .6 });
        this.burst(e.x, e.z, color, 44);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + spread(.2), d = 2.2 + Math.random() * 1.4; this.flash('petal', e.x, 1, e.z, i % 2 ? color : 0xffd9a8, .85, .46, { to: { x: e.x + Math.cos(a) * d, z: e.z + Math.sin(a) * d }, spin: spread(9), angle: a }); }
        fx.emit(e.x, 1, e.z, { count: 12, kind: CHUNK, color: 0xfff6e8, speed: [2, 6], drag: 2.4, gravity: 3, spin: 8, size: [.08, .13], sizeEnd: .7, life: [.5, .9] });
        // Her binding ring breaks: the pieces of it fly apart when she is unbound.
        if (e.unbound) {
          for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, shard = new THREE.Mesh(new THREE.RingGeometry(3, 3.34, 6, 1, a, TAU / 8 * .8), faded(0xffe3c0)), mat = shard.material; shard.rotation.x = -Math.PI / 2; shard.position.set(e.x, .14, e.z); this.host.addEffect(shard, .6, null, 0, { tick: (_, t) => { shard.scale.setScalar(1 + easeOut(t) * .8); shard.rotation.z = t * (i % 2 ? .6 : -.6); mat.opacity = 1 - t * t; } }); }
          fx.emit(e.x, 2.2, e.z, { count: 26, kind: SPARK, color: 0xfff0d6, colorEnd: color, speed: [6, 14], drag: 3, gravity: 7, stretch: .07, size: [.04, .08], life: [.3, .6] });
        }
        this.host.jolt(.48, null, 0, .035); sfx.tone(85, 28, .48, .3, 'sine'); sfx.tone(360, 90, .24, .1, 'triangle'); sfx.hiss(3200, 240, .32, .2);
        break;
      }
      // The enemy is signed off: it comes apart into squares of data that rise away.
      case 'claudeExecute':
        this.host.number(e.x, e.z, '处决', 2); this.flash('seal', e.x, 1.2, e.z, 0xffd9a8, 2.4, .5, { grow: [1.3, .7] });
        fx.emit(e.x, .9, e.z, { count: 40, kind: CHUNK, color: 0xffffff, colorEnd: CARDS.claude.color, vel: { x: 0, y: 2.8, z: 0 }, size: [.05, .12], sizeEnd: .1, life: [.5, 1.2], scatter: .55, fadeIn: 6 });
        fx.emit(e.x, 1, e.z, { count: 24, kind: GLOW, color: 0xffd9a8, colorEnd: CARDS.claude.color, speed: [1, 4], drag: 2, gravity: -2, size: [.04, .09], life: [.5, 1] });
        break;
      // Three arcs of the moon run out across the fan, with hearts flying among them.
      case 'grokWave': {
        const aimAngle = Math.atan2(e.aim.z, e.aim.x), start = Math.atan2(-e.aim.z, e.aim.x) - e.half, color = CARDS.grok.color;
        const fan = glow(new THREE.Mesh(new THREE.CircleGeometry(e.radius, 36, start, e.half * 2), basic(color, { transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide }))), mat = fan.material;
        fan.rotation.x = -Math.PI / 2; fan.position.set(e.x, .12, e.z);
        this.host.addEffect(fan, .55, null, 0, { tick: (_, t) => { mat.opacity = .3 * (1 - t); fan.scale.set(.5 + .5 * Math.min(1, t * 4), .5 + .5 * Math.min(1, t * 4), 1); } });
        for (let i = 0; i < 3; i++) this.after(i * .09, () => this.arc(e.x, e.z, start, e.half * 2, e.radius * (1 - i * .08), i === 1 ? 0xffd7a8 : color));
        this.flash('crescent', e.x + e.aim.x * 1.7, 1.5, e.z + e.aim.z * 1.7, 0xffd7a8, 2.6, .5, { grow: [.5, 1.2], alpha: .9, to: { x: e.x + e.aim.x * 3, z: e.z + e.aim.z * 3 } });
        for (let i = 0; i < 12; i++) { const a = aimAngle + spread(e.half), d = e.radius * (.45 + Math.random() * .5); this.flash('heart', e.x + e.aim.x * .8, 1 + Math.random() * .6, e.z + e.aim.z * .8, i % 3 ? color : 0xffa6be, .4 + Math.random() * .3, .5 + Math.random() * .2, { to: { x: e.x + Math.cos(a) * d, z: e.z + Math.sin(a) * d }, fadeIn: 10 }); }
        sfx.tone(700, 300, .3, .06, 'sine'); sfx.hiss(1200, 3000, .25, .05);
        break;
      }
      case 'grokCharm':
        this.flash('heart', e.x, 1.3, e.z, 0xff9ab5, 1.7, .42, { grow: [.3, 1], alpha: .95 }); this.decal('halo', e.x, e.z, 0x5a1030, 2.6, .5, { normal: true, alpha: .6 });
        fx.emit(e.x, 1.2, e.z, { count: 10, kind: GLOW, color: 0xff9ab5, colorEnd: CARDS.grok.color, vel: { x: 0, y: 1.4, z: 0 }, size: [.06, .1], life: [.4, .7], scatter: .4 });
        sfx.tone(880, 1180, .1, .03, 'sine');
        break;
      // The charm lifts: slivers of the moon scatter.
      case 'charmEnd':
        this.burst(e.x, e.z, 0xffc2d2, 8, 1.2);
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + spread(.3); this.flash('crescent', e.x, 1.3, e.z, i % 2 ? 0xffd7a8 : 0xffc2d2, .55, .5, { to: { x: e.x + Math.cos(a) * 1.5, z: e.z + Math.sin(a) * 1.5 }, spin: spread(10), fadeIn: 20 }); }
        break;
      case 'bossStagger': this.host.banner('失衡'); this.burst(e.x, e.z, 0xffffff, 30, 1.4); this.host.jolt(.3); sfx.tone(160, 70, .4, .2, 'sawtooth'); break;
      // Her two stars open a way in.
      case 'geminiStart':
        this.geminiStep = 0; this.burst(e.x, e.z, CARDS.gemini.color, 16); this.decal('runes', e.x, e.z, CARDS.gemini.color, 4.2, .5, { grow: [.4, 1], spin: 4, alpha: .8 });
        for (const [i, color] of GEMINI_EYES.entries()) this.flash('star', e.x + (i ? 1 : -1) * .8, 1.4, e.z - (i ? 1 : -1) * .8, color, 2.2, .46, { grow: [.3, 1], spin: i ? 6 : -6 });
        sfx.hiss(900, 3200, .2, .07);
        break;
      // A zigzag that stays a moment, a pale image of her on the way, and a star with a cross-cut where she lands.
      case 'geminiDash': {
        const tint = GEMINI_EYES[this.geminiStep++ % 2];
        this.beam(e.x, e.z, e.toX, e.toZ, tint, .5, .22); this.beam(e.x, e.z, e.toX, e.toZ, 0xffffff, .2, .09); this.dashPoses(e.x, e.z, e.toX, e.toZ);
        this.flash('star', e.toX, 1.1, e.toZ, tint, 2.6, .34, { grow: [.3, 1], spin: 8 });
        this.beam(e.toX - .8, e.toZ - .8, e.toX + .8, e.toZ + .8, 0xffffff, .16, .12, 1.1); this.beam(e.toX - .8, e.toZ + .8, e.toX + .8, e.toZ - .8, 0xffffff, .16, .12, 1.1);
        this.burst(e.toX, e.toZ, tint, 8); sfx.hiss(3200, 1200, .08, .06);
        break;
      }
      // Four stars close in on the last target and go off as one.
      case 'geminiEnd': {
        const color = CARDS.gemini.color;
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; this.flash('star', e.x + Math.cos(a) * 2.6, 1.2, e.z + Math.sin(a) * 2.6, GEMINI_EYES[i % 2], 1.2, .2, { to: { x: e.x, z: e.z }, spin: 12, fadeIn: 30 }); }
        this.after(.16, () => { this.flash('star', e.x, 1.2, e.z, 0xfff0c4, 5.4, .42, { grow: [.25, 1], spin: 2.4, alpha: .8 }); this.flash('halo', e.x, 1.2, e.z, 0xffe27a, 4, .26, { grow: [.5, 1.2] }); this.wave(e.x, e.z, 2.8, color, .4, .16); this.burst(e.x, e.z, 0xffe27a, 30); this.host.jolt(.2); sfx.tone(900, 300, .2, .08, 'triangle'); });
        break;
      }
    }
  }

  private clockBack(x: number, z: number) {
    this.decal('clock', x, z, 0xece8ff, 7, .9, { grow: [.5, 1], spin: .5, fadeIn: 10 });
    const group = new THREE.Group(), hands = [{ w: .14, l: 2.1, turns: -5 }, { w: .1, l: 3, turns: -12 }].map(({ w, l, turns }) => {
      const geometry = new THREE.PlaneGeometry(w, l); geometry.translate(0, l / 2, 0);
      const hand = new THREE.Mesh(geometry, faded(0xffffff)); hand.position.y = .02; group.add(hand);
      return { hand, turns };
    });
    group.rotation.x = -Math.PI / 2; group.position.set(x, .14, z);
    this.host.addEffect(group, .9, null, 0, { tick: (_, t) => {
      for (const { hand, turns } of hands) { hand.rotation.z = easeOut(t) * turns; hand.material.opacity = Math.min(1, t * 10) * (1 - t ** 3); }
    } });
  }
  // Gemini passing by in her dash pose, then her cut where she lands. She only exists for these moments.
  private dashPoses(fromX: number, fromZ: number, toX: number, toZ: number) {
    const side = screenSide(toX - fromX, toZ - fromZ);
    for (const [frame, x, z, life] of [[1, (fromX + toX) / 2, (fromZ + toZ) / 2, .18], [2, toX, toZ, .3]] as const) {
      const { sprite, mat } = picture(`gemini-${side}-${frame}`, 3.4, 2.27, .1); sprite.position.set(x, .1, z);
      this.host.addEffect(sprite, life, null, 0, { tick: (_, t) => { mat.opacity = t < .6 ? 1 : (1 - t) / .4; } });
    }
  }
  // A dark-bobbed doll that falls from above, bounces, and has its reach marked on the floor.
  private dropDecoy(x: number, z: number) {
    if (this.decoy) this.host.dispose(this.decoy.group);
    const group = new THREE.Group(), doll = new THREE.Group(), { map, entry } = this.host.decoyArt(), offset = uniform(new THREE.Vector2());
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false }); mat.colorNode = sample(map, uv().mul(vec2(1 / entry.columns, 1 / entry.rows)).add(offset));
    const sprite = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial); sprite.center.set(entry.anchor[0], entry.anchor[1]); sprite.scale.set(entry.metres[0] * WORLD_PER_METRE, entry.metres[1] * WORLD_PER_METRE, 1); sprite.renderOrder = BEHIND_HERO + 1; doll.add(sprite);
    const circle = this.plane('runes', 0x5fe3e8), reach = ring(SEED.taunt, 0x5fe3e8, .3, .05);
    circle.scale.set(2.8, 2.8, 1); circle.material.opacity = .85; group.add(doll, circle, reach);
    group.position.set(x, 0, z); this.host.scene.add(group); this.decoy = { group, doll, sprite, entry, offset, pose: 'appear', poseAt: this.host.game.time, at: this.host.game.time, landed: false };
    doll.position.y = 5; this.wave(x, z, 1.8, 0x5fe3e8, .35, .12, true);
  }
  // It pops up, bounces, is squashed for a moment by a hit, and bounces again.
  private decoyFrame(d: NonNullable<SummonView['decoy']>, time: number) {
    let clip = d.entry.actions[d.pose], step = Math.floor((time - d.poseAt) * ANIMATION_FPS);
    if (!clip.loop && step >= clip.frames) { d.pose = 'idle'; d.poseAt = time; clip = d.entry.actions.idle; step = 0; }
    showFrame(d.entry, d.offset, clip.start + (clip.loop ? step % clip.frames : step));
  }
  private follow<T extends object>(list: T[], make: (item: T) => THREE.Object3D, place: (object: THREE.Object3D, item: T) => void) {
    for (const item of list) {
      let object = this.live.get(item);
      if (!object) { object = make(item); this.live.set(item, object); this.host.scene.add(object); }
      place(object, item);
    }
    return new Set<object>(list);
  }
  private statusOf(e: Enemy): Status | null {
    const { decoy } = this.host.game;
    if (e.allied > 0) return 'allied';
    if (e.charm > 0) return 'charm';
    if (e.sealed > 0) return 'sealed';
    if (e.staggered > 0) return 'stagger';
    if (e.broken > 0) return 'broken';
    if (decoy && !e.boss && (e.elite ? e.lured > 0 : Math.hypot(decoy.x - e.x, decoy.z - e.z) <= SEED.taunt)) return 'lured';
    if (e.shieldHp > 0) return 'shield';
    if (e.alliedImmune > 0 || e.charmImmune > 0) return 'immune';
    return null;
  }
  private markerFor(status: Status) {
    const { head: headName, foot: footName, dark } = MARK[status], color = STATUS[status], group = new THREE.Group(), head = this.sprite(headName, color); head.material.map = statusIcon(status); head.material.color.setHex(0xffffff); head.scale.set(.82, .82, 1); head.material.opacity = 1; group.add(head);
    let foot: THREE.Mesh | null = null;
    if (footName) { foot = this.plane(footName, dark ? 0x3a0a22 : color, { normal: dark }); foot.scale.set(dark ? 2.6 : 1.9, dark ? 2.6 : 1.9, 1); (foot.material as THREE.Material).opacity = dark ? .75 : .85; group.add(foot); }
    this.host.scene.add(group);
    return { status, group, head, foot };
  }
  update() {
    const { game, fx } = this.host, h = game.hero, time = game.time;
    if (h.hasteTime > 0 && h.moving && game.state === 'playing') fx.dashTrail(h.x, h.z, h.heading);
    if (this.band) { this.band.position.set(h.x, 0, h.z); this.band.userData.place(time, h.zeroCharges); }
    if (this.decoy) {
      const d = this.decoy, age = time - d.at, fall = .2, landed = age >= fall;
      d.doll.position.y = landed ? 0 : 5 * (1 - (age / fall) ** 2);
      this.decoyFrame(d, time);
      d.group.children[1].rotation.z = time * 1.2;
      if (landed && !d.landed) { d.landed = true; const { x, z } = d.group.position; this.wave(x, z, 2.4, 0x8ff0d8, .4, .16); this.floorRing(x, z, 1.3, 0x5fe3e8); fx.dust(x, z, 10, 2.6); this.host.jolt(.06); }
    }
    const alive = new Set<object>();
    for (const item of this.follow(game.prisms, () => this.prismView(), (o, p) => {
      const appear = Math.min(1, p.age * 7), leave = Math.min(1, (p.life - p.age) / .22);
      o.position.set(p.x, Math.sin(time * 4) * .06, p.z); o.rotation.y = time * 1.6; o.scale.setScalar(Math.max(.01, appear * leave));
    })) alive.add(item);
    for (const item of this.follow(game.trains, t => this.trainView(t), (o, t) => {
      o.position.set(t.x, 0, t.z);
      fx.emit(t.x - t.dir.x * 2, .5, t.z - t.dir.z * 2, { count: 2, kind: SPARK, color: 0xffd9c4, colorEnd: CARDS.minimax.color, vel: { x: -t.dir.x * 2, y: .6, z: -t.dir.z * 2 }, stretch: .08, size: [.03, .05], life: [.2, .4], scatter: .3 });
      fx.emit(t.x + t.dir.x * .8, 1.2, t.z + t.dir.z * .8, { kind: GLOW, color: 0xffe6d0, alpha: .4, vel: { x: 0, y: 1.8, z: 0 }, size: [.1, .18], sizeEnd: 1.4, life: [.35, .6], scatter: .06 });
      // A strip of film is laid down behind it for a track, one frame at a time.
      const last = this.tracks.get(t);
      if (!last) this.tracks.set(t, { x: t.x, z: t.z });
      else if (Math.hypot(t.x - last.x, t.z - last.z) >= 1.15) {
        this.decal('film', (t.x + last.x) / 2, (t.z + last.z) / 2, 0xffffff, [1.25, t.width * 2], 1.1, { angle: Math.atan2(-t.dir.z, t.dir.x), normal: true, alpha: .8, fadeIn: 30 });
        this.tracks.set(t, { x: t.x, z: t.z });
      }
    })) alive.add(item);
    for (const item of this.follow(game.seals, s => this.sealView(s.stats.splashRadius), (o, s) => { o.position.set(s.x, 0, s.z); o.userData.place(s.age / CLAUDE.delay, time); })) alive.add(item);
    for (const [item, object] of this.live) if (!alive.has(item)) { this.host.dispose(object); this.live.delete(item); }
    // What has been done to an enemy shows over its head and under its feet, on top of the tint on its body.
    const seen = new Set<number>();
    for (const e of game.enemies) {
      const status = e.arrive > 0 ? null : this.statusOf(e); if (status === null) continue;
      seen.add(e.id);
      let m = this.markers.get(e.id);
      if (m && m.status !== status) { this.host.dispose(m.group); m = undefined; }
      if (!m) { m = this.markerFor(status); this.markers.set(e.id, m); }
      const pulse = 1 + Math.sin(time * 6) * .08;
      m.group.position.set(e.x, 0, e.z); m.head.position.y = (e.boss ? 2.7 : 1.8) + Math.sin(time * 5) * .05; m.head.scale.set(.72 * pulse, .72 * pulse, 1); m.head.material.rotation = time * (MARK[status].turn ?? 0);
      if (m.foot) m.foot.rotation.z = time * 1.4;
    }
    for (const [id, m] of this.markers) if (!seen.has(id)) { this.host.dispose(m.group); this.markers.delete(id); }
  }
}
