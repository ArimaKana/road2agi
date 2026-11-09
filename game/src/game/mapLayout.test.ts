import { test } from 'vitest';
import assert from 'node:assert/strict';
import { layoutLevel, type Box } from './mapLayout';
import { CAMPAIGN } from './level';
import { worldToScreen } from './simulation';

const apart = (a: Box, b: Box) => a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ;

for (const level of CAMPAIGN) {
  const layout = layoutLevel(level);
  test(`${level.name}: every room gets a place and no two rooms overlap`, () => {
    assert.equal(layout.rooms.length, level.rooms.length);
    layout.rooms.forEach((a, i) => layout.rooms.forEach((b, j) => { if (i < j) assert.ok(apart(a.box, b.box), `${level.rooms[i].id} overlaps ${level.rooms[j].id}`); }));
  });
  test(`${level.name}: a corridor runs from each door out to the door into the next room, in straight legs`, () => {
    assert.equal(layout.corridors.length, level.rooms.length - 1);
    layout.corridors.forEach((path, i) => {
      const a = layout.rooms[i], b = layout.rooms[i + 1], exit = a.room.exit!.center, entrance = b.room.entrance!.center;
      assert.deepEqual(path[0], { x: a.x + exit.x, z: a.z + exit.z });
      assert.deepEqual(path[path.length - 1], { x: b.x + entrance.x, z: b.z + entrance.z });
      for (let k = 1; k < path.length; k++) assert.ok(path[k].x === path[k - 1].x || path[k].z === path[k - 1].z, 'legs follow the axes');
    });
  });
  test(`${level.name}: no corridor crosses a room it does not serve`, () => {
    layout.corridors.forEach((path, i) => {
      for (let k = 1; k < path.length; k++) {
        const leg: Box = { minX: Math.min(path[k].x, path[k - 1].x), maxX: Math.max(path[k].x, path[k - 1].x), minZ: Math.min(path[k].z, path[k - 1].z), maxZ: Math.max(path[k].z, path[k - 1].z) };
        layout.rooms.forEach((room, j) => { if (j !== i && j !== i + 1) assert.ok(apart(room.box, leg), `corridor ${i} crosses ${level.rooms[j].id}`); });
      }
    });
  });
  test(`${level.name}: the level climbs the screen, so the way forward is always up`, () => {
    const heights = layout.rooms.map(r => worldToScreen(r.x, r.z).y);
    for (let i = 1; i < heights.length; i++) assert.ok(heights[i] < heights[i - 1], `${level.rooms[i].id} is not above the room before it`);
  });
  test(`${level.name}: the bounds hold every room`, () => {
    for (const { box } of layout.rooms) assert.ok(box.minX >= layout.bounds.minX && box.maxX <= layout.bounds.maxX && box.minZ >= layout.bounds.minZ && box.maxZ <= layout.bounds.maxZ);
  });
}
