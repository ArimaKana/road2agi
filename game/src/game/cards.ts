// The nine summon cards and their numbers, as the design doc gives them. Ranges in the doc are metres; everything here is already in world units.
export const B = 10; // Spec base damage unit; the awakening gauge is paid per B.
export const WORLD_PER_METRE = 1.5; // World units per metre of the 3D reference, the same scale the sprites are packed at (tools/pack-r2v.mjs).
const M = WORLD_PER_METRE, F = 1 / 8;

export type CardId = 'glm' | 'qwen' | 'kimi' | 'seed' | 'minimax' | 'gpt' | 'claude' | 'grok' | 'gemini';
export interface Card { id: CardId; name: string; skill: string; cost: number; cooldown: number; color: number; brief: string }
export const CARDS: Record<CardId, Card> = {
  glm: { id: 'glm', name: 'GLM', skill: '狐影渗透', cost: 28, cooldown: 16, color: 0x58a6ff, brief: '策反身边最近的 2 名普通敌人 6 秒，让它们攻击同伴' },
  qwen: { id: 'qwen', name: 'Qwen', skill: '千问无界', cost: 45, cooldown: 24, color: 0xc9a2ff, brief: '获得 1 次零消耗，供贯潮刺或其他召唤卡使用，本房间内保留至用完' },
  kimi: { id: 'kimi', name: 'Kimi', skill: '月棱折光', cost: 60, cooldown: 12, color: 0xd9dcff, brief: '朝目标方向放棱镜，折射 3 道光束，优先打不同敌人' },
  seed: { id: 'seed', name: 'Seed', skill: '豆包应援', cost: 40, cooldown: 16, color: 0x5fe3e8, brief: '回复 15 生命，放下豆包替身 5 秒吸引普通敌人' },
  minimax: { id: 'minimax', name: 'MiniMax', skill: '万象片场', cost: 20, cooldown: 12, color: 0xff8a66, brief: '放出胶片列车冲撞推开敌人，撞墙的敌人再受伤害' },
  gpt: { id: 'gpt', name: 'GPT', skill: '重置会话', cost: 65, cooldown: 28, color: 0xb6a8f0, brief: '补满滑步，刷新另外两张卡的冷却' },
  claude: { id: 'claude', name: 'Claude', skill: '封禁裁决', cost: 75, cooldown: 26, color: 0xff9a4d, brief: '1 秒后裁决 180 伤害，2.5 米内溅射 50%；封印护盾 3 秒，低于 25% 生命的非 Boss 处决；Boss 追加 60 伤害与 30 失衡' },
  grok: { id: 'grok', name: 'Grok', skill: '绯月惑心', cost: 32, cooldown: 16, color: 0xff5f86, brief: '前方扇形魅惑，普通敌人 3 秒内不能攻击' },
  gemini: { id: 'gemini', name: 'Gemini', skill: '双星闪袭', cost: 50, cooldown: 18, color: 0xa98bff, brief: '在最多 4 名敌人之间穿梭连击，最后追加终结一击' },
};
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export const SLOTS = 3;
// Who is in the album from the start. Everyone else comes from beating a boss for the first time, and the album outlives the run.
export const BASE_CARDS: CardId[] = ['glm', 'kimi'];
export const DEFAULT_LOADOUT: CardId[] = [...BASE_CARDS];
export const UNLOCKS: Record<string, CardId[]> = { '1-9': ['qwen', 'minimax'], '2-9': ['seed', 'gpt', 'grok', 'gemini'], '3-9': ['claude'] };
export const UNLOCK_HINT: Partial<Record<CardId, string>> = { qwen: '通关 1-9', minimax: '通关 1-9', seed: '通关 2-9', gpt: '通关 2-9', grok: '通关 2-9', gemini: '通关 2-9', claude: '3-9 解救后永久解锁' };
// A run sets out with two unlocked partners; the third place is filled from room rewards.
export const START_SLOTS = 2;
export const canStartWith = (id: CardId, unlocked: Iterable<CardId>) => [...unlocked].includes(id);
// The cards a run would set out with: what was picked, as far as it is still allowed, topped up in album order.
export function startLoadout(current: CardId[], allowed: CardId[], slots = START_SLOTS) {
  const kept = current.filter(id => allowed.includes(id));
  return [...kept, ...allowed.filter(id => !kept.includes(id))].slice(0, slots);
}

export const TOKEN = { max: 100, start: 60, perHit: 5, perKill: 2, rate: 12 };
// The card is shown and paid for on the second frame. Until then a dash or a hit calls it off for free.
export const SUMMON = { duration: 5 * F, confirmAt: F, cancelAt: 3 * F, gap: .35, freeze: .12 };

export const GLM = { radius: 4 * M, targets: 2, time: 6, immune: 6, wake: .8, eliteWeaken: .2, eliteTime: 2, bossStagger: 20, allyDamage: 12 };
export const QWEN = { uses: 1 };
export const KIMI = { reach: 8 * M, sight: 8 * M, bolts: 3, first: .3, gap: .3, life: 1.5, damage: 2.4 * B, repeat: 1.2 * B };
export const SEED = { heal: 15, budget: 30, life: 5, reach: 4 * M, taunt: 6 * M, eliteTaunt: 2, bossWeaken: .15, bossTime: 2 };
export const MINIMAX = { length: 8 * M, speed: 8 * M / .75, width: .9, damage: 2 * B, bossDamage: 3 * B, wallDamage: 1.5 * B, push: 3, elitePush: .8, wallWindow: .5 };
export const CLAUDE = { reach: 10 * M, delay: 1, damage: 18 * B, bossExtra: 6 * B, bossStagger: 30, execute: .25, seal: 3, splash: .5, splashRadius: 2.5 * M, retarget: 3 * M };
export const GROK = { radius: 5 * M, halfAngle: Math.PI * .28, time: 3, eliteTime: 1.5, immune: 4, bossWeaken: .2, bossTime: 3, bossStagger: 15 };
export const GEMINI = { reach: 8 * M, hits: 6, gap: .2, targets: 4, perTarget: 4, damage: B, finisher: B };
export const STAGGER = { full: 100, time: 1.5, lockout: 8 };

// Levels. A card starts at I, picks a branch going to II, and III strengthens that branch. III only opens from the third region on, as the room plan has it.
export type Branch = 'A' | 'B';
export const MAX_LEVEL = 3;
export const ROMAN = ['', 'I', 'II', 'III'];
export const levelCap = (roomId: string) => Number(roomId[0]) >= 3 ? MAX_LEVEL : 2;
export interface CardRank { id: CardId; level: number; branch: Branch | null }
const rank = (c: CardRank, b: Branch) => c.branch === b ? c.level - 1 : 0;

export const glmStats = (c: CardRank) => ({ time: [GLM.time, 8, 8][rank(c, 'A')], radius: [GLM.radius, 5 * M, 5 * M][rank(c, 'B')], targets: GLM.targets + (c.level === MAX_LEVEL ? 1 : 0) });
export const qwenStats = (c: CardRank) => ({ uses: QWEN.uses + (rank(c, 'A') > 0 || rank(c, 'B') === 2 ? 1 : 0), refund: rank(c, 'B') > 0 ? 10 : 0 });
export const kimiStats = (c: CardRank) => ({ bolts: KIMI.bolts + rank(c, 'A'), breakPct: rank(c, 'B') > 0 ? .15 : 0, breakTime: [0, 4, 6][rank(c, 'B')], breakAll: rank(c, 'B') === 2 });
export const seedStats = (c: CardRank) => ({ heal: rank(c, 'A') === 2 ? 20 : SEED.heal, budget: SEED.budget + rank(c, 'A') * 10, shock: [0, 1.2 * B, 2.4 * B][rank(c, 'B')], shockRadius: [0, 2.5 * M, 3.5 * M][rank(c, 'B')] });
export const minimaxStats = (c: CardRank) => ({ width: MINIMAX.width * (1 + rank(c, 'A') * .25), blast: [0, B, 2 * B][rank(c, 'B')], blastRadius: [0, 2 * M, 3 * M][rank(c, 'B')] });
export const gptStats = (c: CardRank) => ({ haste: [0, .15, .25][rank(c, 'A')], hasteTime: [0, 2, 3][rank(c, 'A')], boost: [0, .1, .2][rank(c, 'B')] });
export const claudeStats = (c: CardRank) => ({ damage: [CLAUDE.damage, 24 * B, 30 * B][rank(c, 'B')], execute: rank(c, 'B') === 2 ? .3 : CLAUDE.execute, splash: [CLAUDE.splash, .75, 1][rank(c, 'A')], splashRadius: [CLAUDE.splashRadius, 3 * M, 4 * M][rank(c, 'A')], unbound: rank(c, 'B') > 0 });
export const grokStats = (c: CardRank) => ({ radius: [GROK.radius, GROK.radius, 6 * M][rank(c, 'A')], half: [GROK.halfAngle, Math.PI * .36, Math.PI * .44][rank(c, 'A')], bonus: [0, .15, .3][rank(c, 'B')] });
export const geminiStats = (c: CardRank) => ({ hits: GEMINI.hits + rank(c, 'A') * 2, finisher: [GEMINI.finisher, 2 * B, 3 * B][rank(c, 'B')] });
// Only Qwen's price ever moves. No level shortens a cooldown: the doc rules it out for GPT, and the others have no need of it.
export const cardPrice = (c: CardRank) => c.id === 'qwen' && rank(c, 'A') === 2 ? 35 : CARDS[c.id].cost;
// The cards that deal damage themselves, which is all GPT's boost can add to.
export const DEALS_DAMAGE: CardId[] = ['kimi', 'seed', 'minimax', 'claude', 'gemini'];

export interface Upgrade { name: string; two: string; three: string }
export const UPGRADES: Record<CardId, Record<Branch, Upgrade>> = {
  glm: { A: { name: '长线潜伏', two: '策反持续 6 → 8 秒', three: '策反人数 2 → 3 名' }, B: { name: '狐影四散', two: '范围 4 → 5 米', three: '策反人数 2 → 3 名' } },
  qwen: { A: { name: '无界增量', two: '零消耗次数 1 → 2 次', three: '这张卡的费用 45 → 35' }, B: { name: '余响回流', two: '零消耗次数用尽时回复 10 Token', three: '零消耗次数 1 → 2 次，用尽时仍回复 10 Token' } },
  kimi: { A: { name: '多重折射', two: '折射 3 → 4 次', three: '折射 4 → 5 次' }, B: { name: '碎光破甲', two: '第一个命中的敌人破甲 15%，持续 4 秒', three: '每个新命中的敌人都破甲，持续 6 秒' } },
  seed: { A: { name: '加量应援', two: '治疗额度 30 → 40', three: '治疗额度 40 → 50，每次回复 15 → 20' }, B: { name: '替身爆裂', two: '替身结束时冲击周围，12 伤害', three: '冲击 12 → 24 伤害，范围更大' } },
  minimax: { A: { name: '宽幅胶片', two: '列车宽度 +25%', three: '列车宽度 +50%' }, B: { name: '杀青爆破', two: '列车到终点时爆破，10 伤害', three: '爆破 10 → 20 伤害，范围更大' } },
  gpt: { A: { name: '疾行重启', two: '重置后 2 秒移速 +15%', three: '重置后 3 秒移速 +25%' }, B: { name: '缓存增幅', two: '刷新到的卡下次伤害 +10%', three: '刷新到的卡下次伤害 +20%' } },
  claude: { A: { name: '连坐裁决', two: '溅射范围 2.5 → 3 米，伤害 50% → 75%，不会处决旁人', three: '溅射范围 3 → 4 米，伤害 75% → 100%' }, B: { name: '解限', two: '裁决 180 → 240 伤害', three: '裁决 240 → 300 伤害，处决线 25% → 30%' } },
  grok: { A: { name: '绯月满盈', two: '扇形更宽', three: '扇形再宽，射程 5 → 6 米' }, B: { name: '心痕', two: '被魅惑的敌人受刺剑伤害 +15%', three: '被魅惑的敌人受刺剑伤害 +30%' } },
  gemini: { A: { name: '星轨连舞', two: '连击 6 → 8 次', three: '连击 8 → 10 次' }, B: { name: '终结之星', two: '终结一击 10 → 20 伤害', three: '终结一击 20 → 30 伤害' } },
};
// What the upgrades taken so far add up to, for the card's tooltip and the pause menu.
export const rankText = (c: CardRank) => !c.branch ? '' : c.level === MAX_LEVEL ? `${UPGRADES[c.id][c.branch].two}；${UPGRADES[c.id][c.branch].three}` : UPGRADES[c.id][c.branch].two;
