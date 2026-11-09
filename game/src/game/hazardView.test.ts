import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { HazardView } from './hazardView';
import { Game } from './simulation';
import type { HeatRing } from './enemies';

function arena() {
  const game = new Game(), scene = new THREE.Scene();
  const view = new HazardView({ game, scene, decals: {}, flipbook: () => undefined });
  const ring: HeatRing = { id: 1, owner: 0, x: 2, z: -3, reach: 4, max: 15, speed: 5, width: 1.5, gapAt: .4, gapHalf: .6, damage: 10, camp: 'enemy', hit: new Set() };
  game.rings = [ring]; view.update(0);
  return { game, scene, view, ring, mesh: scene.children[0] as THREE.Mesh };
}

test('an unchanged heat ring reuses geometry and buffers without uploads or disposal', () => {
  const { view, mesh } = arena(), geometry = mesh.geometry, position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const buffer = position.array, version = position.version; let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  for (let frame = 0; frame < 60; frame++) view.update(0);
  assert.equal(mesh.geometry, geometry); assert.equal(geometry.getAttribute('position'), position);
  assert.equal(position.array, buffer); assert.equal(position.version, version); assert.equal(disposed, 0);
  view.clear(); assert.equal(disposed, 1);
});

test('a growing heat ring keeps its width, gap and culling bounds with the same geometry', () => {
  const { view, ring, mesh } = arena(), geometry = mesh.geometry;
  for (const [reach, width, gapHalf] of [[.2, 2, .3], [3, 1.5, .6], [12, 1.5, .6], [15, 2.5, .9]]) {
    Object.assign(ring, { reach, width, gapHalf }); view.update(reach);
    const expected = new THREE.RingGeometry(Math.max(.01, reach - width / 2), reach + width / 2, 72, 1, gapHalf, Math.PI * 2 - gapHalf * 2);
    assert.equal(mesh.geometry, geometry);
    assert.deepEqual(geometry.getAttribute('position').array, expected.getAttribute('position').array);
    assert.deepEqual(geometry.index!.array, expected.index!.array);
    assert.equal(geometry.boundingSphere!.radius, reach + width / 2);
    assert.deepEqual(mesh.position.toArray(), [ring.x, .1, ring.z]); assert.equal(mesh.rotation.z, -ring.gapAt);
    expected.dispose();
  }
  view.clear();
});

test('a hidden heat ring can grow into view and releases its resources exactly once', () => {
  const { game, scene, view, ring, mesh } = arena(), geometry = mesh.geometry;
  let geometries = 0, materials = 0;
  geometry.addEventListener('dispose', () => geometries++);
  (mesh.material as THREE.Material).addEventListener('dispose', () => materials++);
  ring.reach = 0; view.update(0); assert.equal(mesh.visible, false);
  ring.reach = 2; view.update(1); assert.equal(mesh.visible, true); assert.equal(mesh.geometry, geometry);
  game.rings = []; view.update(2); view.clear();
  assert.equal(scene.children.length, 0); assert.equal(geometries, 1); assert.equal(materials, 1);
});

test('clearing hazards also releases side mirrors and their child meshes', () => {
  const { game, scene, view } = arena();
  game.rings = []; game.sideMirrors = [{ id: 2, x: 1, z: 2 }]; view.update(0);
  let geometries = 0, materials = 0;
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.addEventListener('dispose', () => geometries++);
    (object.material as THREE.Material).addEventListener('dispose', () => materials++);
  });
  view.clear(); view.clear();
  assert.equal(scene.children.length, 0); assert.equal(geometries, 3); assert.equal(materials, 3);
  view.update(0); assert.equal(scene.children.length, 1); view.clear();
});
