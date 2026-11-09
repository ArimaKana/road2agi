<script setup lang="ts">
import { hud } from '../game/hud';

// Relative, so the build works from any folder.
const avatar = './assets/liangwenfeng-avatar-v001.webp';
const fist = './assets/liangwenfeng-fist-v001.webp';
</script>

<template>
  <div id="ult-stage" aria-hidden="true">
    <img id="ult-avatar" :class="hud.avatar" :src="avatar" alt="" draggable="false" />
    <img id="ult-fist" :class="{ rally: hud.fistRally }" :src="fist" alt="" draggable="false" :style="{ visibility: hud.fistVisible ? 'visible' : 'hidden', transform: hud.fistTransform, opacity: hud.fistOpacity }" />
  </div>
</template>
