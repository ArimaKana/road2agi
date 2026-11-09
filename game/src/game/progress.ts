// What outlives a run: which partners are in the card album. A browser with no storage just starts each visit from the base cards.
import { BASE_CARDS, CARD_IDS, type CardId } from './cards';
import { readStored, removeStored, writeStored } from './storage';

const KEY = 'road-to-agi.unlocked';

export function loadUnlocked(): CardId[] {
  try {
    const saved: unknown = JSON.parse(readStored(KEY) ?? '[]');
    return CARD_IDS.filter(id => BASE_CARDS.includes(id) || (Array.isArray(saved) && saved.includes(id)));
  } catch { return [...BASE_CARDS]; }
}
export function saveUnlocked(ids: Iterable<CardId>) {
  writeStored(KEY, JSON.stringify([...ids]));
}
export function clearUnlocked() {
  removeStored(KEY);
}
