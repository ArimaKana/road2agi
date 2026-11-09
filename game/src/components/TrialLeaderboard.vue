<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { trialLeaderboard } from '../platform/trialLeaderboard';
import { hud } from '../game/hud';

const { state } = trialLeaderboard;
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement>(), closeButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
const avatarUrl = (url: string) => /^(https:)?\/\//.test(url) ? url.replace(/^\/\//, 'https://') : undefined;
function keydown(event: KeyboardEvent) {
  if (hud.playBlocked) return;
  if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); }
  if (event.code !== 'Tab') return;
  const buttons = [...dialog.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const first = buttons[0], last = buttons.at(-1);
  if (!buttons.includes(document.activeElement as HTMLButtonElement)) { event.preventDefault(); first?.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null;
  closeButton.value?.focus();
  window.addEventListener('keydown', keydown, true);
  void trialLeaderboard.load();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown, true);
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <div id="trial-leaderboard" class="ranking-backdrop" @click.self="$emit('close')">
  <section ref="dialog" class="trial-ranking" role="dialog" aria-modal="true" aria-labelledby="ranking-title" :aria-busy="state.loading">
    <div class="ranking-heading">
      <h2 id="ranking-title">试炼排行榜</h2>
      <button ref="closeButton" class="row-button" aria-label="关闭排行榜" @click="$emit('close')">关闭</button>
    </div>
    <div class="ranking-heading ranking-toolbar">
      <span>总榜 · 前 50 名</span>
      <button class="row-button" :disabled="state.loading" @click="trialLeaderboard.load(true)">{{ state.loading ? '载入中…' : '刷新' }}</button>
    </div>
    <p class="ranking-note">按到达房间数排名，同分先到者在前。</p>
    <p v-if="state.message" class="ranking-note" role="status">{{ state.message }}</p>
    <p v-if="state.mine" class="ranking-mine">{{ state.mine.ranked ? `我的排名：第 ${state.mine.rank} 名 · 到达第 ${state.mine.score} 间` : '你还未上榜，完成一次试炼即可提交成绩。' }}</p>
    <p v-else-if="state.mineMessage" class="ranking-note">{{ state.mineMessage }}</p>
    <div v-if="state.entries.length" class="ranking-scroll">
      <table class="ranking-table">
        <thead><tr><th scope="col">名次</th><th scope="col">玩家</th><th scope="col">到达房间</th></tr></thead>
        <tbody><tr v-for="entry in state.entries" :key="entry.rank">
          <td>{{ entry.rank }}</td>
          <td><span class="ranking-player"><img v-if="avatarUrl(entry.avatar)" :src="avatarUrl(entry.avatar)" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>{{ entry.nickname }}</span></span></td>
          <td>第 {{ entry.score }} 间</td>
        </tr></tbody>
      </table>
    </div>
    <p v-else-if="state.loaded && !state.loading" class="ranking-note">还没有玩家上榜。</p>
  </section>
  </div>
</template>

<style scoped>
.ranking-backdrop{position:fixed;inset:0;z-index:18;display:flex;align-items:center;justify-content:center;padding:16px;background:#030812bf;pointer-events:auto}
.trial-ranking{display:flex;flex-direction:column;width:min(580px,100%);max-height:calc(100dvh - 32px);padding:24px;border:1px solid var(--gold);background:var(--corners),linear-gradient(180deg,#10233b,#081425);background-repeat:no-repeat;box-shadow:0 12px 40px #000b;overflow:auto;touch-action:pan-y}
.ranking-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ranking-heading h2{margin:0;font-size:23px;color:var(--gold-hi);letter-spacing:2px}
.ranking-toolbar{margin-top:18px;padding-top:12px;border-top:1px solid var(--gold-dim);font-size:13px;color:var(--ink-2)}
.ranking-heading button{width:auto;flex:none}
.ranking-note{font-size:12px;line-height:1.6;color:var(--ink-2);margin:10px 0}
.ranking-mine{font-size:13px;line-height:1.6;color:var(--gold-hi)}
.ranking-scroll{min-height:50px;max-height:380px;overflow:auto;touch-action:pan-y;flex-shrink:1}
.ranking-table{width:100%;border-collapse:collapse;font-size:13px;text-align:left;table-layout:fixed}
.ranking-table th{color:var(--ink-2);font-weight:400}
.ranking-table th:first-child{width:44px}.ranking-table th:last-child{width:90px;text-align:right}
.ranking-table td,.ranking-table th{padding:8px 4px;border-bottom:1px solid #c8a45a2e}
.ranking-table td:last-child{text-align:right}
.ranking-player{display:flex;align-items:center;gap:8px;min-width:0}
.ranking-player img{width:26px;height:26px;border-radius:50%;flex:none}.ranking-player span{overflow-wrap:anywhere}
@media(max-height:550px){.trial-ranking{padding:12px 18px}.ranking-heading h2{font-size:19px}.ranking-toolbar{margin-top:8px;padding-top:8px}.ranking-note,.ranking-mine{margin:5px 0}.ranking-scroll{max-height:160px}}
</style>
