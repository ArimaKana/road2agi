// What a cleared room pays out: one of three, in a screen that holds the fight still. Upgrades come first; supplies only fill the places they leave empty.
import { CARDS, MAX_LEVEL, ROMAN, SLOTS, UPGRADES, cardPrice, seedStats, type Branch, type CardId } from './cards.ts';
import type { CardSlot, Hero } from './simulation.ts';

export interface UpgradeReward { kind: 'upgrade'; slot: number; id: CardId; level: number; branch: Branch; name: string; text: string; cost: [number, number]; cooldown: number }
// A partner not on the team. With a free place she joins; with none she takes the place of the lowest card, which the option says.
export interface ReplaceReward { kind: 'replace'; slot: number; id: CardId; out: CardId; name: string; text: string; cost: number; cooldown: number }
export interface RecruitReward { kind: 'recruit'; id: CardId; level: number; returning: boolean; name: string; text: string; cost: number; cooldown: number }
export interface SupplyReward { kind: 'heal' | 'refill' | 'cap' | 'coins' | 'life'; name: string; text: string }
export type WeaponMod = 'pierce' | 'wide' | 'opener';
export interface ModReward { kind: 'mod'; mod: WeaponMod; name: string; text: string }
export type Reward = UpgradeReward | RecruitReward | ReplaceReward | SupplyReward | ModReward;
// Spec section 7: they change how the rapier is used, and never make a thrust cover the screen.
export const MODS: Record<WeaponMod, { name: string; text: string }> = {
  pierce: { name: '穿透刺', text: '连续穿刺能穿过正面盾' },
  wide: { name: '阔潮刺', text: '贯潮刺宽度 +40%' },
  opener: { name: '掠影刺', text: '滑步后第一击伤害 +30%' },
};
export const modOffer = (h: Hero): ModReward[] => (Object.keys(MODS) as WeaponMod[]).filter(mod => !h.mods.includes(mod)).map(mod => ({ kind: 'mod', mod, ...MODS[mod] }));
export const freshCard = (id: CardId): CardSlot => ({ id, cooldown: 0, level: 1, branch: null, boost: 0 });

const OPTIONS = 3, LIFE_CEILING = 140;
export const TOKEN_CEILING = 130; // With every card as high as it can go a long run keeps paying supplies, so the cap has to stop somewhere.
export const SUPPLIES: SupplyReward[] = [
  { kind: 'heal', name: '紧急修复', text: '回复 30 生命' },
  { kind: 'refill', name: '算力补给', text: '回复 40 Token' },
  { kind: 'cap', name: '扩容', text: 'Token 上限 +10，并回复 10 Token' },
  { kind: 'coins', name: '算力结余', text: '得到 15 算力币' },
  { kind: 'life', name: '冗余备份', text: '最大生命 +10，并回复 10 生命' },
];

function upgrade(card: CardSlot, slot: number, branch: Branch): UpgradeReward {
  const level = card.level + 1, up = UPGRADES[card.id][branch];
  return { kind: 'upgrade', slot, id: card.id, level, branch, name: up.name, text: level === 2 ? up.two : up.three, cost: [cardPrice(card), cardPrice({ id: card.id, level, branch })], cooldown: CARDS[card.id].cooldown };
}
function recruit(h: Hero, id: CardId): RecruitReward | ReplaceReward {
  const returning = h.bench.some(card => card.id === id), benched = h.bench.find(card => card.id === id) ?? freshCard(id);
  if (h.cards.length < SLOTS) return { kind: 'recruit', id, level: benched.level, returning, name: CARDS[id].skill, text: CARDS[id].brief, cost: cardPrice(benched), cooldown: CARDS[id].cooldown };
  const slot = h.cards.reduce((low, card, i) => card.level < h.cards[low].level ? i : low, 0), out = h.cards[slot];
  return { kind: 'replace', slot, id, out: out.id, name: `${CARDS[id].skill} 上场`, text: `换下 ${CARDS[out.id].skill}，${ROMAN[out.level]} 级保留到替补席。${CARDS[id].brief}`, cost: cardPrice(benched), cooldown: CARDS[id].cooldown };
}
function shuffled<T>(list: T[], random: () => number) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function rewardOptions(h: Hero, cap = MAX_LEVEL, pool: CardId[] = [], random = Math.random): Reward[] {
  const upgrades = h.cards.flatMap<Reward>((card, slot) => {
    if (card.level >= cap) return [];
    return card.branch ? [upgrade(card, slot, card.branch)] : [upgrade(card, slot, 'A'), upgrade(card, slot, 'B')];
  });
  // A new partner always gets one of the three when there is one, so the third place can be filled. Which upgrades share the rest is down to chance.
  const recruits = shuffled(pool, random).map(id => recruit(h, id)), room = OPTIONS - Math.min(1, recruits.length);
  // Both branches of a card only share the three when there are not enough other cards to fill them.
  const mixed = shuffled(upgrades, random), firsts = mixed.filter((r, i) => mixed.findIndex(o => 'slot' in o && 'slot' in r && o.slot === r.slot) === i), seconds = mixed.filter(r => !firsts.includes(r));
  const chosen = [...firsts, ...seconds].slice(0, room).sort((a, b) => upgrades.indexOf(a) - upgrades.indexOf(b));
  return [...recruits.slice(0, 1), ...chosen, ...recruits.slice(1), ...shuffled([...modOffer(h), ...SUPPLIES.filter(s => (s.kind !== 'cap' || h.tokenMax < TOKEN_CEILING) && (s.kind !== 'life' || h.maxHp < LIFE_CEILING))], random)].slice(0, OPTIONS);
}
// What the supply road pays: only what keeps her going, and nothing that makes her or the cards stronger. Extra life here would outweigh everything the other road pays.
export function supplyOptions(h: Hero, random = Math.random): Reward[] {
  return shuffled(SUPPLIES.filter(s => s.kind !== 'life' && (s.kind !== 'cap' || h.tokenMax < TOKEN_CEILING)), random).slice(0, OPTIONS);
}
// Everything the cards she carries could become, for a stall that has room to show it all.
export const allUpgrades = (h: Hero, cap = MAX_LEVEL) => h.cards.flatMap((card, slot) => card.level >= cap ? [] : (card.branch ? [card.branch] : ['A', 'B'] as Branch[]).map(branch => upgrade(card, slot, branch)));
// Back from the bench with the level she had, or new.
function take(h: Hero, id: CardId) {
  const benched = h.bench.find(card => card.id === id);
  h.bench = h.bench.filter(card => card !== benched);
  return benched ?? freshCard(id);
}
export function applyReward(h: Hero, reward: Reward) {
  if (reward.kind === 'recruit') h.cards.push(take(h, reward.id));
  else if (reward.kind === 'replace') {
    // She takes over whatever was left on the place's cooldown, so swapping can't be used to get round it.
    const out = h.cards[reward.slot], card = take(h, reward.id);
    card.cooldown = out.cooldown; h.cards[reward.slot] = card; h.bench.push(out); h.summon = null; h.cardBufferTime = 0;
  } else if (reward.kind === 'upgrade') {
    const card = h.cards[reward.slot], before = seedStats(card).budget;
    card.level = reward.level; card.branch = reward.branch;
    if (card.id === 'seed') h.healBudget += seedStats(card).budget - before;
  } else if (reward.kind === 'heal') h.hp = Math.min(h.maxHp, h.hp + 30);
  else if (reward.kind === 'coins') h.coins += 15;
  else if (reward.kind === 'life') { h.maxHp += 10; h.hp += 10; }
  else if (reward.kind === 'mod') h.mods = [...h.mods, reward.mod];
  else if (reward.kind === 'refill') h.token = Math.min(h.tokenMax, h.token + 40);
  else if (reward.kind === 'cap') { h.tokenMax += 10; h.token = Math.min(h.tokenMax, h.token + 10); }
}
