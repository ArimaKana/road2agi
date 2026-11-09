<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../game/hud';
import { MEMORY_COST, VITALITY_MAX, VITALITY_STEP, vitalityCost } from '../game/saves';
import { MEMORIES } from '../game/story';
import { CARDS, CARD_IDS, ROMAN, SLOTS, UNLOCK_HINT, UPGRADES, canStartWith, rankText, type CardId } from '../game/cards';
import type { SettingCommand } from '../game/saves';
import SettingsList from './SettingsList.vue';

defineEmits<{ start: []; home: []; train: []; memory: []; setting: [command: SettingCommand] }>();

const startable = (id: CardId) => canStartWith(id, hud.unlocked);
// A run always sets out with as many as it may: picking one more lets the oldest go.
function pick(id: CardId) {
  if (!startable(id) || hud.loadout.includes(id)) return;
  if (hud.loadout.length === hud.startSlots) hud.loadout.shift();
  hud.loadout.push(id);
}
const lockedHint = (id: CardId) => UNLOCK_HINT[id];

const paused = computed(() => hud.menuMode === 'paused');
const label = computed(() => paused.value ? '继续' : '出发');
const title = computed(() => paused.value ? '已暂停' : hud.inTrial ? '试炼模式' : '选择伙伴');
const here = computed(() => hud.rooms.find(room => room.state === 'current'));
const roomStatus = { current: '当前', cleared: '已通过', open: '门已打开', locked: '' };
</script>

<template>
  <div class="menu" :class="[hud.menuMode, { hidden: !hud.menuOpen || hud.menuMode === 'won' || hud.menuMode === 'lost', paused, trial: hud.inTrial }]">
    <div id="map-surface" v-show="paused" aria-hidden="true"></div>
    <ol id="map-labels" v-show="paused" :class="{ compact: hud.mapCompact }" :aria-label="`${hud.levelName} 关卡地图`">
      <li v-for="room in hud.rooms" :key="room.id" class="map-label" :class="room.state" :aria-current="room.state === 'current' ? 'location' : undefined" :style="{ transform: `translate(${room.left}px,${room.top}px) translate(-50%,-50%)` }">
        <b>{{ room.id }}</b>
        <template v-if="room.state === 'locked'"><span>未解锁</span></template>
        <template v-else><span>{{ room.name }}</span><small>{{ roomStatus[room.state] }} · {{ room.kind }}</small></template>
      </li>
    </ol>
    <div class="menu-panel">
      <h1>{{ title }}</h1>
      <ul v-if="!paused" class="loadout">
        <li v-for="(id, i) in hud.loadout" :key="id"><kbd>{{ i + 1 }}</kbd><b>{{ CARDS[id].skill }}</b><span>{{ CARDS[id].cost }} Token · {{ CARDS[id].cooldown }} 秒</span><small>{{ CARDS[id].brief }}</small></li>
        <li v-if="hud.loadout.length < SLOTS" class="loadout-empty"><kbd>{{ hud.loadout.length + 1 }}</kbd><b>空位</b><span>{{ hud.unlocked.length > 2 ? '靠清房奖励补齐' : '打赢典狱长才有新伙伴' }}</span></li>
      </ul>
      <ul v-if="paused" class="loadout">
        <li v-for="(card, i) in hud.cards" :key="card.id"><kbd>{{ i + 1 }}</kbd><b>{{ CARDS[card.id].skill }}</b><span>{{ ROMAN[card.level] }} 级{{ card.branch ? ` · ${UPGRADES[card.id][card.branch].name}` : '' }}</span><small v-if="card.branch">{{ rankText(card) }}</small></li>
      </ul>
      <section v-if="paused" id="map-info"><h2 v-if="hud.inTrial">{{ hud.wave }}</h2><h2 v-else>{{ hud.levelName }}<template v-if="here"> · {{ here.id }} {{ here.name }}</template></h2><ul v-if="hud.roomTips.length" class="room-tips"><li v-for="tip in hud.roomTips" :key="tip">{{ tip }}</li></ul></section>
      <div v-if="!paused" class="memory-row"><img :src="'./assets/ui/res-memory.webp'" alt="记忆碎片" draggable="false"><span>记忆碎片 {{ hud.shards }} · 生命 +{{ hud.vitality * VITALITY_STEP }}</span><button v-if="hud.vitality < VITALITY_MAX" class="row-button" :disabled="hud.shards < vitalityCost(hud.vitality)" @click="$emit('train')">强化 {{ vitalityCost(hud.vitality) }}</button><button class="row-button" :disabled="hud.memories < MEMORIES.length && hud.shards < MEMORY_COST" @click="$emit('memory')">{{ hud.memories < MEMORIES.length ? `回忆 ${MEMORY_COST}` : '重温回忆' }}</button></div>
      <button id="start" class="primary-button" :disabled="!hud.ready" @click="$emit('start')">{{ label }}</button>
      <button v-if="paused" class="primary-button secondary" @click="hud.settingsOpen = !hud.settingsOpen">设置</button>
      <button class="primary-button secondary" @click="$emit('home')">返回首页</button>
    </div>
    <section v-if="paused && hud.settingsOpen" id="menu-settings" class="home-panel settings-panel" aria-label="设置"><h2>设置</h2><SettingsList @setting="$emit('setting', $event)" /></section>
    <section v-if="!paused" id="card-picker" aria-label="选择召唤卡">
      <button v-for="id in CARD_IDS" :key="id" class="picker-card" :class="{ picked: hud.loadout.includes(id), locked: !startable(id) }" :disabled="!startable(id)" :aria-pressed="hud.loadout.includes(id)" :aria-label="`${CARDS[id].name} ${CARDS[id].skill}`" :title="`${CARDS[id].skill}：${CARDS[id].brief}`" @click="pick(id)">
        <img :class="{ 'picker-silhouette': !startable(id) }" :src="`./assets/cards/${id}${startable(id) ? '' : '-figure'}.webp`" alt="" draggable="false" />
        <kbd v-if="hud.loadout.includes(id)">{{ hud.loadout.indexOf(id) + 1 }}</kbd>
        <small v-if="!startable(id)" class="picker-lock">{{ lockedHint(id) }}</small>
      </button>
    </section>
  </div>
</template>
