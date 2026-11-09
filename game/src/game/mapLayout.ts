// Where each room of a level sits on the pause map. Rooms join door to door, the door out of one running along a corridor to the door into the next.
// Doors out are on the far walls and doors in on the near ones, so the rooms climb the screen as the level goes on.
import { TILE, parseRoom, type Point, type Room } from './room.ts';
import type { Level } from './level.ts';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface PlacedRoom extends Point { room: Room; box: Box }
export interface MapLayout { rooms: PlacedRoom[]; corridors: Point[][]; bounds: Box }

const GAP = 4, TURN = 8, MARGIN = 3; // How far a door leaves the wall before a corridor may join or turn, how long the leg after a turn runs, and how close anything may come to a room.

const boxOf = (room: Room, x: number, z: number): Box => ({ minX: x - room.cols * TILE / 2, maxX: x + room.cols * TILE / 2, minZ: z - room.rows * TILE / 2, maxZ: z + room.rows * TILE / 2 });
const overlap = (a: Box, b: Box, margin: number) => a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;
const legBox = (a: Point, b: Point): Box => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });

export function layoutLevel(level: Level): MapLayout {
  const rooms: PlacedRoom[] = [], corridors: Point[][] = [];
  level.rooms.forEach((plan, index) => {
    const room = parseRoom(plan.map);
    if (!index) { rooms.push({ x: 0, z: 0, room, box: boxOf(room, 0, 0) }); return; }
    const last = rooms[index - 1], exit = last.room.exit!, entrance = room.entrance!;
    const from = { x: last.x + exit.center.x, z: last.z + exit.center.z }, out = { x: -exit.inward.x, z: -exit.inward.z }, along = entrance.inward;
    const straight = out.x === along.x && out.z === along.z;
    // Lengthen the corridor until the new room and its corridor clear everything already placed.
    for (let reach = GAP; ; reach += TILE) {
      const corner = { x: from.x + out.x * reach, z: from.z + out.z * reach };
      const to = straight ? corner : { x: corner.x + along.x * TURN, z: corner.z + along.z * TURN };
      const x = to.x - entrance.center.x, z = to.z - entrance.center.z, box = boxOf(room, x, z), path = straight ? [from, to] : [from, corner, to];
      const legsClear = path.slice(1).every((point, i) => rooms.every((r, j) => j === index - 1 && i === 0 ? true : !overlap(r.box, legBox(path[i], point), MARGIN / 2)));
      if (rooms.every(r => !overlap(r.box, box, MARGIN)) && legsClear) { rooms.push({ x, z, room, box }); corridors.push(path); break; }
    }
  });
  const bounds = rooms.reduce((b, { box }) => ({ minX: Math.min(b.minX, box.minX), maxX: Math.max(b.maxX, box.maxX), minZ: Math.min(b.minZ, box.minZ), maxZ: Math.max(b.maxZ, box.maxZ) }), rooms[0].box);
  return { rooms, corridors, bounds };
}
