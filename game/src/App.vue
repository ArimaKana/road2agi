<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { Engine } from './game/engine';
import { hud } from './game/hud';
import GameHud from './components/GameHud.vue';
import GameMenu from './components/GameMenu.vue';
import HomeScreen from './components/HomeScreen.vue';
import ResultPanel from './components/ResultPanel.vue';
import ShopPanel from './components/ShopPanel.vue';
import DialogPanel from './components/DialogPanel.vue';
import TouchControls from './components/TouchControls.vue';
import UltCutIn from './components/UltCutIn.vue';
import CardCutIn from './components/CardCutIn.vue';
import CardRow from './components/CardRow.vue';
import RoomJump from './components/RoomJump.vue';
import RewardPanel from './components/RewardPanel.vue';
import PrepPanel from './components/PrepPanel.vue';
import { loadToySdk } from './platform/toySdk';
import TrialLeaderboard from './components/TrialLeaderboard.vue';
import OrientationHint from './components/OrientationHint.vue';

const canvas = ref<HTMLCanvasElement>();
const engine = shallowRef<Engine>();
const reload = () => location.reload();

// Children are mounted first, so the on-screen controls the engine's input binds to already exist here.
onMounted(() => {
  // SDK loading is independent of local saves and game startup. Panels offer retries on failure.
  void loadToySdk().catch(() => {});
  engine.value = new Engine(canvas.value!);
  engine.value.init();
});
</script>

<template>
  <div id="game-content" :inert="hud.playBlocked">
  <canvas id="game" ref="canvas" tabindex="0" aria-label="DeepSeek 等距战斗房间"></canvas>
  <div class="vignette"></div>
  <UltCutIn />
  <CardCutIn />
  <GameHud @pause="engine?.togglePause()" @sound="engine?.setSoundMode($event)" @interact="engine?.interactNow()" />
  <div id="wave-banner" :class="{ visible: hud.bannerVisible }" aria-live="polite">{{ hud.banner }}</div>
  <div id="room-notice" :class="{ visible: hud.noticeVisible }" aria-live="polite">{{ hud.notice }}</div>
  <div id="room-fade" :class="{ visible: hud.roomFade }"></div>
  <div id="damage-numbers" aria-hidden="true">
    <span v-for="n in hud.numbers" :key="n.id" class="damage-number" :class="`t${n.tier}`" :style="{ left: `${n.left}px`, top: `${n.top}px` }">{{ n.text }}</span>
  </div>
  <div id="combo" :class="{ visible: hud.comboVisible, charged: hud.comboCharged }" aria-hidden="true">{{ hud.combo }}</div>
  <TouchControls />
  <CardRow />
  <RewardPanel @pick="engine?.pickReward($event)" />
  <PrepPanel @go="engine?.confirmPrep()" />
  <ShopPanel @buy="engine?.buyItem($event)" @close="engine?.closeShop()" />
  <DialogPanel @choose="engine?.chooseStory($event)" @next="engine?.dialogNext()" />
  <GameMenu @start="engine?.start()" @home="engine?.goHome()" @train="engine?.trainVitality()" @memory="engine?.readMemory()" @setting="engine?.setting($event)" />
  <ResultPanel @retry="engine?.retry()" @home="engine?.goHome()" />
  <HomeScreen @new-run="engine?.newRun()" @resume="engine?.resumeLatest()" @load="engine?.loadSlot($event)" @remove="engine?.removeSlot($event)" @trial="engine?.pickTrial()" @setting="engine?.setting($event)" />
  <RoomJump @jump="engine?.jumpTo($event)" @close="engine?.toggleJump()" />
  <TrialLeaderboard v-if="hud.rankingOpen" @close="hud.rankingOpen = false" />
  <div v-if="hud.loading" id="loading" role="status">
    <div class="load-box">
      <b>{{ hud.loadError ? '载入失败' : `载入${hud.loadLabel}` }}</b>
      <div class="load-track"><i :style="{ width: `${hud.loadTotal ? hud.loadDone / hud.loadTotal * 100 : 0}%` }"></i></div>
      <small v-if="hud.loadLeft && !hud.loadError" class="load-left">{{ hud.loadLeft }}</small>
      <button v-if="hud.loadError" class="primary-button" @click="engine?.retryLoad?.()">重试</button>
    </div>
  </div>
  <div v-if="hud.fatal" id="fatal" role="alert">{{ hud.fatal }}<button class="primary-button" @click="reload">重新载入</button></div>
  </div>
  <OrientationHint />
</template>

<style scoped>
#game-content{position:absolute;inset:0}
</style>
