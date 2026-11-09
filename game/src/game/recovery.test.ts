import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { Game } from './simulation';
import { saveRecovery, takeRecovery } from './recovery';
import { loadSaves, loadSettings, DEFAULT_SETTINGS, writeSave } from './saves';
import { readStored, removeStored, writeStored } from './storage';

const KEY = 'road-to-agi.recover';
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const denied = () => { throw new DOMException('Access denied', 'SecurityError'); };
afterEach(() => vi.unstubAllGlobals());

test('unavailable storage properties allow startup with defaults and prevent automatic reload', () => {
  for (const name of ['sessionStorage', 'localStorage'] as const) {
    vi.stubGlobal(name, undefined);
    Object.defineProperty(globalThis, name, { configurable: true, get: denied });
  }
  assert.equal(takeRecovery(), null);
  assert.deepEqual(loadSaves(), [null, null, null]); assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.equal(saveRecovery({ slot: -1, trial: 0, run: null }), 'unavailable');
});

test('storage method failures are handled, including unreadable recovery guards', () => {
  vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });
  assert.equal(readStored(KEY, 'sessionStorage'), null);
  assert.equal(writeStored(KEY, '{}', 'sessionStorage'), false);
  assert.equal(removeStored(KEY, 'sessionStorage'), false);
  assert.equal(takeRecovery(), null);
  vi.stubGlobal('sessionStorage', { ...memory(), getItem: denied });
  assert.equal(saveRecovery({ slot: -1, trial: 0, run: null }), 'unavailable');
});

test('a recovery is consumed once and repeated device loss stops reloading', () => {
  vi.stubGlobal('sessionStorage', memory());
  const game = new Game(); game.start('2-3');
  const recovery = { slot: 1, trial: 0, run: game.snapshot() };
  assert.equal(saveRecovery(recovery, 100000), 'saved');
  assert.deepEqual(takeRecovery(), recovery); assert.equal(takeRecovery(), null);
  assert.equal(saveRecovery(recovery, 100500), 'recent');
  assert.equal(saveRecovery(recovery, 120001), 'saved');
  const trial = { slot: -1, trial: 7, run: game.snapshot() };
  assert.equal(saveRecovery(trial, 150000), 'saved'); assert.deepEqual(takeRecovery(), trial);
  const practice = { ...trial, trialPractice: true };
  assert.equal(saveRecovery(practice, 180000), 'saved'); assert.deepEqual(takeRecovery(), practice);
});

test('malformed or incomplete recovery data is discarded without reaching restore', () => {
  const store = memory(); vi.stubGlobal('sessionStorage', store);
  const run = new Game().snapshot();
  for (const value of [null, [], {}, { slot: 0, trial: 1, run: null }, { slot: 0, trial: 1, run: { ...run, levelIndex: 99 } },
    { slot: 0, trial: 1, run: { ...run, hero: { ...run.hero, cards: [{ id: 'unknown' }] } } }]) {
    store.setItem(KEY, JSON.stringify(value)); assert.equal(takeRecovery(), null); assert.equal(store.getItem(KEY), null);
  }
  store.setItem(KEY, '{broken'); assert.equal(takeRecovery(), null);
  store.setItem(KEY, JSON.stringify({ slot: 0, trial: 0, run }));
  vi.stubGlobal('sessionStorage', { ...store, removeItem: denied });
  assert.equal(takeRecovery(), null, 'a recovery that cannot be consumed must not replay');
});

test('campaign saves round trip and malformed snapshots are not offered for loading', () => {
  const store = memory(); vi.stubGlobal('localStorage', store);
  const game = new Game(); game.start('2-3');
  const save = { slot: 0, savedAt: 100, roomId: game.plan.id, roomName: game.plan.name, levelName: game.level.name, run: game.snapshot() };
  writeSave(save); assert.deepEqual(loadSaves()[0], save);
  store.setItem('road-to-agi.saves', JSON.stringify({ 0: { ...save, run: { ...save.run, roomIndex: 999 } }, 1: true }));
  assert.deepEqual(loadSaves(), [null, null, null]);
});
