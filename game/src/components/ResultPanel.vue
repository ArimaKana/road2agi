<script setup lang="ts">
import { hud } from '../game/hud';
import { trialLeaderboard } from '../platform/trialLeaderboard';

defineEmits<{ retry: []; home: [] }>();
</script>

<template>
  <div v-if="hud.result" id="result" class="result" :class="hud.result.mode" role="dialog" :aria-label="hud.result.title">
    <div class="result-panel">
      <h1>{{ hud.result.title }}</h1>
      <dl>
        <div v-for="row in hud.result.rows" :key="row.label" class="result-row"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
      </dl>
      <div v-if="hud.inTrial && trialLeaderboard.state.result" class="trial-submission" role="status">
        <p>{{ trialLeaderboard.state.result.message }}</p>
        <button v-if="trialLeaderboard.state.result.status === 'error'" class="row-button" @click="trialLeaderboard.submitResult()">重新提交成绩</button>
      </div>
      <div class="result-actions">
        <button class="primary-button" @click="$emit('retry')">{{ hud.result.retry }}</button>
        <button class="primary-button" @click="$emit('home')">返回首页</button>
      </div>
      <button v-if="hud.inTrial" class="row-button result-ranking-button" @click="hud.rankingOpen = true">排行榜</button>
    </div>
  </div>
</template>

<style scoped>
.trial-submission{margin:14px 0;color:var(--ink-2);font-size:13px;line-height:1.6}
.trial-submission p{margin:0 0 8px}
.result-ranking-button{margin-top:12px}
</style>
