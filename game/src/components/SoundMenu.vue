<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { hud } from '../game/hud';
import { SOUND_OPTIONS, soundMode, type SoundMode } from '../game/saves';

const emit = defineEmits<{ select: [mode: SoundMode] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const mode = computed(() => soundMode(hud.settings));
const label = computed(() => SOUND_OPTIONS.find(option => option.mode === mode.value)!.label);

function close(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
async function show() {
  open.value = true;
  await nextTick();
  panel.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}
function select(next: SoundMode) {
  emit('select', next);
  close();
}
function keydown(event: KeyboardEvent) {
  if (!open.value) {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); void show(); }
    return;
  }
  // Menu keys must not also dash, move or pause the game beneath it.
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Tab') close(false);
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...panel.value!.querySelectorAll<HTMLButtonElement>('button')];
    const current = buttons.findIndex(button => button === document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }
}
watch(() => hud.playBlocked || hud.loading || !!hud.fatal, blocked => { if (blocked) close(false); });
</script>

<template>
  <div class="sound-control" @keydown="keydown">
    <div v-if="open" class="sound-dismiss" aria-hidden="true" @pointerdown.prevent="close()"></div>
    <button ref="trigger" class="icon-button sound-trigger" :aria-label="`声音设置：${label}`" :title="`声音 · ${label}`" aria-haspopup="menu" :aria-expanded="open" aria-controls="sound-menu" @click="open ? close() : show()">
      ♪<span v-if="mode !== 'all'" class="off-mark" :class="{ 'bgm-off': mode === 'effects' }" aria-hidden="true">{{ mode === 'muted' ? '×' : '−' }}</span>
    </button>
    <div v-if="open" id="sound-menu" ref="panel" class="sound-menu" role="menu" aria-label="声音设置">
      <button v-for="option in SOUND_OPTIONS" :key="option.mode" type="button" role="menuitemradio" :aria-checked="mode === option.mode" tabindex="-1" @click="select(option.mode)">
        <span>{{ option.label }}</span><span class="sound-check" aria-hidden="true">{{ mode === option.mode ? '✓' : '' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sound-control{position:relative;z-index:14}
.sound-dismiss{position:fixed;inset:0;cursor:default}
.sound-trigger{z-index:1}
.bgm-off{color:#93c7d6}
.sound-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:1;width:190px;max-width:calc(100vw - 36px);padding:5px;border:1px solid #8f794a;background:#0b1728;box-shadow:0 8px 26px #0008}
.sound-menu button{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:44px;padding:10px 12px;background:transparent;text-align:left;font-size:14px;white-space:nowrap}
.sound-menu button:hover,.sound-menu button:focus-visible{background:#c8a45a20}
.sound-menu button[aria-checked=true]{color:#f2dc9e}
.sound-check{width:16px;color:#f2dc9e}
</style>
