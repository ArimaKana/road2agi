import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { createOrientationController, type OrientationEnvironment } from './orientation';
import type { ToyContainerState, ToySdk } from './toySdk';

function setup() {
  let size = { width: 390, height: 844 }, viewportListener = () => {};
  let containerListener: (state: ToyContainerState) => void = () => {};
  const offViewport = vi.fn(), offContainer = vi.fn();
  const environment = {
    viewport: () => size,
    observe: vi.fn((listener: () => void) => { viewportListener = listener; return offViewport; }),
    requestLandscape: vi.fn(async () => {}),
  } satisfies OrientationEnvironment;
  const portrait: ToyContainerState = {
    deviceType: 'phone', viewport: size, orientation: 'portrait', immersive: false,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, changedFields: [],
  };
  const landscape: ToyContainerState = { ...portrait, orientation: 'landscape', immersive: true, viewport: { width: 844, height: 390 }, changedFields: ['orientation', 'viewport', 'immersive'] };
  const sdk = {
    isSupport: vi.fn(async () => true), onContainerChange: vi.fn((listener: typeof containerListener) => { containerListener = listener; return offContainer; }),
    getContainerState: vi.fn(async () => portrait), setContainerMode: vi.fn(async () => {}),
    submitScore: vi.fn(), getRankList: vi.fn(), getMyRank: vi.fn(),
  } satisfies ToySdk;
  return {
    sdk, environment, portrait, landscape, offViewport, offContainer,
    resize(width: number, height: number) { size = { width, height }; viewportListener(); },
    notify(state: ToyContainerState) { containerListener(state); },
  };
}
afterEach(() => vi.useRealTimers());

test('viewport changes detect non-landscape on every device and ignore a hidden zero-size view', async () => {
  const fake = setup(), controller = createOrientationController(async () => null, fake.environment);
  await controller.start();
  assert.equal(controller.state.portrait, true); assert.equal(controller.state.initializing, false);
  assert.equal(fake.environment.requestLandscape.mock.calls.length, 0, 'rotation must wait for a click');
  fake.resize(844, 390); assert.equal(controller.state.portrait, false);
  assert.equal(controller.state.blocked, false, 'a wide window is playable without fullscreen');
  fake.resize(0, 0); assert.equal(controller.state.portrait, false);
  fake.resize(600, 600); assert.equal(controller.state.portrait, true);
  controller.stop();
});

test('native request asks for landscape and immersion together and waits for observed state', async () => {
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  await controller.start(); await controller.requestLandscape();
  assert.deepEqual(fake.sdk.setContainerMode.mock.calls, [[{ orientation: 'landscape', immersive: true }]]);
  assert.equal(controller.state.pending, true); assert.equal(controller.state.portrait, true);
  await controller.requestLandscape(); assert.equal(fake.sdk.setContainerMode.mock.calls.length, 1);
  fake.notify(fake.portrait); assert.equal(controller.state.pending, true);
  fake.resize(844, 390); fake.notify(fake.landscape);
  assert.equal(controller.state.pending, false); assert.equal(controller.state.portrait, false);
  assert.equal(controller.state.blocked, false);
  fake.resize(390, 844); fake.notify(fake.portrait); assert.equal(controller.state.portrait, true);
  assert.equal(fake.environment.requestLandscape.mock.calls.length, 0);
  controller.stop();
});

test('a late initial container read cannot overwrite a newer direction notification', async () => {
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  let resolve!: (state: ToyContainerState) => void;
  fake.sdk.getContainerState.mockImplementation(() => new Promise(done => { resolve = done; }));
  await controller.start(); fake.resize(844, 390); fake.notify(fake.landscape); resolve(fake.portrait);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.state.portrait, false); controller.stop();
});

test('unsupported native control falls back to the browser directly from the click', async () => {
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  fake.sdk.isSupport.mockResolvedValue(false);
  fake.environment.requestLandscape.mockImplementation(async () => { fake.resize(844, 390); });
  await controller.start();
  const pending = controller.requestLandscape();
  assert.equal(fake.environment.requestLandscape.mock.calls.length, 1, 'no async SDK read may consume the click activation');
  await pending; assert.equal(controller.state.portrait, false); assert.equal(controller.state.pending, false); assert.equal(controller.state.blocked, false);
  assert.equal(fake.sdk.setContainerMode.mock.calls.length, 0); controller.stop();
});

test('browser and native failures leave the gate closed and the retry button usable', async () => {
  const fake = setup(), browser = createOrientationController(async () => null, fake.environment);
  fake.environment.requestLandscape.mockRejectedValue(new Error('not supported'));
  await browser.start(); await browser.requestLandscape();
  assert.equal(browser.state.pending, false); assert.equal(browser.state.portrait, true);
  assert.equal(browser.state.blocked, true); assert.match(browser.state.message, /手动旋转/); browser.stop();
  const native = createOrientationController(async () => fake.sdk, fake.environment);
  fake.sdk.setContainerMode.mockRejectedValue({ type: 'unsupported' });
  await native.start(); await native.requestLandscape();
  assert.equal(native.state.pending, false); assert.equal(native.state.blocked, true); assert.match(native.state.message, /手动旋转/); native.stop();
});

test('a silent old client times out without claiming success and supports retry', async () => {
  vi.useFakeTimers();
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  await controller.start(); await controller.requestLandscape();
  await vi.advanceTimersByTimeAsync(8000);
  assert.equal(controller.state.pending, false); assert.equal(controller.state.portrait, true);
  assert.match(controller.state.message, /未检测到横屏/); assert.equal(controller.state.blocked, true);
  await controller.requestLandscape(); assert.equal(fake.sdk.setContainerMode.mock.calls.length, 2);
  controller.stop(); assert.equal(vi.getTimerCount(), 0);
});

test('stopping releases viewport and SDK listeners, including during a pending switch', async () => {
  vi.useFakeTimers();
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  await controller.start(); await controller.start(); await controller.requestLandscape();
  assert.equal(fake.environment.observe.mock.calls.length, 1);
  controller.stop(); fake.notify(fake.landscape); fake.resize(844, 390);
  assert.equal(controller.state.portrait, true); assert.equal(controller.state.pending, false);
  assert.equal(fake.offContainer.mock.calls.length, 1); assert.equal(fake.offViewport.mock.calls.length, 1);
  assert.equal(vi.getTimerCount(), 0);
});

test('an unavailable SDK or stalled capability read never blocks viewport detection', async () => {
  vi.useFakeTimers();
  const fake = setup(), failed = createOrientationController(async () => { throw new Error('offline'); }, fake.environment);
  await failed.start(); assert.equal(failed.state.initializing, false); assert.equal(failed.state.portrait, true); failed.stop();
  fake.sdk.isSupport.mockImplementation(() => new Promise(() => {}));
  const stalled = createOrientationController(async () => fake.sdk, fake.environment), starting = stalled.start();
  await vi.advanceTimersByTimeAsync(4000); await starting;
  assert.equal(stalled.state.initializing, false); fake.resize(844, 390); assert.equal(stalled.state.portrait, false);
  stalled.stop(); assert.equal(vi.getTimerCount(), 0);
});

test('a landscape viewport is playable regardless of immersion or stale container orientation', async () => {
  const fake = setup(), controller = createOrientationController(async () => fake.sdk, fake.environment);
  await controller.start(); await controller.requestLandscape();
  fake.resize(844, 390); assert.equal(controller.state.blocked, false);
  fake.notify({ ...fake.landscape, immersive: false });
  assert.equal(controller.state.portrait, false);
  assert.equal(controller.state.blocked, false); assert.equal(controller.state.pending, false);
  fake.notify(fake.landscape); assert.equal(controller.state.blocked, false);
  fake.notify({ ...fake.landscape, immersive: false }); assert.equal(controller.state.blocked, false);
  fake.notify(fake.portrait); assert.equal(controller.state.blocked, false, 'stale native state cannot block an actually-wide iframe');
  controller.stop();
});

test('an already-wide browser or iframe starts immediately without any fullscreen or rotation request', async () => {
  const fake = setup(), controller = createOrientationController(async () => null, fake.environment);
  fake.resize(1000, 700); await controller.start();
  assert.equal(controller.state.portrait, false); assert.equal(controller.state.blocked, false);
  await controller.requestLandscape();
  assert.equal(fake.environment.requestLandscape.mock.calls.length, 0);
  fake.resize(1387, 646); assert.equal(controller.state.blocked, false);
  controller.stop();
});

test('API success or a reported immersive landscape cannot unlock an actually-portrait viewport', async () => {
  const fake = setup(), controller = createOrientationController(async () => null, fake.environment);
  await controller.start(); await controller.requestLandscape();
  assert.equal(controller.state.blocked, true); assert.match(controller.state.message, /旋转为横屏/);
  fake.resize(844, 390); assert.equal(controller.state.blocked, false);
  controller.stop();
  fake.resize(390, 844);
  const native = createOrientationController(async () => fake.sdk, fake.environment);
  await native.start(); fake.notify(fake.landscape);
  assert.equal(native.state.blocked, true); native.stop();
});
