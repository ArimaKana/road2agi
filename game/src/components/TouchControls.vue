<script setup lang="ts">
import { hud } from '../game/hud';
import { keyName, padName, type Action } from '../game/saves';

const keyOf = (action: Action) => hud.device === 'pad' ? padName(hud.bindings.pad[action] ?? 0) : keyName(hud.bindings.keys[action]);
</script>

<template>
  <div id="touch-controls" :class="{ covered: hud.menuOpen || hud.screen === 'home' || hud.shop || hud.dialog }">
    <div id="move-stick" aria-label="移动摇杆">
      <div class="stick-ring"></div>
      <div class="stick-knob"></div>
      <span>移动</span>
    </div>
    <div class="combat-controls" :class="{ 'has-key-hints': hud.device !== 'touch' }">
      <button id="dash-button" aria-label="闪避" :title="`闪避 · ${keyOf('dash')}`">
        <span class="dash-glyph" aria-hidden="true">»</span><small>闪避</small>
        <i id="dash-cooldown" :style="{ transform: `translateY(${hud.dashCooldownOffset}%)` }"></i>
        <kbd v-if="hud.device !== 'touch'" class="combat-key" aria-hidden="true">{{ keyOf('dash') }}</kbd>
      </button>
      <button id="ult-button" :class="{ ready: hud.ultReady }" aria-label="法天象地" :title="`法天象地 · ${keyOf('ult')}`">
        <svg class="ult-glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <g transform="rotate(135 24 24)">
            <path d="M8 23V14c0-5 7-5 7-1v-3c0-5 7-5 7 0V8c0-5 7-5 7 0v3c0-5 8-5 8 0v9c4-1 6 2 4 6l-3 6-6 6v5H17v-5l-5-5c-3-3-4-6-4-10Z" />
            <path d="M15 13v8m7-11v10m7-9v8m8 1-8-2c-5-1-7 5-2 7l6 3m-21-4 6 4m-1 9h15" />
          </g>
          <path d="M2 9l3 3M9 2l3 3M2 2l4 4" />
        </svg>
        <kbd v-if="hud.device !== 'touch'" class="combat-key" aria-hidden="true">{{ keyOf('ult') }}</kbd>
      </button>
      <button id="attack-button" aria-label="攻击，长按蓄力" :title="`攻击 · ${hud.device === 'pad' ? keyOf('attack') : `鼠标左键 / ${keyOf('attack')}`}（长按蓄力）`">
        <svg class="sword-glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <g transform="rotate(42 24 24)">
            <path d="M24 2 25.5 28h-3Z" />
            <path d="M15 28h18c0 4-4 7-9 7s-9-3-9-7Z" />
            <path d="M22 35v7h4v-7" />
            <circle cx="24" cy="44" r="2" />
          </g>
        </svg><small>攻击</small>
        <kbd v-if="hud.device !== 'touch'" class="combat-key" aria-hidden="true">{{ keyOf('attack') }}</kbd>
      </button>
    </div>
  </div>
</template>
