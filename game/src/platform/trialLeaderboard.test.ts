import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { createTrialLeaderboard } from './trialLeaderboard';
import type { ToySdk } from './toySdk';

function mockSdk() {
  return {
    isSupport: vi.fn(async () => true),
    submitScore: vi.fn(async ({ score }: { score: number }) => ({ score })),
    getRankList: vi.fn(async () => [{ rank: 1, score: 18, nickname: '试炼玩家', avatar: '' }]),
    getMyRank: vi.fn(async () => ({ ranked: false, rank: 0, score: 0 })),
    onContainerChange: vi.fn(() => () => {}), getContainerState: vi.fn(), setContainerMode: vi.fn(),
  } satisfies ToySdk;
}
afterEach(() => vi.useRealTimers());

test('opening the trial panel shares an in-flight read and caches results until manual refresh', async () => {
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  await Promise.all([board.load(), board.load()]);
  assert.equal(sdk.getRankList.mock.calls.length, 1);
  assert.deepEqual(sdk.getRankList.mock.calls[0], [{ board: 1, period: 'all', limit: 50 }]);
  assert.equal(board.state.entries[0].score, 18); assert.equal(board.state.mine?.ranked, false);
  await board.load(); assert.equal(sdk.getRankList.mock.calls.length, 1);
  await board.load(true); assert.equal(sdk.getRankList.mock.calls.length, 2);
});

test('guest can read the public list even when personal rank rejects, and ranked is authoritative', async () => {
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  sdk.getMyRank.mockRejectedValueOnce({ type: 'not_logged_in', code: -101 });
  await board.load();
  assert.equal(board.state.entries.length, 1); assert.equal(board.state.loaded, true);
  assert.match(board.state.mineMessage, /登录/); assert.equal(board.state.message, '');
  sdk.getMyRank.mockResolvedValueOnce({ ranked: true, rank: 5, score: 0 });
  await board.load(true); assert.equal(board.state.mine?.ranked, true);
});

test('a trial submits its reached room once; reopening a result and lower subsequent scores do not write again', async () => {
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  board.beginRun(); await board.finishRun(9); await board.finishRun(9); await board.submitResult();
  assert.deepEqual(sdk.submitScore.mock.calls, [[{ board: 1, score: 9 }]]);
  assert.equal(board.state.result?.status, 'submitted');
  board.beginRun(); await board.finishRun(8); assert.equal(sdk.submitScore.mock.calls.length, 1);
  board.beginRun(); await board.finishRun(10); assert.equal(sdk.submitScore.mock.calls.length, 2);
});

test('practice status sticks for the run and is cleared by a fresh trial', async () => {
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  board.beginRun(); board.markPractice(); await board.finishRun(35); await board.submitResult();
  assert.equal(board.practice, true); assert.equal(board.state.result?.status, 'practice');
  assert.equal(sdk.submitScore.mock.calls.length, 0);
  board.beginRun(); await board.finishRun(2); assert.equal(sdk.submitScore.mock.calls.length, 1);
});

test('failed submission is retried only on request; a late response cannot replace the next run result', async () => {
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  sdk.submitScore.mockRejectedValueOnce({ type: 'not_logged_in' });
  board.beginRun(); await board.finishRun(8);
  assert.equal(board.state.result?.status, 'error'); assert.equal(sdk.submitScore.mock.calls.length, 1);
  await board.submitResult(); assert.equal(board.state.result?.status, 'submitted');
  let resolve!: (value: { score: number }) => void;
  sdk.submitScore.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  board.beginRun(); const pending = board.finishRun(12);
  await Promise.resolve(); await Promise.resolve();
  board.beginRun(true); await board.finishRun(15);
  resolve({ score: 12 }); await pending;
  assert.equal(board.state.result?.room, 15); assert.equal(board.state.result?.status, 'practice');
});

test('rate limit retries back off exponentially and stop after two retries', async () => {
  vi.useFakeTimers();
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  sdk.submitScore.mockRejectedValue({ type: 'http_error', code: 307044 });
  board.beginRun(); const pending = board.finishRun(7);
  await vi.advanceTimersByTimeAsync(0); assert.equal(sdk.submitScore.mock.calls.length, 1);
  assert.match(board.state.result!.message, /稍后重试/);
  await vi.advanceTimersByTimeAsync(999); assert.equal(sdk.submitScore.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1); assert.equal(sdk.submitScore.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(1999); assert.equal(sdk.submitScore.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(1); await pending;
  assert.equal(sdk.submitScore.mock.calls.length, 3); assert.equal(board.state.result?.status, 'error');
});

test('local play, preview capability denial, and invalid scores never submit', async () => {
  const local = createTrialLeaderboard(async () => null);
  await local.load(); local.beginRun(); await local.finishRun(4);
  assert.match(local.state.message, /Toy/); assert.equal(local.state.result?.status, 'unavailable');
  const sdk = mockSdk(), board = createTrialLeaderboard(async () => sdk);
  sdk.isSupport.mockResolvedValue(false);
  board.beginRun(); await board.finishRun(4); assert.equal(sdk.submitScore.mock.calls.length, 0);
  for (const room of [NaN, Infinity, -1, 0, 2.5, 16777216]) {
    board.beginRun(); await board.finishRun(room); assert.equal(board.state.result?.status, 'unavailable');
  }
  assert.equal(sdk.submitScore.mock.calls.length, 0);
});
