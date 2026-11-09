import { CARD_IDS, MAX_LEVEL, SLOTS } from './cards';
import { CAMPAIGN, type Level } from './level';
import { MODS } from './rewards';
import type { RunSnapshot } from './simulation';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const index = (value: unknown, length: number): value is number => nonnegative(value) && Number.isInteger(value) && value < length;
function cards(value: unknown): value is RunSnapshot['hero']['cards'] {
  return Array.isArray(value) && value.length <= CARD_IDS.length && value.every(card => record(card)
    && CARD_IDS.some(id => id === card.id) && index(card.level, MAX_LEVEL + 1) && card.level >= 1
    && (card.level === 1 ? card.branch === null : card.branch === 'A' || card.branch === 'B')
    && nonnegative(card.cooldown) && nonnegative(card.boost));
}

// Persisted JSON is untrusted at runtime, even though the writer is typed.
export function isRunSnapshot(value: unknown, levels: Level[] = CAMPAIGN): value is RunSnapshot {
  if (!record(value) || !index(value.levelIndex, levels.length) || !index(value.roomIndex, levels[value.levelIndex].rooms.length)
    || !nonnegative(value.kills) || !Number.isInteger(value.kills) || !nonnegative(value.time)
    || (value.route !== undefined && !['', 'supply', 'risk'].includes(value.route as string))) return false;
  const h = value.hero;
  if (!record(h) || !['hp', 'maxHp', 'coins', 'token', 'tokenMax', 'awaken', 'healBudget'].every(key => nonnegative(h[key]))) return false;
  if (!(Number(h.maxHp) > 0 && Number(h.hp) <= Number(h.maxHp) && Number(h.tokenMax) > 0 && Number(h.token) <= Number(h.tokenMax))
    || typeof h.rescued !== 'boolean' || typeof h.iconBonus !== 'boolean'
    || !Array.isArray(h.mods) || !h.mods.every(mod => typeof mod === 'string' && Object.hasOwn(MODS, mod))
    || !cards(h.cards) || h.cards.length > SLOTS || !cards(h.bench)) return false;
  const ids = [...h.cards, ...h.bench].map(card => card.id);
  return new Set(ids).size === ids.length;
}
