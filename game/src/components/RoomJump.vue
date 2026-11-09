<script setup lang="ts">
import { hud } from '../game/hud';
import { CAMPAIGN, ROOM_KINDS } from '../game/level';

defineEmits<{ jump: [id: string]; close: [] }>();
</script>

<template>
  <div v-if="hud.jumpOpen" id="room-jump" role="dialog" aria-label="跳转房间" @click.self="$emit('close')">
    <div class="jump-panel">
      <h2>跳转房间<small>按 ` 或 Esc 关闭 · 跳过去等于从那间房开始新的一局，生命和觉醒回到开局值</small></h2>
      <div class="jump-levels">
        <section v-for="level in CAMPAIGN" :key="level.name">
          <h3>{{ level.name }}</h3>
          <button v-for="room in level.rooms" :key="room.id" :class="{ here: room.id === hud.jumpFrom }" :aria-current="room.id === hud.jumpFrom ? 'location' : undefined" @click="$emit('jump', room.id)">
            <b>{{ room.id }}</b><span>{{ room.name }}</span><small>{{ ROOM_KINDS[room.kind] }}</small>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
