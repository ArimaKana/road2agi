<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { hud } from '../game/hud';
import { createOrientationController } from '../platform/orientation';

const orientation = createOrientationController();
const { state } = orientation;
const dialog = ref<HTMLElement>(), button = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
const start = () => { void orientation.start(); };
const focusGate = () => { if (state.blocked) (button.value?.disabled ? dialog.value : button.value)?.focus(); };
watch(() => state.portrait, portrait => { hud.portrait = portrait; }, { immediate: true, flush: 'sync' });
watch(() => state.blocked, blocked => {
  hud.playBlocked = blocked;
  if (blocked) { previousFocus = document.activeElement as HTMLElement | null; void nextTick(focusGate); }
  else void nextTick(() => { if (!state.blocked && previousFocus?.isConnected) previousFocus.focus(); });
}, { immediate: true, flush: 'sync' });
watch(() => state.initializing || state.pending, () => { void nextTick(focusGate); });
function keydown(event: KeyboardEvent) {
  if (!state.blocked) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.code === 'Tab') focusGate();
  else if (['Enter', 'Space'].includes(event.code) && !event.repeat) void orientation.requestLandscape();
}
function keyup(event: KeyboardEvent) {
  if (state.blocked) { event.preventDefault(); event.stopImmediatePropagation(); }
}
onMounted(() => {
  start();
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
  window.addEventListener('pagehide', orientation.stop);
  window.addEventListener('pageshow', start);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown, true);
  window.removeEventListener('keyup', keyup, true);
  window.removeEventListener('pagehide', orientation.stop);
  window.removeEventListener('pageshow', start);
  orientation.stop();
});
</script>

<template>
  <div v-if="state.blocked" id="rotate-hint" ref="dialog" role="dialog" aria-modal="true" aria-labelledby="rotate-title" aria-describedby="rotate-description" tabindex="-1">
    <div class="rotate-panel">
      <svg class="rotate-device" viewBox="0 0 80 80" aria-hidden="true"><rect x="17" y="28" width="50" height="32" rx="4" /><path d="M10 47V26a12 12 0 0 1 12-12h23M37 6l8 8-8 8M58 39v10" /></svg>
      <p class="rotate-eyebrow">ROAD TO AGI</p>
      <h1 id="rotate-title">请横屏游玩</h1>
      <p id="rotate-description">切换为横屏后即可开始或继续游戏。</p>
      <button ref="button" class="primary-button" :disabled="state.initializing || state.pending" @click="orientation.requestLandscape()">
        {{ state.pending ? '正在切换…' : state.initializing ? '准备中…' : '切换横屏' }}
      </button>
      <p class="rotate-status" role="status">{{ state.message || '请点击按钮，或将设备旋转为横屏。' }}</p>
    </div>
  </div>
</template>

<style scoped>
#rotate-hint{position:fixed;inset:0;z-index:100;display:flex;align-items:safe center;justify-content:center;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:radial-gradient(ellipse at 50% 35%,#16304a,#080f1d 75%);border:0;overflow-y:auto;pointer-events:auto;text-align:center;outline:none;touch-action:pan-y}
.rotate-panel{width:min(460px,100%);padding:32px 22px;border:1px solid var(--gold-dim);background:var(--corners),#0b1728;background-repeat:no-repeat;box-shadow:0 16px 64px #0006}
.rotate-device{width:90px;height:90px;fill:none;stroke:var(--gold-hi);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.rotate-eyebrow{margin:12px 0;color:var(--gold);font-size:11px;letter-spacing:4px}
#rotate-title{margin:0 0 14px;font-size:clamp(23px,5vw,30px);letter-spacing:2px;font-weight:500}
#rotate-description,.rotate-status{font-size:13px;line-height:1.8;color:var(--ink-2);overflow-wrap:anywhere}
#rotate-description{margin:0 0 24px}.rotate-status{min-height:3.6em;margin:18px 0 0}
#rotate-hint button{width:100%;min-height:48px}
#rotate-hint button:disabled{opacity:.65;cursor:wait}
@media(max-height:500px){.rotate-panel{padding:16px 24px}.rotate-device{width:50px;height:50px}.rotate-eyebrow{margin:4px 0 8px}#rotate-title{font-size:23px;margin-bottom:8px}#rotate-description{margin-bottom:12px}.rotate-status{margin-top:10px;min-height:0}}
</style>
