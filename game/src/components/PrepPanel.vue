<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../game/hud';
import { CARDS, CARD_IDS, ROMAN, SLOTS, UNLOCK_HINT, type CardId } from '../game/cards';

defineEmits<{ go: [] }>();

const fresh = computed(() => hud.prep?.fresh.map(id => CARDS[id].name).join('、') ?? '');
// Picking a fourth card lets the first one go. At least one always stays.
function toggle(id: CardId) {
  const picks = hud.prep!.picks, i = picks.indexOf(id);
  if (i >= 0) { if (picks.length > 1) picks.splice(i, 1); }
  else { if (picks.length === SLOTS) picks.shift(); picks.push(id); }
}
</script>

<template>
  <div v-if="hud.prep" id="prep" role="dialog" aria-label="整备点">
    <div class="prep-text">
      <h2>整备点</h2>
      <p v-if="fresh" class="prep-fresh">{{ fresh }} 加入了卡册</p>
      <p>调整这局带的卡，最多三张。换下的卡会保留本局的等级，下次换回来还在。</p>
      <button id="prep-go" class="primary-button" @click="$emit('go')">出发 · {{ hud.prep.next }}</button>
    </div>
    <section class="prep-grid" aria-label="选择召唤卡">
      <button v-for="id in CARD_IDS" :key="id" class="picker-card" :class="{ picked: hud.prep.picks.includes(id), locked: !hud.prep.choices.includes(id) }" :disabled="!hud.prep.choices.includes(id)" :aria-pressed="hud.prep.picks.includes(id)" :aria-label="`${CARDS[id].name} ${CARDS[id].skill}`" :title="`${CARDS[id].skill}：${CARDS[id].brief}`" @click="toggle(id)">
        <img :class="{ 'picker-silhouette': !hud.prep.choices.includes(id) }" :src="`./assets/cards/${id}${hud.prep.choices.includes(id) ? '' : '-figure'}.webp`" alt="" draggable="false" />
        <kbd v-if="hud.prep.picks.includes(id)">{{ hud.prep.picks.indexOf(id) + 1 }}</kbd>
        <small v-if="!hud.prep.choices.includes(id)" class="picker-lock">{{ UNLOCK_HINT[id] }}</small>
        <small v-else-if="(hud.prep.levels[id] ?? 1) > 1" class="picker-level">{{ ROMAN[hud.prep.levels[id] ?? 1] }} 级</small>
      </button>
    </section>
  </div>
</template>
