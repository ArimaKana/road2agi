import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Flipbooks } from './flipbooks';
import { Game } from './simulation';
import { SUPPLIES } from './rewards';

afterEach(() => vi.restoreAllMocks());

test('taking a reward places its effect at the hero with a finite world matrix', async () => {
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture());
  const scene = new THREE.Scene(), flips = new Flipbooks(scene), game = new Game();
  await flips.load(job => job);
  game.hero.x = 5; game.hero.z = -6; game.events = [];
  game.reward = { options: [SUPPLIES[0]] }; game.chooseReward(0);
  const event = game.events.find(e => e.type === 'rewardTaken');
  assert.ok(event); assert.equal(event.x, 5); assert.equal(event.z, -6);
  flips.event(event, 'port'); scene.updateMatrixWorld(true);
  assert.equal(scene.children.length, 1);
  const effect = scene.children[0];
  assert.ok(effect.matrixWorld.elements.every(Number.isFinite));
  assert.ok(Math.abs(effect.position.x - 5) < 1 && Math.abs(effect.position.z + 6) < 1);
  flips.clear(); assert.equal(scene.children.length, 0);
});
