import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// Only HDR highlights spill into the glow. The scenery, floor warnings and DOM
// HUD stay crisp; a reduced bloom resolution keeps the extra passes inexpensive.
export class CombatGlow {
  private scenePass;
  private bloomPass;
  private pipeline: THREE.RenderPipeline;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.scenePass = pass(scene, camera);
    const color = this.scenePass.getTextureNode('output');
    this.bloomPass = bloom(color, .48, .55, 1.15).setResolutionScale(.35);
    this.bloomPass.smoothWidth.value = .3;
    this.pipeline = new THREE.RenderPipeline(renderer, color.add(this.bloomPass));
  }

  render() { this.pipeline.render(); }
  dispose() { this.pipeline.dispose(); this.bloomPass.dispose(); this.scenePass.dispose(); }
}
