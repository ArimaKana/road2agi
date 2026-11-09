import { CAMPAIGN, type Level } from './level';
import { isRunSnapshot } from './runSnapshot';
import { SAVE_SLOTS } from './saves';
import type { RunSnapshot } from './simulation';
import { readStored, removeStored, writeStored } from './storage';

const RECOVER = 'road-to-agi.recover', LOST_AT = 'road-to-agi.lost-at', LOST_AGAIN = 20000;
export interface Recovery { slot: number; trial: number; run: RunSnapshot | null; trialPractice?: boolean }

export function saveRecovery(recovery: Recovery, now = Date.now()): 'saved' | 'recent' | 'unavailable' {
  const last = Number(readStored(LOST_AT, 'sessionStorage') ?? 0);
  if (last > 0 && now >= last && now - last < LOST_AGAIN) return 'recent';
  // Both must survive the reload, including the guard against repeated device loss.
  const text = JSON.stringify(recovery);
  if (!writeStored(LOST_AT, String(now), 'sessionStorage') || !writeStored(RECOVER, text, 'sessionStorage')
    || readStored(LOST_AT, 'sessionStorage') !== String(now) || readStored(RECOVER, 'sessionStorage') !== text) return 'unavailable';
  return 'saved';
}
export function takeRecovery(levels: Level[] = CAMPAIGN): Recovery | null {
  const text = readStored(RECOVER, 'sessionStorage');
  if (!text || !removeStored(RECOVER, 'sessionStorage')) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') return null;
    const { slot, trial, run, trialPractice } = value as Partial<Recovery>;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < -1 || slot >= SAVE_SLOTS
      || typeof trial !== 'number' || !Number.isSafeInteger(trial) || trial < 0
      || (run !== null && !isRunSnapshot(run, levels)) || (trial > 0 && !run)
      || (trialPractice !== undefined && typeof trialPractice !== 'boolean')) return null;
    return { slot, trial, run: run ?? null, ...(trialPractice === undefined ? {} : { trialPractice }) };
  } catch { return null; }
}
