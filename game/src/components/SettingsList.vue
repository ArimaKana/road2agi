<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../game/hud';
import { ACTION_NAMES, SOUND_OPTIONS, soundMode, keyName, padName, type Action, type SettingCommand } from '../game/saves';

defineEmits<{ setting: [command: SettingCommand] }>();
const actions = Object.keys(ACTION_NAMES) as Action[];
const percent = (share: number) => `${Math.round(share * 100)}%`;
const soundIndex = computed(() => SOUND_OPTIONS.findIndex(option => option.mode === soundMode(hud.settings)));
</script>

<template>
  <ul class="setting-list">
    <li><span>声音</span><button class="row-button" aria-label="切换声音模式" @click="$emit('setting', { kind: 'sound', mode: SOUND_OPTIONS[(soundIndex + 1) % SOUND_OPTIONS.length].mode })">{{ SOUND_OPTIONS[soundIndex].label }}</button></li>
    <li><span>屏幕震动</span><button class="row-button" :aria-pressed="hud.settings.shake" @click="$emit('setting', { kind: 'toggle', key: 'shake' })">{{ hud.settings.shake ? '开' : '关' }}</button></li>
    <li><span>闪光</span><button class="row-button" :aria-pressed="hud.settings.flash" @click="$emit('setting', { kind: 'toggle', key: 'flash' })">{{ hud.settings.flash ? '开' : '关' }}</button></li>
    <li><span>伤害数字</span><button class="row-button" :aria-pressed="hud.settings.numbers" @click="$emit('setting', { kind: 'toggle', key: 'numbers' })">{{ hud.settings.numbers ? '开' : '关' }}</button></li>
    <li><span>虚拟按键</span><button class="row-button" :aria-pressed="hud.settings.touchOn" @click="$emit('setting', { kind: 'toggle', key: 'touchOn' })">{{ hud.settings.touchOn ? '常开' : '自动' }}</button></li>
    <template v-if="hud.settings.touchOn || hud.device === 'touch'">
      <li><span>按键大小</span><button class="row-button" @click="$emit('setting', { kind: 'cycle', key: 'touchSize' })">{{ percent(hud.settings.touchSize) }}</button></li>
      <li><span>按键透明度</span><button class="row-button" @click="$emit('setting', { kind: 'cycle', key: 'touchAlpha' })">{{ percent(hud.settings.touchAlpha) }}</button></li>
      <li><span>摇杆位置</span><button class="row-button" @click="$emit('setting', { kind: 'cycle', key: 'stickShift' })">靠边 +{{ hud.settings.stickShift }}</button></li>
    </template>
  </ul>
  <h3 class="bind-title">按键</h3>
  <ul class="bind-list">
    <li v-for="action in actions" :key="action">
      <span>{{ ACTION_NAMES[action] }}</span>
      <button class="row-button" @click="$emit('setting', { kind: 'rebind', device: 'keys', action })">{{ hud.rebinding === `keys:${action}` ? '按下新键' : keyName(hud.bindings.keys[action]) }}</button>
      <button v-if="hud.bindings.pad[action] !== undefined" class="row-button" @click="$emit('setting', { kind: 'rebind', device: 'pad', action })">{{ hud.rebinding === `pad:${action}` ? '按下手柄键' : padName(hud.bindings.pad[action]!) }}</button>
      <i v-else></i>
    </li>
  </ul>
  <button class="row-button bind-reset" @click="$emit('setting', { kind: 'reset' })">恢复默认按键</button>
</template>
