<script setup lang="ts">
import { computed, ref } from 'vue';
import { hud } from '../game/hud';
import { SAVE_SLOTS, type SettingCommand } from '../game/saves';
import SettingsList from './SettingsList.vue';

const emit = defineEmits<{ newRun: []; resume: []; load: [slot: number]; remove: [slot: number]; trial: []; setting: [command: SettingCommand] }>();

type Panel = 'none' | 'saves' | 'trials' | 'settings';
const panel = ref<Panel>('none');
const full = ref(false);
const removing = ref(-1);
const latest = computed(() => hud.saves.reduce<(typeof hud.saves)[number]>((best, s) => s && (!best || s.savedAt > best.savedAt) ? s : best, null));
const when = (time: number) => new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function open(next: Panel) { panel.value = panel.value === next ? 'none' : next; full.value = false; removing.value = -1; }
// With every slot taken a new run has nowhere to go, so the player is shown the slots to free one.
function begin() {
  if (hud.saves.every(Boolean)) { panel.value = 'saves'; full.value = true; return; }
  emit('newRun');
}
function remove(slot: number) {
  if (removing.value !== slot) { removing.value = slot; return; }
  removing.value = -1; full.value = false; emit('remove', slot);
}
</script>

<template>
  <div v-if="hud.screen === 'home'" id="home">
    <div class="home-column">
      <h1 class="home-title" lang="en" aria-label="ROAD to AGI"><span>ROAD</span><em>to</em><span>AGI</span></h1>
      <nav class="home-nav" aria-label="主菜单">
        <button class="home-button" :disabled="!hud.ready" @click="begin">{{ hud.ready ? '从头开始' : '载入中…' }}</button>
        <button class="home-button" :disabled="!hud.ready || !latest" @click="$emit('resume')">继续游戏<small v-if="latest">{{ latest.roomId }} {{ latest.roomName }}</small></button>
        <button class="home-button" :class="{ active: panel === 'saves' }" :disabled="!hud.ready" @click="open('saves')">存档管理</button>
        <button class="home-button" :class="{ active: panel === 'trials' }" :disabled="!hud.ready" @click="open('trials')">试炼模式</button>
        <button class="home-button" :class="{ active: panel === 'settings' }" :disabled="!hud.ready" @click="open('settings')">设置</button>
      </nav>
      <p v-if="hud.soundLocked" class="home-note">轻触屏幕开启声音</p>
    </div>
    <section v-if="panel === 'saves'" class="home-panel" aria-label="存档管理">
      <h2>存档管理</h2>
      <p v-if="full" class="home-note">存档已满，先删除一个再开始新的一局。</p>
      <ul class="save-list">
        <li v-for="n in SAVE_SLOTS" :key="n" class="save-row">
          <template v-if="hud.saves[n - 1]">
            <div class="save-info"><b>存档 {{ n }} · {{ hud.saves[n - 1]!.levelName }}</b><span>{{ hud.saves[n - 1]!.roomId }} {{ hud.saves[n - 1]!.roomName }}</span><small>{{ when(hud.saves[n - 1]!.savedAt) }}</small></div>
            <button class="row-button" @click="$emit('load', n - 1)">读取</button>
            <button class="row-button danger" @click="remove(n - 1)">{{ removing === n - 1 ? '确认删除' : '删除' }}</button>
          </template>
          <div v-else class="save-info empty"><b>存档 {{ n }}</b><span>空</span></div>
        </li>
      </ul>
    </section>
    <section v-if="panel === 'trials'" class="home-panel" aria-label="试炼模式">
      <h2>试炼模式</h2>
      <p class="home-note">房间没有尽头，越往后敌人越强，倒下为止。</p>
      <div class="save-row">
        <div class="save-info"><b>最远纪录</b><span>{{ hud.trialBest ? `第 ${hud.trialBest} 间` : '还没有记录' }}</span></div>
        <button class="row-button" @click="hud.rankingOpen = true">排行榜</button>
        <button class="row-button" @click="$emit('trial')">开始</button>
      </div>
    </section>
    <section v-if="panel === 'settings'" class="home-panel settings-panel" aria-label="设置">
      <h2>设置</h2>
      <SettingsList @setting="$emit('setting', $event)" />
    </section>
  </div>
</template>

<style scoped>
@font-face{font-family:"R2A Title Capitals";src:url("/assets/fonts/r2a-title-capitals.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"R2A Title Script";src:url("/assets/fonts/r2a-title-script.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}
#home .home-title{display:flex;align-items:baseline;gap:.18em;width:max-content;font-family:"R2A Title Capitals",Georgia,"Times New Roman",serif;font-size:clamp(38px,5.9vw,76px);font-weight:400;letter-spacing:.02em;line-height:1.2;color:var(--gold-hi);text-shadow:0 2px 8px #0009}
#home .home-title em{font-family:"R2A Title Script","Apple Chancery","URW Chancery L",cursive;font-size:.68em;font-style:normal;font-weight:400;letter-spacing:0;line-height:1;color:#fff;text-shadow:0 2px 6px #0009}
@media(max-width:800px),(max-height:550px),(pointer:coarse){
  #home{--home-logo-size:clamp(39px,7.5vw,72px);display:grid;grid-template-columns:min(260px,38vw) minmax(0,1fr);grid-template-rows:auto auto;align-content:center;align-items:stretch;gap:12px 18px;padding:12px 20px}
  #home .home-column{display:contents}
  #home .home-nav{grid-column:1;grid-row:1 / 3}
  #home .home-title{grid-column:2;grid-row:2;align-self:end;justify-self:end;margin:0 48px 0 0;font-size:var(--home-logo-size);line-height:1}
  #home>.home-panel{grid-column:2;grid-row:1;align-self:center;max-height:calc(100dvh - var(--home-logo-size) - 48px)}
  #home .home-column>.home-note{grid-column:1;grid-row:3;margin:0}
}
</style>
