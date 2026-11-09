import * as THREE from 'three/webgpu';
import { abs, float, fract, fwidth, max, min, mix, smoothstep, uniform, uv } from 'three/tsl';
import type { Blast } from './enemies';

const AMBER = new THREE.Color(0xffb66e), DANGER = new THREE.Color(0xff684c);
const FRIEND = new THREE.Color(0x80e4f2), FAKE = new THREE.Color(0xc8cbdc);

// One plane per warning. All detail is measured in world units so long aim lines
// and short, wide attacks keep the same fine edges without stretching a decal.
export class LineWarning extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> {
  private size = uniform(new THREE.Vector2(1, 1));
  private flow = uniform(0);
  private strength = uniform(1);
  private tint = uniform(new THREE.Color());

  constructor(b: Blast) {
    super(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    }));
    const point = uv(), across = abs(point.x.sub(.5)).mul(this.size.x), along = point.y.mul(this.size.y);
    const sideDistance = this.size.x.mul(.5).sub(across), endDistance = min(along, this.size.y.sub(along));
    const aa = max(fwidth(sideDistance), .008), endAA = max(fwidth(along), .008);
    const rail = float(1).sub(smoothstep(.025, aa.add(.025), sideDistance));
    const cap = float(1).sub(smoothstep(.025, endAA.add(.025), endDistance));
    const glow = float(1).sub(smoothstep(.025, .14, sideDistance));
    const endFade = smoothstep(0, min(.28, this.size.y.mul(.2)), endDistance);

    // The tip of each chevron points away from the attacker. Their spacing and
    // travel speed stay constant when a tracking beam changes length.
    const spacing = max(2, this.size.x.mul(2.8)), arrowPosition = along.add(across.mul(1.5));
    const phase = fract(arrowPosition.sub(this.flow).div(spacing)).mul(spacing);
    const arrowDistance = min(phase, spacing.sub(phase));
    const arrows = float(1).sub(smoothstep(.035, max(fwidth(arrowPosition), .012).add(.035), arrowDistance))
      .mul(float(1).sub(smoothstep(.3, .42, abs(point.x.sub(.5))))).mul(endFade);
    // False beams retain a visibly broken outline, in addition to their pale tint.
    const dashed = b.style === 'fake' ? smoothstep(.18, .28, fract(along.div(.7))) : float(1);
    const edge = max(rail.mul(dashed), cap.mul(.55));
    const detail = max(edge, arrows.mul(.7));
    this.material.colorNode = mix(this.tint, uniform(new THREE.Color(0xffedd4)), detail.mul(b.camp === 'ally' || b.style === 'gap' || b.style === 'fake' ? .1 : .38));
    this.material.opacityNode = float(.065).add(glow.mul(.09)).add(edge.mul(.65)).add(arrows.mul(.45))
      .mul(this.strength).clamp(0, .92);
    this.rotation.x = -Math.PI / 2; this.renderOrder = -1;
    this.update(b, 0);
  }

  update(b: Blast, time: number) {
    const progress = THREE.MathUtils.clamp(1 - b.delay / Math.max(b.total, .01), 0, 1);
    const tracking = b.track > 0 && b.delay > b.track;
    const locked = b.style === 'aim' && !tracking ? 1 : 0;
    this.size.value.set(Math.max(.001, b.width), Math.max(.001, b.length));
    this.flow.value = time * .9;
    this.tint.value.copy(b.style === 'fake' ? FAKE : b.camp === 'ally' || b.style === 'gap' ? FRIEND : b.style === 'aim' ? AMBER : DANGER);
    if (b.style === 'aim' && b.camp === 'enemy') this.tint.value.lerp(DANGER, locked * .8);
    this.strength.value = b.style === 'fake' ? .32 : b.style === 'gap' ? .4 : .6 + progress * .18 + locked * (.18 + Math.sin(time * 12) * .035);
    this.visible = b.width > 0 && b.length > 0;
    this.position.set(b.x + b.dir.x * b.length / 2, .08, b.z + b.dir.z * b.length / 2);
    this.rotation.z = Math.atan2(-b.dir.z, b.dir.x) - Math.PI / 2;
    this.scale.set(b.width, b.length, 1);
  }
}
