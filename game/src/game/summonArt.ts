// The flat shapes the summon effects are built from, each drawn once on a canvas. They hold the place of the painted effects in the art list.
// Most are white so a material can tint them. The film, the clapper and the prism carry their own colours.
import * as THREE from 'three/webgpu';

type Draw = (c: CanvasRenderingContext2D, s: number) => void;
const TAU = Math.PI * 2;
const outline = (c: CanvasRenderingContext2D, points: number[][], s: number) => { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)); c.closePath(); };
const turned = (c: CanvasRenderingContext2D, s: number, count: number, draw: (i: number) => void) => { for (let i = 0; i < count; i++) { c.save(); c.translate(s / 2, s / 2); c.rotate(i / count * TAU); c.translate(-s / 2, -s / 2); draw(i); c.restore(); } };
const circle = (c: CanvasRenderingContext2D, s: number, radius: number, width: number) => { c.lineWidth = width * s; c.beginPath(); c.arc(s / 2, s / 2, radius * s, 0, TAU); c.stroke(); };
const petal = (c: CanvasRenderingContext2D, s: number, from: number, to: number, width: number) => { const m = s / 2; c.beginPath(); c.moveTo(m, from * s); c.quadraticCurveTo(m + width * s, (from + to) / 2 * s, m, to * s); c.quadraticCurveTo(m - width * s, (from + to) / 2 * s, m, from * s); c.fill(); };

const heart: Draw = (c, s) => { const m = s / 2; c.beginPath(); c.moveTo(m, s * .9); c.bezierCurveTo(s * .08, s * .58, s * .02, s * .3, s * .22, s * .17); c.bezierCurveTo(s * .36, s * .08, s * .46, s * .17, m, s * .3); c.bezierCurveTo(s * .54, s * .17, s * .64, s * .08, s * .78, s * .17); c.bezierCurveTo(s * .98, s * .3, s * .92, s * .58, m, s * .9); c.fill(); };

const SHAPES = {
  star(c, s) { const m = s / 2, r = s * .48, w = s * .05; c.beginPath(); c.moveTo(m, m - r); c.quadraticCurveTo(m + w, m - w, m + r, m); c.quadraticCurveTo(m + w, m + w, m, m + r); c.quadraticCurveTo(m - w, m + w, m - r, m); c.quadraticCurveTo(m - w, m - w, m, m - r); c.fill(); },
  heart,
  // A heart with a stitch across it: charmed enemies cannot act.
  heartSealed(c, s) { heart(c, s); c.globalCompositeOperation = 'destination-out'; c.lineWidth = s * .05; c.beginPath(); c.moveTo(s * .2, s * .46); c.lineTo(s * .8, s * .46); c.stroke(); for (let i = 0; i < 4; i++) { const x = s * (.3 + i * .133); c.beginPath(); c.moveTo(x, s * .38); c.lineTo(x, s * .54); c.stroke(); } },
  crescent(c, s) { c.beginPath(); c.arc(s / 2, s / 2, s * .46, 0, TAU); c.fill(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(s * .64, s * .42, s * .38, 0, TAU); c.fill(); },
  clock(c, s) { circle(c, s, .47, .022); circle(c, s, .4, .008); turned(c, s, 12, i => { c.fillRect(s / 2 - s * (i % 3 ? .006 : .012), s * .045, s * (i % 3 ? .012 : .024), s * (i % 3 ? .04 : .075)); }); },
  flower(c, s) { c.globalAlpha = .55; turned(c, s, 12, () => petal(c, s, .5, .02, .09)); c.globalAlpha = 1; c.translate(s / 2, s / 2); c.rotate(TAU / 24); c.translate(-s / 2, -s / 2); turned(c, s, 12, () => petal(c, s, .5, .16, .05)); c.beginPath(); c.arc(s / 2, s / 2, s * .05, 0, TAU); c.fill(); },
  petal(c, s) { petal(c, s, .98, .02, .24); },
  // The fox of GLM's card: ears, cheeks and two slanted eyes cut out.
  fox(c, s) { outline(c, [[.5, .4], [.66, .33], [.82, .05], [.84, .4], [.97, .56], [.7, .7], [.5, .95], [.3, .7], [.03, .56], [.16, .4], [.18, .05], [.34, .33]], s); c.fill(); c.globalCompositeOperation = 'destination-out'; for (const eye of [[[.27, .5], [.44, .6], [.32, .61]], [[.73, .5], [.56, .6], [.68, .61]]]) { outline(c, eye, s); c.fill(); } },
  z(c, s) { circle(c, s, .46, .03); circle(c, s, .39, .01); c.font = `700 ${s * .56}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Z', s / 2, s * .52); },
  zero(c, s) { circle(c, s, .43, .08); c.font = `700 ${s * .56}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('0', s / 2, s * .53); },
  spiral(c, s) { c.lineWidth = s * .06; c.lineCap = 'round'; c.beginPath(); for (let i = 0; i <= 90; i++) { const a = i / 90 * TAU * 2.6, r = s * (.04 + i / 90 * .42); const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); },
  seal(c, s) { circle(c, s, .46, .04); turned(c, s, 4, () => c.fillRect(s * .47, s * .01, s * .06, s * .17)); turned(c, s, 8, () => petal(c, s, .5, .16, .07)); },
  crack(c, s) { c.lineWidth = s * .03; c.lineJoin = 'miter'; turned(c, s, 6, i => { const m = s / 2, w = i % 2 ? .05 : -.05; c.beginPath(); c.moveTo(m, m); c.lineTo(m + w * s, s * .34); c.lineTo(m - w * s * .4, s * .2); c.lineTo(m + w * s * .7, s * (i % 3 ? .03 : .1)); c.stroke(); }); },
  runes(c, s) { circle(c, s, .47, .012); circle(c, s, .36, .012); turned(c, s, 36, i => c.fillRect(s * .496, s * (i % 3 ? .06 : .05), s * .008, s * (i % 3 ? .04 : .08))); turned(c, s, 6, () => { outline(c, [[.5, .12], [.525, .165], [.5, .21], [.475, .165]], s); c.fill(); }); },
  halo(c, s) { const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, '#fff'); g.addColorStop(.45, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, s, s); },
  // A soft column of light that is brightest down its middle and dies out toward its top.
  pillar(c, s) { const across = c.createLinearGradient(0, 0, s, 0); across.addColorStop(0, 'rgba(255,255,255,0)'); across.addColorStop(.5, '#fff'); across.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = across; c.fillRect(0, 0, s, s); c.globalCompositeOperation = 'destination-in'; const up = c.createLinearGradient(0, 0, 0, s); up.addColorStop(0, 'rgba(255,255,255,0)'); up.addColorStop(.7, '#fff'); up.addColorStop(1, 'rgba(255,255,255,.8)'); c.fillStyle = up; c.fillRect(0, 0, s, s); },
  // Tip down, for a blade that falls from above.
  blade(c, s) { const g = c.createLinearGradient(0, 0, s, 0); g.addColorStop(.18, 'rgba(255,255,255,0)'); g.addColorStop(.5, '#fff'); g.addColorStop(.82, 'rgba(255,255,255,0)'); c.fillStyle = g; outline(c, [[.5, 1], [.82, .14], [.5, 0], [.18, .14]], s); c.fill(); },
  // The white dragon's wings, spread.
  wings(c, s) { for (const flip of [1, -1]) { c.save(); c.translate(s / 2, 0); c.scale(flip, 1); c.translate(-s / 2, 0); c.beginPath(); c.moveTo(s * .52, s * .66); c.quadraticCurveTo(s * .66, s * .24, s * .98, s * .06); c.quadraticCurveTo(s * .95, s * .4, s * .86, s * .56); c.quadraticCurveTo(s * .8, s * .48, s * .76, s * .64); c.quadraticCurveTo(s * .69, s * .54, s * .65, s * .74); c.quadraticCurveTo(s * .59, s * .66, s * .52, s * .66); c.globalAlpha = .55; c.fill(); c.globalAlpha = 1; c.lineWidth = s * .012; c.stroke(); for (const [x, y] of [[.86, .56], [.76, .64], [.65, .74]]) { c.beginPath(); c.moveTo(s * .6, s * .42); c.lineTo(s * x, s * y); c.stroke(); } c.restore(); } },
  // Book pages strung on a chain, for Claude's bindings. It runs along the length of the canvas.
  chain(c, s) { const count = 5, w = s / count; for (let i = 0; i < count; i++) { const x = i * w; c.globalAlpha = 1; c.lineWidth = s * .018; c.beginPath(); c.ellipse(x + w * .22, s / 2, w * .2, s * .1, 0, 0, TAU); c.stroke(); c.globalAlpha = .9; c.fillRect(x + w * .46, s * .3, w * .46, s * .4); } },
  film(c, s) { c.fillStyle = '#2b1a1c'; c.fillRect(0, 0, s, s); c.fillStyle = '#ffe6d0'; for (let i = 0; i < 8; i++) { const x = (i + .25) / 8 * s; c.fillRect(x, s * .05, s * .06, s * .1); c.fillRect(x, s * .85, s * .06, s * .1); } for (let i = 0; i < 2; i++) { const g = c.createLinearGradient(0, s * .2, 0, s * .8); g.addColorStop(0, '#ffb593'); g.addColorStop(1, '#ff7a5c'); c.fillStyle = g; c.fillRect(s * (.04 + i * .5), s * .22, s * .42, s * .56); } },
  clapper(c, s) { c.fillStyle = '#20161a'; c.fillRect(s * .08, s * .3, s * .84, s * .62); c.fillStyle = '#ffe6d0'; for (const y of [.5, .62, .74]) c.fillRect(s * .16, s * y, s * .68, s * .025); c.fillRect(s * .5, s * .5, s * .025, s * .3); },
  clapstick(c, s) { c.fillStyle = '#20161a'; c.fillRect(0, s * .4, s, s * .2); c.fillStyle = '#ffe6d0'; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(s * (i * .2 + .02), s * .6); c.lineTo(s * (i * .2 + .12), s * .4); c.lineTo(s * (i * .2 + .2), s * .4); c.lineTo(s * (i * .2 + .1), s * .6); c.fill(); } },
  // Kimi's crystal, with its own glassy colours.
  prism(c, s) { const g = c.createLinearGradient(s * .2, s * .1, s * .8, s * .9); g.addColorStop(0, '#ffffff'); g.addColorStop(.55, '#bfc4ff'); g.addColorStop(1, '#6d73d8'); outline(c, [[.5, .06], [.92, .9], [.08, .9]], s); c.globalAlpha = .9; c.fillStyle = g; c.fill(); c.globalAlpha = 1; c.strokeStyle = '#fff'; c.lineWidth = s * .03; c.stroke(); c.strokeStyle = 'rgba(40,44,120,.7)'; c.lineWidth = s * .02; c.beginPath(); c.moveTo(s * .5, s * .06); c.lineTo(s * .58, s * .9); c.stroke(); },
} satisfies Record<string, Draw>;

export type Glyph = keyof typeof SHAPES;
const textures = new Map<Glyph, THREE.CanvasTexture>();
export function glyph(name: Glyph) {
  let texture = textures.get(name);
  if (texture) return texture;
  const canvas = document.createElement('canvas'), s = 256; canvas.width = canvas.height = s;
  const c = canvas.getContext('2d')!; c.fillStyle = c.strokeStyle = '#fff';
  SHAPES[name](c, s);
  texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  textures.set(name, texture);
  return texture;
}
