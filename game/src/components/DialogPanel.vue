<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../game/hud';

defineEmits<{ choose: [index: number]; next: [] }>();
const scene = computed(() => hud.dialog);
const line = computed(() => scene.value?.lines[hud.dialogAt]);
const last = computed(() => !!scene.value && hud.dialogAt >= scene.value.lines.length - 1);
const portrait = computed(() => !line.value?.who ? '' : line.value.who === 'deepseek' ? './assets/deepseek-figure-v001.webp' : `./assets/cards/${line.value.who}-figure.webp`);
</script>

<template>
  <div v-if="scene && line" id="dialog" :class="{ event: scene.choices }" role="dialog" :aria-label="line.name" @click="$emit('next')">
    <img v-if="portrait" :key="portrait" class="dialog-portrait" :src="portrait" :alt="line.name" draggable="false">
    <div class="dialog-box">
      <b class="dialog-name">{{ line.name }}</b>
      <p>{{ line.text }}</p>
      <div v-if="last && scene.choices" class="dialog-choices">
        <button v-for="(choice, i) in scene.choices" :key="choice.label" class="primary-button" @click.stop="$emit('choose', i)">{{ choice.label }}<small>{{ choice.text }}</small></button>
      </div>
      <small v-else class="dialog-next">{{ last ? '点击关闭' : '点击继续' }}</small>
    </div>
  </div>
</template>
