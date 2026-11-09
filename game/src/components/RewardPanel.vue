<script setup lang="ts">
import { hud } from '../game/hud';
import { CARDS, ROMAN } from '../game/cards';
import type { Reward } from '../game/rewards';

defineEmits<{ pick: [index: number] }>();

// A supply has an item card named after its kind; everything else shows the partner it is about.
const ICON: Record<Reward['kind'], string> = { upgrade: 'reward-upgrade', recruit: 'reward-partner', replace: 'reward-partner', heal: 'reward-life', refill: 'res-token', cap: 'reward-tokencap', coins: 'reward-coin', life: 'reward-life', mod: 'reward-weapon' };
// These have an icon but no card of their own.
const BARE: Partial<Record<Reward['kind'], string>> = { coins: 'reward-coin', life: 'reward-life', mod: 'reward-weapon' };
const art = (option: Reward) => BARE[option.kind] ? `./assets/ui/${BARE[option.kind]}.webp` : `./assets/cards/${'id' in option ? option.id : option.kind}.webp`;
</script>

<template>
  <div v-if="hud.reward" id="reward" role="dialog" aria-label="选择一项奖励">
    <h2>选择一项奖励</h2>
    <div class="reward-options">
      <button v-for="(option, i) in hud.reward" :key="`${option.kind}-${option.name}`" class="reward-option" :class="option.kind" @click="$emit('pick', i)">
        <img :class="{ bare: BARE[option.kind] }" :src="art(option)" alt="" draggable="false" />
        <span class="reward-text">
          <kbd>{{ i + 1 }}</kbd>
          <b><img class="reward-icon" :src="`./assets/ui/${ICON[option.kind]}.webp`" alt="" draggable="false" /><span>{{ option.name }}</span></b>
          <template v-if="option.kind === 'upgrade'">
            <small class="reward-meta"><span>{{ CARDS[option.id].skill }}</span><span>{{ ROMAN[option.level - 1] }} → {{ ROMAN[option.level] }}</span><span>· 分支 {{ option.branch }}</span></small>
            <span class="reward-effect">{{ option.text }}</span>
            <span class="reward-numbers"><span>费用 {{ option.cost[0] === option.cost[1] ? option.cost[0] : `${option.cost[0]} → ${option.cost[1]}` }}</span><span>· 冷却 {{ option.cooldown }} 秒</span></span>
          </template>
          <template v-else-if="option.kind === 'recruit'">
            <small>{{ option.returning ? '归队' : '新伙伴' }}{{ option.level > 1 ? ` · ${ROMAN[option.level]} 级` : '' }} · 加入空位</small>
            <span class="reward-effect">{{ option.text }}</span>
            <span class="reward-numbers"><span>费用 {{ option.cost }}</span><span>· 冷却 {{ option.cooldown }} 秒</span></span>
          </template>
          <template v-else-if="option.kind === 'replace'">
            <span class="reward-effect">{{ option.text }}</span>
            <span class="reward-numbers"><span>费用 {{ option.cost }}</span><span>· 冷却 {{ option.cooldown }} 秒</span></span>
          </template>
          <span v-else class="reward-effect">{{ option.text }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
#reward{touch-action:pan-y}
.reward-text b{display:flex;align-items:flex-start;gap:6px;line-height:1.4}
.reward-text b>span{min-width:0}
.reward-option img.reward-icon{flex:0 0 20px;margin:0}
:global(body.touch .reward-text b){padding-right:0}
.reward-meta,.reward-numbers{display:flex;flex-wrap:wrap;gap:2px 8px;line-height:1.4}
.reward-meta{letter-spacing:0}
.reward-meta>span{white-space:nowrap}
.reward-numbers{margin-top:auto}
.reward-numbers>span{max-width:100%}

/* Keep the art sized for the available height while giving descriptions wider columns. */
@media (orientation:landscape) and (max-height:550px){
  .reward-options{--w:max(72px,min(28vw,calc((100dvh - 208px)/1.5)));width:min(800px,100%);flex-wrap:nowrap;gap:clamp(12px,2vw,20px)}
  .reward-option{flex:1 1 0;align-items:center;min-width:0;width:auto}
  .reward-option>img{width:var(--w);max-width:100%}
  .reward-option>img.bare{padding:min(24%,calc(var(--w)*.24))}
  .reward-text{width:100%;gap:5px;padding:10px 12px}
  .reward-text b{font-size:14px}
  .reward-text small,.reward-effect,.reward-numbers{font-size:12px;line-height:1.45}
}
@media (orientation:landscape) and (max-height:350px){
  .reward-text{gap:3px;padding:8px 10px}
  .reward-text b{font-size:13px}
  .reward-text small,.reward-effect,.reward-numbers{font-size:11px}
}
</style>
