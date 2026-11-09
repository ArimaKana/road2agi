import { reactive } from 'vue';
import { loadToySdk, toyErrorMessage, type ToySdk } from './toySdk';

export interface OrientationEnvironment {
  viewport(): { width: number; height: number };
  observe(listener: () => void): () => void;
  requestLandscape(): Promise<void>;
}

const browserEnvironment: OrientationEnvironment = {
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  observe(listener) {
    window.addEventListener('resize', listener);
    window.addEventListener('orientationchange', listener);
    document.addEventListener('fullscreenchange', listener);
    window.visualViewport?.addEventListener('resize', listener);
    return () => {
      window.removeEventListener('resize', listener);
      window.removeEventListener('orientationchange', listener);
      document.removeEventListener('fullscreenchange', listener);
      window.visualViewport?.removeEventListener('resize', listener);
    };
  },
  async requestLandscape() {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (direction: 'landscape') => Promise<void> };
    if (!orientation?.lock) throw new Error('Orientation lock unavailable');
    // Some browsers require fullscreen to lock orientation. It is only a way to rotate,
    // never a prerequisite for playing in an already-landscape window or iframe.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    await orientation.lock('landscape');
  },
};

// Bound SDK reads so older clients cannot leave the button disabled indefinitely.
function readWithTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('Container state timeout'), { type: 'timeout' })), 4000);
    request.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function createOrientationController(getSdk = loadToySdk, environment = browserEnvironment) {
  const state = reactive({ portrait: false, blocked: true, initializing: false, pending: false, message: '' });
  let sdk: ToySdk | null = null, nativeMode = false, active = false, generation = 0, requestId = 0;
  let offViewport: (() => void) | undefined, offContainer: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function finish(message = '') { clearTimeout(timer); state.pending = false; state.message = message; }
  function viewportChanged() {
    if (!active) return;
    const { width, height } = environment.viewport();
    if (width <= 0 || height <= 0) return; // Hidden WebViews must keep their last usable state.
    // The actual game area is authoritative, including in a resizable Toy iframe.
    // Fullscreen, immersion and possibly stale container orientation never block a wide viewport.
    state.portrait = width <= height;
    state.blocked = state.portrait;
    if (!state.blocked) finish();
  }

  async function start() {
    if (active) return;
    active = true; const started = ++generation;
    state.initializing = true; viewportChanged(); offViewport = environment.observe(viewportChanged);
    try {
      const client = await getSdk();
      if (!active || generation !== started || !client) return;
      const supported = await readWithTimeout(Promise.all([
        client.isSupport('setContainerMode'), client.isSupport('onContainerChange'), client.isSupport('getContainerState'),
      ]));
      if (!active || generation !== started) return;
      sdk = client; nativeMode = supported[0];
      let revision = 0;
      // Container notifications trigger a fresh measurement of the game area.
      if (supported[1]) offContainer = client.onContainerChange(() => {
        if (active && generation === started) { revision++; viewportChanged(); }
      });
      if (supported[2]) {
        const readingRevision = revision;
        void readWithTimeout(client.getContainerState()).then(() => {
          if (active && generation === started && revision === readingRevision) viewportChanged();
        }).catch(() => {});
      }
    } catch { /* Local viewport detection and browser rotation still work. */ }
    finally { if (generation === started) state.initializing = false; }
  }

  async function requestLandscape() {
    if (!active || state.initializing || state.pending || !state.blocked) return;
    const id = ++requestId;
    state.pending = true; state.message = '正在切换横屏…';
    timer = setTimeout(() => { if (id === requestId) finish('未检测到横屏，请重试或手动旋转设备。'); }, 8000);
    try {
      if (nativeMode && sdk) {
        await sdk.setContainerMode({ orientation: 'landscape', immersive: true });
        // The promise alone does not confirm rotation; wait for the actual viewport to change.
      } else {
        await environment.requestLandscape();
        if (active && id === requestId) {
          viewportChanged();
          if (state.blocked) finish('请将设备旋转为横屏，或调整窗口为横向。');
        }
      }
    } catch (error) {
      if (active && id === requestId && state.pending) {
        viewportChanged();
        if (state.blocked) finish(nativeMode ? `${toyErrorMessage(error)}也可手动旋转设备。`
          : '无法自动切换，请手动旋转设备或调整窗口为横屏。');
      }
    }
  }

  function stop() {
    active = false; generation++; requestId++; finish();
    offViewport?.(); offContainer?.(); offViewport = undefined; offContainer = undefined;
    sdk = null; nativeMode = false; state.initializing = false; state.blocked = true;
  }
  return { state, start, stop, requestLandscape };
}
