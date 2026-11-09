<script setup lang="ts">
import { hud } from '../game/hud';
import { CARDS, ROMAN, SLOTS, rankText } from '../game/cards';
import { keyName, padName, type Action } from '../game/saves';

const keyOf = (i: number) => { const action = `card${i + 1}` as Action; return hud.device === 'pad' ? padName(hud.bindings.pad[action] ?? 0) : keyName(hud.bindings.keys[action]); };
</script>

<template>
  <div id="card-row" :class="{ hidden: hud.menuOpen }">
    <button v-for="(card, i) in hud.cards" :key="card.id" class="card-slot" :data-slot="i" :class="[`lv${card.level}`, { cooling: card.cooldown > 0, broke: card.broke, casting: card.casting, invalid: card.invalid }]" :aria-label="`${CARDS[card.id].name} ${CARDS[card.id].skill} ${ROMAN[card.level]} 级`" :title="`${CARDS[card.id].skill} ${ROMAN[card.level]}：${CARDS[card.id].brief}${card.branch ? `。${rankText(card)}` : ''}`">
      <img :src="`./assets/cards/${card.id}.webp`" alt="" draggable="false" />
      <img v-if="card.level > 1" class="card-overlay" :src="`./assets/ui/frame-tier${card.level}.webp`" alt="" draggable="false" />
      <img v-if="card.cost < card.price" class="card-overlay" :src="'./assets/ui/overlay-zerocost.webp'" alt="" draggable="false" />
      <i class="card-shade" :style="{ transform: `scaleY(${card.shade})` }"></i>
      <img v-if="card.cooldown > 0" class="card-overlay cooling-mark" :src="'./assets/ui/overlay-cooldown.webp'" alt="" draggable="false" />
      <b class="card-cost" :class="{ free: card.cost < card.price }"><s v-if="card.cost < card.price">{{ card.price }}</s>{{ card.cost }}</b>
      <em v-if="card.cooldown > 0" class="card-timer">{{ Math.ceil(card.cooldown) }}</em>
      <span v-if="card.level > 1" class="card-stars">{{ '★'.repeat(card.level - 1) }}<u v-if="card.branch">{{ card.branch }}</u></span>
      <span v-if="card.boost" class="card-boost">+{{ Math.round(card.boost * 100) }}%</span>
      <span v-if="card.heal >= 0" class="card-heal" :class="{ spent: !card.heal }" :title="`本大区还能回复 ${card.heal} 生命`">+{{ card.heal }}</span>
      <i v-if="card.invalid" class="card-x" aria-label="没有目标">×</i>
      <kbd class="card-key">{{ keyOf(i) }}</kbd>
    </button>
    <span v-for="n in SLOTS - hud.cards.length" :key="n" class="card-slot empty" title="清房奖励可以补上新伙伴">空</span>
  </div>
</template>
