<script setup lang="ts">
import { hud } from '../game/hud';
import { CARDS, type CardId } from '../game/cards';

const tint = (id: CardId) => `#${CARDS[id].color.toString(16).padStart(6, '0')}`;
// Each one leaves when its animation ends, so cards played close together overlap.
const done = (key: number) => { hud.cutIns = hud.cutIns.filter(c => c.key !== key); };
</script>

<template>
  <div id="card-stage" aria-hidden="true">
    <img v-for="c in hud.cutIns" :key="c.key" class="card-cutin" :class="{ 'verdict-cutin': c.id === 'claude' }" :src="`./assets/cards/${c.id}-figure.webp`" :style="{ '--tint': tint(c.id) }" alt="" draggable="false" @animationend="done(c.key)" />
  </div>
</template>
