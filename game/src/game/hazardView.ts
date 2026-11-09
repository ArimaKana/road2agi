// How the things enemies leave in the room look. It only reads the game, so the fight runs the same without it.
import * as THREE from 'three/webgpu';
import { texture as sample, uniform, uv } from 'three/tsl';
import type { Blast, HeatRing } from './enemies';
import { SEED } from './cards';
import type { Game } from './simulation';
import { LineWarning } from './lineWarning';

const FLOOR_Y = .08, HAZARD = 0xff5a2c, GAP = 0x8fe6ff, LIFT = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(.9);
const RING_SEGMENTS = 72, RING_ROW = RING_SEGMENTS + 1;
const SHOT_ART: Record<string, string> = { data: '228', bolt: '230', thread: '231' };
interface Host { scene: THREE.Scene; game: Game; decals: Record<string, THREE.Texture>; flipbook(id: string): THREE.Texture | undefined }

function flat<G extends THREE.BufferGeometry>(geometry: G, map: THREE.Texture | null, color = 0xffffff) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = FLOOR_Y; mesh.renderOrder = -1;
  return mesh;
}

// Keep the topology and GPU buffers for a ring's whole lifetime. Scaling the mesh
// would also scale its thickness, so only its vertex positions change as it grows.
class HeatRingGeometry extends THREE.RingGeometry {
  private reach = NaN;
  private width = NaN;
  private gapHalf = NaN;
  private directions = new Float64Array(RING_ROW * 2);
  constructor() {
    super(.01, 1, RING_SEGMENTS, 1);
    (this.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  }
  update(ring: HeatRing) {
    const { reach, width, gapHalf } = ring;
    if (reach === this.reach && width === this.width && gapHalf === this.gapHalf) return;
    if (gapHalf !== this.gapHalf) {
      for (let i = 0; i < RING_ROW; i++) {
        const angle = gapHalf + i / RING_SEGMENTS * (Math.PI * 2 - gapHalf * 2);
        this.directions[i * 2] = Math.cos(angle); this.directions[i * 2 + 1] = Math.sin(angle);
      }
    }
    const inner = Math.max(.01, reach - width / 2), outer = reach + width / 2, position = this.getAttribute('position');
    for (let i = 0; i < RING_ROW; i++) {
      const x = this.directions[i * 2], y = this.directions[i * 2 + 1];
      position.setXY(i, x * inner, y * inner); position.setXY(i + RING_ROW, x * outer, y * outer);
    }
    // The material has no texture; its UVs and flat normals do not need updates.
    position.needsUpdate = true; this.boundingSphere!.radius = outer;
    this.reach = reach; this.width = width; this.gapHalf = gapHalf;
  }
}

export class HazardView {
  private host: Host;
  private blasts = new Map<number, THREE.Mesh>();
  private shots = new Map<number, { sprite: THREE.Sprite; offset: { value: THREE.Vector2 } }>();
  private mines = new Map<number, { ring: THREE.Mesh; fuse: THREE.Mesh }>();
  private rings = new Map<number, THREE.Mesh<HeatRingGeometry>>();
  private blocks = new Map<number, THREE.Mesh>();
  private threads = new Map<number, THREE.Mesh>();
  private lures = new Map<number, THREE.Mesh>();
  private mirrors = new Map<number, { mesh: THREE.Mesh; glass: THREE.Mesh; age: number }>();
  constructor(host: Host) { this.host = host; }

  private blastMesh(b: Blast) {
    const { decals } = this.host;
    if (b.shape === 'line') return new LineWarning(b);
    if (b.shape === 'circle') return flat(new THREE.PlaneGeometry(b.radius * 2, b.radius * 2), b.style === 'fake' ? decals['foot-dashed'] : b.damage ? decals['warn-circle'] : decals.landing);
    return flat(new THREE.CircleGeometry(b.radius, 40, -b.arc / 2, b.arc), b.style === 'fake' || b.style === 'gap' ? null : decals['warn-circle'], b.style === 'fake' ? 0xdfe8ef : b.style === 'gap' ? GAP : 0xffffff);
  }
  private placeBlast(mesh: THREE.Mesh, b: Blast, time: number) {
    if (mesh instanceof LineWarning) { mesh.update(b, time); return; }
    const k = 1 - b.delay / Math.max(b.total, .01), material = mesh.material as THREE.MeshBasicNodeMaterial, angle = Math.atan2(-b.dir.z, b.dir.x);
    material.opacity = b.style === 'gap' ? .3 : b.style === 'fake' ? .22 : b.style === 'aim' ? (b.track > 0 && b.delay > b.track ? .45 : .9) : (.32 + .55 * k) * (.82 + Math.sin(time * 22) * .18);
    mesh.position.set(b.x, FLOOR_Y, b.z);
    if (b.shape === 'fan') mesh.rotation.z = angle;
  }
  update(time: number) {
    const { game, scene, flipbook, decals } = this.host;
    sync(this.blasts, game.blasts, b => { const m = this.blastMesh(b); scene.add(m); return m; }, (m, b) => this.placeBlast(m, b, time), m => drop(scene, m));
    // A side mirror rises out of the floor, facing the camera's way into the room, and lights up as it aims.
    sync(this.mirrors, game.sideMirrors, m => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.2, .14), new THREE.MeshBasicNodeMaterial({ color: 0x5c4a2a }));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.9), new THREE.MeshBasicNodeMaterial({ color: 0x6f6ab8 })); glass.position.z = .08;
      const shine = new THREE.Mesh(new THREE.PlaneGeometry(.22, 3), new THREE.MeshBasicNodeMaterial({ color: 0xdcd8ff, transparent: true, opacity: .35 })); shine.position.set(-.25, 0, .09); shine.rotation.z = -.3;
      mesh.add(glass, shine); mesh.position.set(m.x, 0, m.z); mesh.rotation.y = Math.PI / 4; mesh.scale.y = .01; scene.add(mesh);
      return { mesh, glass, age: 0 };
    }, (v, m) => {
      v.age = Math.min(1, v.age + 1 / 40); v.mesh.scale.y = Math.max(.01, v.age); v.mesh.position.y = 1.5 * v.age;
      const lit = game.blasts.some(b => b.x === m.x && b.z === m.z);
      (v.glass.material as THREE.MeshBasicNodeMaterial).color.setHex(lit ? 0xf4f0ff : 0x6f6ab8);
    }, v => { for (const part of v.mesh.children) drop(scene, part as THREE.Mesh); drop(scene, v.mesh); });
    sync(this.shots, game.shots, s => {
      const offset = uniform(new THREE.Vector2(0, .5)), material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false }), map = flipbook(SHOT_ART[s.look]);
      if (map) material.colorNode = sample(map, uv().mul(.5).add(offset));
      const sprite = new THREE.Sprite(material as unknown as THREE.SpriteMaterial); sprite.scale.set(s.look === 'bolt' ? 2 : 1.1, s.look === 'bolt' ? 2 : 1.1, 1); sprite.renderOrder = 6; scene.add(sprite);
      return { sprite, offset };
    }, (v, s) => {
      v.sprite.position.set(s.x, .8, s.z).add(LIFT);
      const frame = Math.floor(time * 10) % 4; v.offset.value.set(frame % 2 * .5, frame < 2 ? .5 : 0);
    }, v => { scene.remove(v.sprite); (v.sprite.material as THREE.Material).dispose(); });
    sync(this.mines, game.mines, () => {
      const ring = flat(new THREE.PlaneGeometry(4.4, 4.4), decals['foot-dashed'], 0xffd9c8), fuse = flat(new THREE.PlaneGeometry(4.4, 4.4), decals['warn-circle']);
      scene.add(ring, fuse);
      return { ring, fuse };
    }, (v, m) => {
      v.ring.position.set(m.x, FLOOR_Y, m.z); v.fuse.position.set(m.x, FLOOR_Y, m.z);
      (v.ring.material as THREE.MeshBasicNodeMaterial).opacity = .85;
      (v.fuse.material as THREE.MeshBasicNodeMaterial).opacity = m.fuse >= 0 ? .4 + Math.sin(time * 30) * .3 : .12;
    }, v => { drop(scene, v.ring); drop(scene, v.fuse); });
    sync(this.rings, game.rings, () => { const m = flat(new HeatRingGeometry(), null, HAZARD); (m.material as THREE.Material).blending = THREE.AdditiveBlending; (m.material as THREE.MeshBasicNodeMaterial).opacity = .85; scene.add(m); return m; }, (m, r) => {
      m.visible = r.reach > .1;
      if (m.visible) m.geometry.update(r);
      m.position.set(r.x, .1, r.z); m.rotation.z = -r.gapAt;
    }, m => drop(scene, m));
    sync(this.blocks, game.blocks, b => { const m = flat(new THREE.CircleGeometry(b.radius, 40, -b.arc / 2, b.arc), decals['warn-line'], 0xbfd4e6); (m.material as THREE.MeshBasicNodeMaterial).opacity = .7; m.position.set(b.x, FLOOR_Y, b.z); m.rotation.z = Math.atan2(-b.dir.z, b.dir.x); scene.add(m); return m; }, () => {}, m => drop(scene, m));
    // A weaver's threads stay visible over cover, so they can be followed back to it.
    const linked = game.enemies.filter(e => e.shieldBy && e.shieldHp > 0).map(e => ({ id: e.id, e, from: game.enemies.find(o => o.id === e.shieldBy) }));
    sync(this.threads, linked, () => { const m = flat(new THREE.PlaneGeometry(1, .09), null, 0xffb868); (m.material as THREE.MeshBasicNodeMaterial).depthTest = false; (m.material as THREE.MeshBasicNodeMaterial).opacity = .9; m.renderOrder = 7; scene.add(m); return m; }, (m, l) => {
      m.visible = !!l.from; if (!l.from) return;
      const dx = l.e.x - l.from.x, dz = l.e.z - l.from.z;
      m.position.set((l.e.x + l.from.x) / 2, .5, (l.e.z + l.from.z) / 2); m.rotation.z = Math.atan2(-dz, dx); m.scale.x = Math.hypot(dx, dz);
    }, m => drop(scene, m));
    // A line from the decoy to each enemy it has drawn, so what it is doing can be seen.
    const { decoy } = game, drawn = decoy ? game.enemies.filter(e => e.hp > 0 && !e.boss && e.allied <= 0 && e.arrive <= 0 && (e.elite ? e.lured > 0 : Math.hypot(decoy.x - e.x, decoy.z - e.z) <= SEED.taunt)) : [];
    sync(this.lures, drawn, () => { const m = flat(new THREE.PlaneGeometry(1, .07), null, 0x5fe3e8); (m.material as THREE.MeshBasicNodeMaterial).opacity = .55; scene.add(m); return m; }, (m, e) => {
      const dx = decoy!.x - e.x, dz = decoy!.z - e.z;
      m.position.set((decoy!.x + e.x) / 2, FLOOR_Y, (decoy!.z + e.z) / 2); m.rotation.z = Math.atan2(-dz, dx); m.scale.x = Math.hypot(dx, dz);
    }, m => drop(scene, m));
  }
  clear() {
    for (const m of this.blasts.values()) drop(this.host.scene, m);
    for (const v of this.shots.values()) { this.host.scene.remove(v.sprite); (v.sprite.material as THREE.Material).dispose(); }
    for (const v of this.mines.values()) { drop(this.host.scene, v.ring); drop(this.host.scene, v.fuse); }
    for (const m of [...this.rings.values(), ...this.blocks.values(), ...this.threads.values(), ...this.lures.values()]) drop(this.host.scene, m);
    for (const v of this.mirrors.values()) { for (const part of v.mesh.children) drop(this.host.scene, part as THREE.Mesh); drop(this.host.scene, v.mesh); }
    this.blasts.clear(); this.shots.clear(); this.mines.clear(); this.rings.clear(); this.blocks.clear(); this.threads.clear(); this.lures.clear(); this.mirrors.clear();
  }
}
function drop(scene: THREE.Scene, mesh: THREE.Mesh) { scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
// Keeps one drawn thing per live item: makes what is new, updates what stays and removes what is gone.
function sync<T extends { id: number }, V>(views: Map<number, V>, items: T[], make: (item: T) => V, place: (view: V, item: T) => void, remove: (view: V) => void) {
  const alive = new Set<number>();
  for (const item of items) {
    alive.add(item.id);
    let view = views.get(item.id);
    if (!view) { view = make(item); views.set(item.id, view); }
    place(view, item);
  }
  for (const [id, view] of views) if (!alive.has(id)) { remove(view); views.delete(id); }
}
