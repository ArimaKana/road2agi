<script setup lang="ts">
import { hud } from '../game/hud';
import { CARDS, CARD_IDS } from '../game/cards';
import SoundMenu from './SoundMenu.vue';
import type { SoundMode } from '../game/saves';

// Where each partner lights up round the edge of the screen, in the order they answer, and the way their light runs to her in the middle.
const RALLY_SPOTS: [number, number][] = [[14, 16], [50, 12], [86, 16], [92, 50], [86, 82], [62, 88], [38, 88], [14, 82], [8, 50]];
const rally = CARD_IDS.map((id, i) => {
  const [x, y] = RALLY_SPOTS[i];
  return { id, style: { left: `${x}%`, top: `${y}%`, animationDelay: `${i * .16}s`, '--c': `#${CARDS[id].color.toString(16).padStart(6, '0')}`, '--dx': `${50 - x}vw`, '--dy': `${50 - y}vh`, '--turn': `${Math.atan2((50 - y) * 9, (50 - x) * 16)}rad` } };
});

defineEmits<{ pause: []; sound: [mode: SoundMode]; interact: [] }>();
</script>

<template>
  <header class="hud">
    <div class="hud-left">
      <div class="portrait-frame"><img class="portrait" :src="`./assets/deepseek-face-${hud.face}-v001.webp`" alt="" draggable="false"></div>
      <div class="vitals">
        <div class="vital hp">
          <img class="res-icon" :src="'./assets/ui/res-life.webp'" alt="生命" draggable="false">
          <div class="health"><div id="health-fill" :style="{ width: `${hud.hp / hud.hpMax * 100}%` }"></div></div>
          <span class="vital-value"><b>{{ hud.hp }}</b><small>/{{ hud.hpMax }}</small></span>
        </div>
        <div class="vital">
          <img class="res-icon" :src="`./assets/ui/${hud.tokenFreeUses > 0 ? 'status-zerocost' : 'res-token'}.webp`" alt="Token" draggable="false">
          <div id="token" class="token" :class="{ free: hud.tokenFreeUses > 0 }"><div id="token-fill" :style="{ width: `${hud.tokenFreeUses > 0 ? 100 : hud.token / hud.tokenMax * 100}%` }"></div></div>
          <span class="vital-value" :class="{ free: hud.tokenFreeUses > 0 }"><template v-if="hud.tokenFreeUses > 0"><b>零消耗</b><small> 剩 {{ hud.tokenFreeUses }} 次</small></template><template v-else><b>{{ Math.floor(hud.token) }}</b><small>/{{ hud.tokenMax }}</small></template></span>
        </div>
        <div class="vital">
          <i class="vital-mark" :class="{ ready: hud.ultReady }" aria-label="觉醒">觉</i>
          <div id="awaken" class="awaken" :class="{ ready: hud.ultReady }"><div id="awaken-fill" :style="{ width: `${hud.awaken}%` }"></div></div>
          <span id="ult-hint" class="vital-value" :class="{ ready: hud.ultReady }"><b>{{ hud.ultHint }}</b></span>
        </div>
      </div>
    </div>
    <div v-if="!hud.menuOpen" class="status-row">
      <span v-if="hud.god" class="god-tag" title="F8 关闭">无敌</span>
      <span class="dash-pips" :aria-label="`滑步充能 ${hud.dashCharges}`" title="滑步充能"><b>»</b>{{ '●'.repeat(hud.dashCharges) + '○'.repeat(2 - hud.dashCharges) }}</span>
      <span class="coin-count"><img :src="'./assets/ui/res-coin.webp'" alt="算力币" title="算力币" draggable="false">{{ hud.coins }}</span>
      <img v-for="status in hud.statuses" :key="status" :src="`./assets/ui/${status}.webp`" alt="" draggable="false">
      <span v-for="mark in hud.marks" :key="mark.icon" class="status-mark"><img :src="`./assets/ui/${mark.icon}.webp`" alt="" draggable="false"><b>{{ mark.text }}</b></span>
      <img v-for="combo in hud.combos" :key="combo.icon" class="combo-icon" :src="`./assets/ui/${combo.icon}.webp`" :title="combo.text" :alt="combo.text" draggable="false">
    </div>
    <div v-if="!hud.menuOpen" class="stage">
      <strong>{{ hud.wave }}</strong>
      <div id="objective">{{ hud.objective }}</div>
      <div v-if="hud.boss" class="boss-bar" :class="{ exposed: hud.boss.exposed }">
        <b>{{ hud.boss.name }}</b>
        <div class="boss-track"><div class="boss-fill" :style="{ width: `${hud.boss.share * 100}%` }"></div></div>
        <div class="boss-stagger" :class="{ reeling: hud.boss.reeling }" title="失衡"><i :style="{ width: `${hud.boss.stagger * 100}%` }"></i></div>
        <img v-if="hud.boss.shielded" class="boss-shield" :src="'./assets/ui/status-shield.webp'" alt="护盾" draggable="false">
        <span v-if="hud.boss.chains" class="boss-chains"><img :src="'./assets/ui/chain-progress.webp'" alt="锁链" draggable="false">{{ hud.boss.chains }}</span>
      </div>
    </div>
    <div class="top-actions">
      <SoundMenu @select="$emit('sound', $event)" />
      <button class="icon-button" aria-label="暂停游戏" title="暂停 · Esc" @click="$emit('pause')"><svg class="pause-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="5" y="4" width="5" height="16" rx=".5" /><rect x="14" y="4" width="5" height="16" rx=".5" /></svg></button>
    </div>
  </header>
  <span v-if="hud.targetHint && !hud.menuOpen" class="target-hint" :class="{ 'in-range': hud.targetHint.inRange }" :style="{ left: `${hud.targetHint.left}px`, top: `${hud.targetHint.top}px` }">{{ hud.targetHint.inRange ? '范围内' : '靠近目标' }}</span>
  <button v-if="hud.prompt && !hud.menuOpen" class="context-prompt" @click="$emit('interact')">{{ hud.prompt }}</button>
  <img v-if="hud.counter && !hud.menuOpen" class="counter-icon" :src="`./assets/ui/${hud.counter}.webp`" alt="反制提示" draggable="false">
  <img v-if="hud.cardFlight" class="card-flight" :src="`./assets/cards/${hud.cardFlight}.webp`" alt="" draggable="false" @animationend="hud.cardFlight = ''">
  <div v-if="hud.rally" class="rally" aria-hidden="true"><div v-for="card in rally" :key="card.id" class="rally-card" :style="card.style"><i></i><img :src="`./assets/cards/${card.id}.webp`" alt="" draggable="false"></div></div>
</template>
