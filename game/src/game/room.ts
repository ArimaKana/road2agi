// The map: one room on a tile grid, read from a plain text plan. Plain data and rules, so the fight and the renderer read the same walls.
export const TILE = 1.5;
// What a tile holds. Anything but floor stops bodies, blades and looks.
export const FLOOR = 0, WALL = 1, CRATE = 2, MACHINE = 3, DOOR = 4;
const START_STEPS = 2.5; // How many tiles inside the door the hero stands on arriving.

export interface Point { x: number; z: number }
export interface Area extends Point { halfX: number; halfZ: number }
// A run of tiles in the outer wall, solid until it is opened. `inward` points from it into the room.
export interface Door { tiles: number[]; center: Point; inward: Point; span: number; alongX: boolean }
export interface Room { cols: number; rows: number; walls: Uint8Array; start: Point; entrance: Door | null; exit: Door | null; marks: Record<string, Area> }

const originOf = (m: Room) => ({ x: -m.cols * TILE / 2, z: -m.rows * TILE / 2 });
export const tileOf = (m: Room, x: number, z: number) => { const o = originOf(m); return { c: Math.floor((x - o.x) / TILE), r: Math.floor((z - o.z) / TILE) }; };
export const tileCenter = (m: Room, c: number, r: number): Point => { const o = originOf(m); return { x: o.x + (c + .5) * TILE, z: o.z + (r + .5) * TILE }; };
export const wallAtTile = (m: Room, c: number, r: number) => c < 0 || r < 0 || c >= m.cols || r >= m.rows || m.walls[r * m.cols + c] !== FLOOR;
export const isWall = (m: Room, x: number, z: number) => { const t = tileOf(m, x, z); return wallAtTile(m, t.c, t.r); };
export const inArea = (a: Area, x: number, z: number, margin = 0) => Math.abs(x - a.x) < a.halfX + margin && Math.abs(z - a.z) < a.halfZ + margin;
export const inDoor = (m: Room, door: Door, p: Point) => { const t = tileOf(m, p.x, p.z); return door.tiles.includes(t.r * m.cols + t.c); };
export const openDoor = (m: Room, door: Door) => { for (const i of door.tiles) m.walls[i] = FLOOR; };

function makeDoor(m: Room, tiles: number[]): Door | null {
  if (!tiles.length) return null;
  const spots = tiles.map(i => tileCenter(m, i % m.cols, Math.floor(i / m.cols))), x = spots.reduce((a, p) => a + p.x, 0) / spots.length, z = spots.reduce((a, p) => a + p.z, 0) / spots.length;
  const alongX = spots.every(p => p.z === spots[0].z);
  return { tiles, center: { x, z }, inward: alongX ? { x: 0, z: z < 0 ? 1 : -1 } : { x: x < 0 ? 1 : -1, z: 0 }, span: tiles.length, alongX };
}
export function parseRoom(map: string[]): Room {
  const rows = map.length, cols = map[0].length, walls = new Uint8Array(rows * cols);
  const m: Room = { cols, rows, walls, start: { x: 0, z: 0 }, entrance: null, exit: null, marks: {} };
  const doors: Record<string, number[]> = { '<': [], '>': [] }, spans: Record<string, number[]> = {};
  map.forEach((line, r) => [...line].forEach((mark, c) => {
    const i = r * cols + c;
    if (mark === '#') walls[i] = WALL;
    else if (mark === 'o') walls[i] = CRATE;
    else if (doors[mark]) { walls[i] = DOOR; doors[mark].push(i); }
    else if (mark !== '.') { const s = spans[mark] ??= [c, r, c, r]; s[0] = Math.min(s[0], c); s[1] = Math.min(s[1], r); s[2] = Math.max(s[2], c); s[3] = Math.max(s[3], r); }
  }));
  for (const [mark, [c0, r0, c1, r1]] of Object.entries(spans)) {
    const a = tileCenter(m, c0, r0), b = tileCenter(m, c1, r1);
    m.marks[mark] = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, halfX: (b.x - a.x + TILE) / 2, halfZ: (b.z - a.z + TILE) / 2 };
  }
  m.entrance = makeDoor(m, doors['<']); m.exit = makeDoor(m, doors['>']);
  if (m.entrance) m.start = { x: m.entrance.center.x + m.entrance.inward.x * START_STEPS * TILE, z: m.entrance.center.z + m.entrance.inward.z * START_STEPS * TILE };
  return m;
}

// A single empty room, for tests and anything else that wants the walls out of the way.
export function openMap(half = 60) {
  const size = Math.ceil(half * 2 / TILE) + 2, solid = '#'.repeat(size), floor = `#${'.'.repeat(size - 2)}#`;
  return Array.from({ length: size }, (_, r) => r === 0 || r === size - 1 ? solid : floor);
}
export const openRoom = (half = 60) => parseRoom(openMap(half));

// The floor a blast from this tile runs over, straight on until something solid stops it.
export function lineFrom(m: Room, from: Point, dir: Point, halfWidth: number): Area {
  const t = tileOf(m, from.x, from.z);
  let tiles = 0;
  while (!wallAtTile(m, t.c + dir.x * (tiles + 1), t.r + dir.z * (tiles + 1))) tiles++;
  const length = tiles * TILE, reach = TILE / 2 + length / 2;
  return { x: from.x + dir.x * reach, z: from.z + dir.z * reach, halfX: dir.x ? length / 2 : halfWidth, halfZ: dir.z ? length / 2 : halfWidth };
}

// How many tiles long a rail is, and the part of it a slab of size tiles covers, offset tiles in from the end dir points away from.
export const railTiles = (rail: Area, dir: Point) => Math.round((dir.x ? rail.halfX : rail.halfZ) * 2 / TILE);
export function slotOn(rail: Area, dir: Point, size: number, offset: number): Area {
  const half = size * TILE / 2, along = offset * TILE + half;
  return dir.x ? { x: rail.x + dir.x * (along - rail.halfX), z: rail.z, halfX: half, halfZ: rail.halfZ } : { x: rail.x, z: rail.z + dir.z * (along - rail.halfZ), halfX: rail.halfX, halfZ: half };
}
export function setTiles(m: Room, a: Area, kind: number) {
  const from = tileOf(m, a.x - a.halfX + .01, a.z - a.halfZ + .01), to = tileOf(m, a.x + a.halfX - .01, a.z + a.halfZ - .01);
  for (let r = from.r; r <= to.r; r++) for (let c = from.c; c <= to.c; c++) m.walls[r * m.cols + c] = kind;
}

export const blocked = (m: Room, x: number, z: number, r: number) => {
  const a = tileOf(m, x - r, z - r), b = tileOf(m, x + r, z + r);
  for (let tr = a.r; tr <= b.r; tr++) for (let tc = a.c; tc <= b.c; tc++) if (wallAtTile(m, tc, tr)) return true;
  return false;
};
// The closest tile centre a body of radius r fits on. For a body something solid has just moved onto.
export function nearestOpen(m: Room, x: number, z: number, r: number): Point {
  const t = tileOf(m, x, z);
  for (let reach = 1; reach < Math.max(m.cols, m.rows); reach++) {
    let best: Point | null = null, score = Infinity;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) !== reach) continue;
      const at = tileCenter(m, t.c + dc, t.r + dr), d = Math.hypot(at.x - x, at.z - z);
      if (d < score && !blocked(m, at.x, at.z, r)) { best = at; score = d; }
    }
    if (best) return best;
  }
  return { x, z };
}
// Moves a body of radius r, one axis at a time so it slides along a wall instead of sticking to it. Long moves go in steps so they cannot pass through one.
export function slide(m: Room, x: number, z: number, dx: number, dz: number, r: number): Point {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (TILE * .5))), sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    // A body already overlapping a wall could otherwise never move again, so it may walk out as long as its centre stays on the floor.
    const free = (nx: number, nz: number) => blocked(m, x, z, r) ? !isWall(m, nx, nz) : !blocked(m, nx, nz, r);
    if (free(x + sx, z)) x += sx;
    if (free(x, z + sz)) z += sz;
  }
  return { x, z };
}
// Whether a body of radius r could walk straight between two points: its centre line and both of its edges have to be clear.
export function pathClear(m: Room, a: Point, b: Point, r: number) {
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, sx = -(b.z - a.z) / d * r, sz = (b.x - a.x) / d * r;
  return lineClear(m, a, b) && lineClear(m, { x: a.x + sx, z: a.z + sz }, { x: b.x + sx, z: b.z + sz }) && lineClear(m, { x: a.x - sx, z: a.z - sz }, { x: b.x - sx, z: b.z - sz });
}
// Whether a blade or a look can pass between two points.
export function lineClear(m: Room, a: Point, b: Point) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(d / (TILE * .25));
  for (let i = 1; i < steps; i++) { const t = i / steps; if (isWall(m, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
  return true;
}
// A body too wide to stand on a tile beside a wall has to keep to tiles with this much room around them.
export const clearanceFor = (radius: number) => radius > TILE / 2 - .05 ? 1 : 0;
const hasRoom = (m: Room, c: number, r: number, clearance: number) => {
  for (let y = -clearance; y <= clearance; y++) for (let x = -clearance; x <= clearance; x++) if (wallAtTile(m, c + x, r + y)) return false;
  return true;
};
// Steps from every tile with enough room to the given point, walking between tiles that share an edge. Everything else stays at -1.
// The point itself may be tucked into a corner with no room around it, so the last few steps toward it are let off, or nothing wide could ever route there.
export function distanceField(m: Room, from: Point, clearance = 0) {
  const field = new Int32Array(m.cols * m.rows).fill(-1), t = tileOf(m, from.x, from.z), slack = clearance * 3;
  if (wallAtTile(m, t.c, t.r)) return field;
  const queue = [t.r * m.cols + t.c]; field[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head], c = at % m.cols, r = Math.floor(at / m.cols);
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (wallAtTile(m, nc, nr) || (field[at] >= slack && !hasRoom(m, nc, nr, clearance))) continue;
      const i = nr * m.cols + nc;
      if (field[i] < 0) { field[i] = field[at] + 1; queue.push(i); }
    }
  }
  return field;
}
// The way to walk from a point toward where the field was made: at the centre of the neighbouring tile that is closest. Diagonals only when both sides are clear, so nothing cuts a corner.
export function stepToward(m: Room, field: Int32Array, x: number, z: number): Point | null {
  const t = tileOf(m, x, z), here = wallAtTile(m, t.c, t.r) ? -1 : field[t.r * m.cols + t.c];
  // A body pushed onto a tile off the route still looks around it for the way back on.
  let best: Point | null = null, score = here < 0 ? Infinity : here;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const nc = t.c + dc, nr = t.r + dr;
    if ((!dc && !dr) || wallAtTile(m, nc, nr)) continue;
    if (dc && dr && (wallAtTile(m, nc, t.r) || wallAtTile(m, t.c, nr))) continue;
    const d = field[nr * m.cols + nc];
    if (d >= 0 && d < score) { score = d; best = tileCenter(m, nc, nr); }
  }
  return best;
}
