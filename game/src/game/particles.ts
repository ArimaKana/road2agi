import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, cameraProjectionMatrix, cos, float, length, max, modelViewMatrix, positionGeometry, pow, select, sin, smoothstep, step, vec2, vec4 } from 'three/tsl';

// Every particle is one instanced camera-facing quad, so all of them cost a single draw call. Quads stretch along their velocity, which is what makes a spark read as a streak.
// The output is premultiplied, so additive glow (no alpha written) and alpha-blended dust share one blend state.
export const GLOW = 0, SPARK = 1, CHUNK = 2, FLARE = 3, HALO = 4;
const TAU = Math.PI * 2, GROUND = .04;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
type Range = number | [number, number];
const pick = (v: Range) => Array.isArray(v) ? rand(v[0], v[1]) : v;
const rgb = (hex: number) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

interface Vec3 { x: number; y?: number; z: number }
interface Aim { x: number; z: number }
export interface EmitOptions {
  count?: number; kind?: number; additive?: number; alpha?: number; color?: number; colorEnd?: number; speed?: Range; dir?: Vec3; spread?: number; flat?: number; vel?: Vec3;
  gravity?: number; drag?: number; stretch?: number; size?: Range; sizeEnd?: number; life?: Range; scatter?: number; fadeIn?: number; bounce?: number; spin?: number; radiance?: number;
}
interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; sizeEnd: number; gravity: number; drag: number; stretch: number; kind: number; additive: number; alpha: number; fadeIn: number; bounce: number; rot: number; spin: number; radiance: number;
  r0: number; g0: number; b0: number; r1: number; g1: number; b1: number;
}

export class Particles {
  capacity: number;
  items: Particle[] = [];
  pool: Particle[] = [];
  geometry: THREE.InstancedBufferGeometry;
  position: THREE.InstancedBufferAttribute;
  stretch: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, capacity = 2400) {
    this.capacity = capacity;
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2) as unknown as THREE.InstancedBufferGeometry); geometry.instanceCount = 0; this.geometry = geometry;
    const instanced = (name: string, size: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size); a.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, a); return a; };
    this.position = instanced('iPosition', 3); this.stretch = instanced('iStretch', 3); this.color = instanced('iColor', 4); this.shape = instanced('iShape', 4);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, toneMapped: false, fog: false });
    const iPosition = attribute('iPosition', 'vec3'), iStretch = attribute('iStretch', 'vec3'), iColor = attribute('iColor', 'vec4'), iShape = attribute('iShape', 'vec4');
    material.vertexNode = Fn(() => {
      const view = modelViewMatrix.mul(vec4(iPosition, 1)).toVar();
      const axis = modelViewMatrix.mul(vec4(iStretch, 0)).xy.toVar(), len = length(axis).toVar();
      const along = select(len.greaterThan(.001), axis.div(len), vec2(cos(iShape.z), sin(iShape.z))).toVar();
      const across = vec2(along.y.negate(), along.x);
      const offset = along.mul(positionGeometry.x).mul(iShape.x.add(len)).add(across.mul(positionGeometry.y).mul(iShape.x));
      return cameraProjectionMatrix.mul(vec4(view.xy.add(offset), view.z, 1));
    })();
    const vUv = positionGeometry.xy.toVarying('vUv'), vColor = iColor.toVarying('vColor'), vKind = vec2(iShape.y, iShape.w).toVarying('vKind');
    material.fragmentNode = Fn(() => {
      const d = length(vUv);
      const glow = pow(max(float(0), float(1).sub(d)), 1.8), spark = float(1).sub(smoothstep(.2, 1, d)), chunk = step(max(abs(vUv.x), abs(vUv.y)), .82);
      const falloff = pow(max(float(0), float(1).sub(d)), 2);
      const star = max(pow(max(float(0), float(1).sub(abs(vUv.x))), 18), pow(max(float(0), float(1).sub(abs(vUv.y))), 28)).mul(falloff);
      const halo = float(1).sub(smoothstep(.018, .075, abs(d.sub(.66))));
      const shape = select(vKind.x.lessThan(.5), glow, select(vKind.x.lessThan(1.5), spark, select(vKind.x.lessThan(2.5), chunk, select(vKind.x.lessThan(3.5), star, halo))));
      const a = vColor.a.mul(shape);
      return vec4(vColor.rgb.mul(a), a.mul(float(1).sub(vKind.y)));
    })();
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8; scene.add(this.mesh);
  }
  clear() { this.pool.push(...this.items); this.items.length = 0; this.geometry.instanceCount = 0; }
  // speed/life/size take a number or a [min,max]. dir plus spread is a cone, flat keeps a burst near the ground, vel sets the velocity outright.
  emit(x: number, y: number, z: number, o: EmitOptions = {}) {
    const c0 = rgb(o.color ?? 0xffffff), c1 = o.colorEnd === undefined ? c0 : rgb(o.colorEnd), count = o.count ?? 1, scatter = o.scatter ?? 0;
    for (let i = 0; i < count && this.items.length < this.capacity; i++) {
      const p = this.pool.pop() || ({} as Particle);
      let vx, vy, vz;
      if (o.vel) { vx = o.vel.x; vy = o.vel.y ?? 0; vz = o.vel.z; }
      else {
        let dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(-1, 1), l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        if (o.dir) { const t = Math.tan(o.spread ?? .5); dx = o.dir.x + dx * t; dy = (o.dir.y || 0) + dy * t; dz = o.dir.z + dz * t; l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
        if (o.flat !== undefined) { dy = Math.abs(dy) * o.flat; l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
        const speed = pick(o.speed ?? 0); vx = dx * speed; vy = dy * speed; vz = dz * speed;
      }
      p.x = x + rand(-scatter, scatter); p.y = y + (o.flat !== undefined ? 0 : rand(-scatter, scatter)); p.z = z + rand(-scatter, scatter); p.vx = vx; p.vy = vy; p.vz = vz;
      p.age = 0; p.life = pick(o.life ?? .3); p.size = pick(o.size ?? .06); p.sizeEnd = o.sizeEnd ?? .2; p.gravity = o.gravity ?? 0; p.drag = o.drag ?? 0; p.stretch = o.stretch ?? 0; p.kind = o.kind ?? GLOW; p.additive = o.additive ?? 1; p.alpha = o.alpha ?? 1; p.fadeIn = o.fadeIn ?? 0; p.bounce = o.bounce ?? 0; p.rot = rand(0, TAU); p.spin = o.spin ? rand(-o.spin, o.spin) : 0;
      p.r0 = c0[0]; p.g0 = c0[1]; p.b0 = c0[2]; p.r1 = c1[0]; p.g1 = c1[1]; p.b1 = c1[2]; p.radiance = o.radiance ?? 1;
      if (p.kind === FLARE) p.rot = 0;
      this.items.push(p);
    }
  }
  update(dt: number) {
    const items = this.items, P = this.position.array, S = this.stretch.array, C = this.color.array, K = this.shape.array;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i]; p.age += dt;
      if (p.age >= p.life) { items[i] = items[items.length - 1]; items.pop(); this.pool.push(p); continue; }
      const drag = Math.exp(-p.drag * dt); p.vx *= drag; p.vy = p.vy * drag - p.gravity * dt; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
      if (p.y < GROUND && p.gravity > 0) { p.y = GROUND; p.vy = -p.vy * p.bounce; p.vx *= .55; p.vz *= .55; p.spin *= .5; }
    }
    for (let i = 0; i < items.length; i++) {
      const p = items[i], t = p.age / p.life, a = p.alpha * (p.fadeIn ? Math.min(1, t * p.fadeIn) : 1) * (1 - t * t), size = p.size * (1 + (p.sizeEnd - 1) * t), i3 = i * 3, i4 = i * 4;
      const radiance = p.radiance;
      P[i3] = p.x; P[i3 + 1] = p.y; P[i3 + 2] = p.z;
      S[i3] = p.vx * p.stretch; S[i3 + 1] = p.vy * p.stretch; S[i3 + 2] = p.vz * p.stretch;
      C[i4] = (p.r0 + (p.r1 - p.r0) * t) * radiance; C[i4 + 1] = (p.g0 + (p.g1 - p.g0) * t) * radiance; C[i4 + 2] = (p.b0 + (p.b1 - p.b0) * t) * radiance; C[i4 + 3] = a;
      K[i4] = size; K[i4 + 1] = p.kind; K[i4 + 2] = p.rot; K[i4 + 3] = p.additive;
    }
    this.geometry.instanceCount = items.length;
    for (const a of [this.position, this.stretch, this.color, this.shape]) a.needsUpdate = true;
  }
  // A still, drawn-out glow: the body of a stab.
  line(x: number, y: number, z: number, aim: Aim, half: number, o: EmitOptions) { this.emit(x, y, z, { ...o, vel: { x: aim.x, y: 0, z: aim.z }, stretch: half }); }
  // A colored corona and a small white-hot star, without a full-screen flash.
  flare(x: number, y: number, z: number, color: number, size = 1, life = .24, halo = false) {
    this.emit(x, y, z, { kind: GLOW, color, alpha: .38, radiance: 2, size: size * 1.3, sizeEnd: 1.5, life });
    this.emit(x, y, z, { kind: FLARE, color: 0xf4fbff, colorEnd: color, radiance: 3, size, sizeEnd: .4, life: life * .75 });
    if (halo) this.emit(x, y, z, { kind: HALO, color, alpha: .32, radiance: 1.8, size: size * .7, sizeEnd: 2.4, life: life * 1.5 });
  }
  chargeGlow(x: number, z: number, aim: Aim, progress: number) {
    this.emit(x + aim.x * 1.15, 1.1, z + aim.z * 1.15, { kind: GLOW, color: 0xffb868, radiance: 2.4, alpha: .22 + progress * .23, size: .38 + progress * .4, sizeEnd: .7, life: .16 });
    this.emit(x + aim.x * 1.15, 1.1, z + aim.z * 1.15, { kind: FLARE, color: 0xffedd0, radiance: 2.5, alpha: .3 + progress * .4, size: .4 + progress * .6, sizeEnd: .5, life: .12 });
  }
  dust(x: number, z: number, count = 6, speed = 1.6, color = 0x93a7b6, size: Range = [.22, .42]) {
    this.emit(x, .12, z, { count, kind: GLOW, additive: 0, alpha: .34, color, flat: .28, speed: [speed * .4, speed], drag: 5, life: [.32, .6], size, sizeEnd: 2.4, scatter: .12 });
  }
  thrust(x: number, z: number, aim: Aim, range: number, color: number, charged: boolean) {
    const y = 1.2, half = range / 2, mx = x + aim.x * (half + .3), mz = z + aim.z * (half + .3);
    this.line(mx, y, mz, aim, half, { kind: GLOW, color, alpha: .85, size: charged ? .5 : .32, sizeEnd: .5, life: charged ? .18 : .13 });
    this.line(mx, y, mz, aim, half, { kind: SPARK, color: 0xffffff, colorEnd: color, radiance: 2.5, size: charged ? .12 : .07, sizeEnd: .3, life: charged ? .14 : .1 });
    if (charged) this.flare(x + aim.x * range, y, z + aim.z * range, color, 1.5, .26, true);
    for (let i = 0, n = charged ? 22 : 13; i < n; i++) {
      const t = rand(.15, 1) * range, speed = rand(3, charged ? 12 : 9);
      this.emit(x + aim.x * t, y + rand(-.16, .16), z + aim.z * t, { kind: SPARK, color: 0xffffff, colorEnd: color, vel: { x: aim.x * speed, y: rand(-.5, .8), z: aim.z * speed }, stretch: .055, drag: 6, size: [.03, .06], life: [.12, .26] });
    }
  }
  slam(x: number, z: number, radius: number, color: number) {
    this.flare(x, .8, z, color, Math.min(radius * .8, 4), .38, true);
    this.emit(x, .3, z, { kind: GLOW, color: 0xffffff, colorEnd: color, alpha: .6, size: radius * .75, sizeEnd: 1.5, life: .12 });
    this.emit(x, .12, z, { count: 48, kind: SPARK, color: 0xffffff, colorEnd: color, flat: .16, speed: [7, 17], drag: 4, gravity: 6, stretch: .045, size: [.045, .08], life: [.2, .44], scatter: .3 });
    this.emit(x, .15, z, { count: 18, kind: CHUNK, additive: 0, color: 0x6d8598, dir: { x: 0, y: 1, z: 0 }, spread: .8, speed: [3, 8], gravity: 17, bounce: .3, size: [.05, .11], sizeEnd: .7, life: [.5, .85], spin: 12, scatter: radius * .35 });
    this.dust(x, z, 14, 4.5, 0x93a7b6, [.35, .6]);
  }
  // Where a hit lands: a white flash, a star of rays, then sparks thrown on along the blow.
  impact(x: number, y: number, z: number, dx: number, dz: number, tier: number, color: number) {
    const scale = [1, 1.4, 1.9][tier], dir = dx || dz ? { x: dx, y: .28, z: dz } : undefined;
    this.flare(x, y, z, color, .85 * scale, .18 + tier * .04, tier > 0);
    this.emit(x, y, z, { kind: GLOW, color: 0xffffff, colorEnd: color, alpha: .85, size: .85 * scale, sizeEnd: 1.4, life: .07 + tier * .02 });
    this.emit(x, y, z, { count: 4 + tier * 2, kind: SPARK, color: 0xffffff, colorEnd: color, speed: 1, stretch: 1.05 * scale, size: .075 * scale, sizeEnd: .1, life: .1 + tier * .03 });
    this.emit(x, y, z, { count: [18, 28, 42][tier], kind: SPARK, color: 0xffffff, colorEnd: color, dir, spread: .85, speed: [5, 12 + tier * 5], drag: 3, gravity: 9, stretch: .05, size: [.045, .085], life: [.2, .42 + tier * .08] });
    if (dir) this.emit(x, y, z, { count: 6 + tier * 3, kind: SPARK, color, dir: { x: -dx * .7, y: .7, z: -dz * .7 }, spread: .7, speed: [2, 7], drag: 3, gravity: 9, stretch: .04, size: [.035, .06], life: [.16, .34] });
    if (tier) { this.emit(x, y, z, { count: 6 * tier, kind: GLOW, color, speed: [1, 3], drag: 2, gravity: -.7, size: [.07, .12], life: [.4, .85] }); this.dust(x, z, 3 + tier * 2, 2.4); }
  }
  // A kill: the body breaks into chunks and data motes.
  shatter(x: number, z: number, dx: number, dz: number, boss: boolean, color: number) {
    const y = boss ? 1.1 : .6, scale = boss ? 2.2 : 1, dir = { x: dx, y: .55, z: dz };
    this.emit(x, .5, z, { count: Math.round(7 * scale), kind: GLOW, additive: 0, alpha: .36, color: 0x4a5a69, speed: [.5, 1.8], drag: 3, gravity: -.5, size: [.4, .7], sizeEnd: 2.2, life: [.5, .9], scatter: .2, fadeIn: 2.5 }); // Smoke rises out of the flash, so it fades in behind it instead of darkening its core.
    this.emit(x, y, z, { kind: GLOW, color: 0xffffff, colorEnd: color, size: 1.5 * scale, sizeEnd: 1.7, life: .16 });
    this.emit(x, y, z, { count: Math.round(16 * scale), kind: CHUNK, additive: 0, color, colorEnd: 0x4a3640, dir: dx || dz ? dir : { x: 0, y: 1, z: 0 }, spread: .95, speed: [3, 10], gravity: 18, bounce: .35, size: [.05, .12], sizeEnd: .7, life: [.5, .95], spin: 14 });
    this.emit(x, y, z, { count: Math.round(20 * scale), kind: GLOW, color: 0x94dccc, colorEnd: 0x3f86ff, speed: [.8, 3.2], drag: 1.6, gravity: -1.8, size: [.035, .075], sizeEnd: .4, life: [.55, 1.2], scatter: .25 });
    this.emit(x, y, z, { count: Math.round(24 * scale), kind: SPARK, color: 0xffffff, colorEnd: 0x94dccc, speed: [5, 14], drag: 3.5, gravity: 8, stretch: .05, size: [.04, .075], life: [.2, .45] });
  }
  spawn(x: number, z: number, boss: boolean) {
    const scale = boss ? 1.8 : 1;
    this.emit(x, .1, z, { count: Math.round(14 * scale), kind: SPARK, color: 0xffb9a8, colorEnd: 0xff6b6f, dir: { x: 0, y: 1, z: 0 }, spread: .25, speed: [2, 6], drag: 2, stretch: .05, size: [.024, .05], life: [.25, .55], scatter: .35 * scale });
    this.dust(x, z, Math.round(5 * scale), 2);
  }
  dashTrail(x: number, z: number, aim: Aim) {
    this.emit(x, rand(.3, 1.7), z, { kind: SPARK, color: 0xcfe9ff, colorEnd: 0x4d9bff, radiance: 2.2, vel: { x: -aim.x * rand(1, 3), y: rand(-.2, .4), z: -aim.z * rand(1, 3) }, stretch: .12, size: [.02, .04], life: [.14, .28], scatter: .2 });
  }
  // Sparks drawn in toward a point on the body. The ultimate pulls from far off, a charge from close to.
  gather(x: number, z: number, from: number, to: number, color = 0x4d9bff) {
    const a = rand(0, TAU), r = rand(from, to), life = rand(.32, .55), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = rand(.1, 2.8);
    this.emit(px, py, pz, { kind: SPARK, color, colorEnd: 0xffffff, radiance: 2, vel: { x: (x - px) / life, y: (1.1 - py) / life, z: (z - pz) / life }, stretch: .05, size: [.024, .05], sizeEnd: 1, life, fadeIn: 3 });
  }
  ultShock(x: number, z: number, radius: number) {
    this.slam(x, z, radius, 0x8fc6ff);
    this.emit(x, .2, z, { count: 60, kind: SPARK, color: 0xffffff, colorEnd: 0x6fb0ff, flat: .5, speed: [8, 22], drag: 3, gravity: 8, stretch: .04, size: [.03, .07], life: [.25, .6] });
    this.emit(x, .2, z, { count: 30, kind: GLOW, color: 0x8fc6ff, colorEnd: 0x3f86ff, speed: [.8, 3], drag: 1.4, gravity: -2, size: [.04, .09], sizeEnd: .4, life: [.7, 1.4], scatter: radius * .5 });
  }
  aura(x: number, z: number) {
    const a = rand(0, TAU), r = rand(.3, .75);
    this.emit(x + Math.cos(a) * r, rand(.05, .5), z + Math.sin(a) * r, { kind: GLOW, color: 0x8cc4ff, colorEnd: 0x3f86ff, vel: { x: 0, y: rand(.9, 2.1), z: 0 }, size: [.035, .07], sizeEnd: .3, life: [.45, .9], alpha: .8, fadeIn: 4 });
  }
  // Dust in the air around the point the camera is on.
  mote(x: number, z: number) {
    this.emit(x + rand(-16, 16), rand(.2, 1.4), z + rand(-16, 16), { kind: GLOW, color: 0x6fb7e8, vel: { x: rand(-.12, .12), y: rand(.15, .4), z: rand(-.12, .12) }, size: [.035, .075], sizeEnd: .6, life: [2.5, 5], alpha: .4, fadeIn: 3 });
  }
}
