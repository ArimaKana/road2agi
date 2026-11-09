import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { isToyEnvironment, loadToySdk } from './toySdk';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('local standalone play does not load the remote SDK; Toy sandbox referrers are recognized', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { href: 'http://localhost:4173/' });
  const page = { referrer: '' };
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', { userAgent: 'browser' });
  assert.equal(isToyEnvironment(), false); assert.equal(await loadToySdk(), null);
  page.referrer = 'https://www.bilibili.com/toy/example/index.html';
  assert.equal(isToyEnvironment(), true);
  page.referrer = 'https://www.bilibili.com.evil.example/toy/example/';
  assert.equal(isToyEnvironment(), false);
});

test('SDK load is shared, times out without blocking play, and can be retried', async () => {
  vi.useFakeTimers();
  const script = { src: '', async: false, onload: null as (() => void) | null, onerror: null as (() => void) | null, remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/toy/example/index.html' });
  vi.stubGlobal('document', { referrer: '', createElement: () => script, head: { append } });
  vi.stubGlobal('navigator', { userAgent: 'browser' });
  const first = loadToySdk(), second = loadToySdk();
  const rejection = assert.rejects(first, /超时/);
  assert.equal(first, second); assert.equal(append.mock.calls.length, 1);
  assert.equal(script.src, 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js');
  await vi.advanceTimersByTimeAsync(10000); await rejection;
  assert.equal(script.remove.mock.calls.length, 1);
  const retry = loadToySdk();
  Object.assign(window, { toy: {} }); script.onload!();
  assert.equal(await retry, window.toy); assert.equal(append.mock.calls.length, 2);
});
