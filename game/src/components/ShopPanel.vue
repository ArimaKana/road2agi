<script setup lang="ts">
import { hud } from '../game/hud';

defineEmits<{ buy: [index: number]; close: [] }>();
</script>

<template>
  <div v-if="hud.shop" id="shop" role="dialog" aria-label="补给站">
    <div class="shop-head"><h2>补给站</h2><span class="shop-coins"><img :src="'./assets/ui/res-coin.webp'" alt="算力币" draggable="false">{{ hud.coins }}</span></div>
    <ul class="shop-items">
      <li v-for="(item, i) in hud.shop" :key="item.name" class="shop-item" :class="{ sold: item.sold }">
        <img :src="`./assets/ui/${item.icon}.webp`" alt="" draggable="false">
        <div class="shop-text"><b>{{ item.name }}</b><span>{{ item.text }}</span></div>
        <button class="row-button" :disabled="item.sold || item.price > hud.coins" @click="$emit('buy', i)">{{ item.sold ? '已购' : `${item.price} 币` }}</button>
      </li>
    </ul>
    <button class="primary-button" @click="$emit('close')">离开</button>
  </div>
</template>
