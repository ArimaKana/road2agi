// Public API subset from https://www.bilibili.com/toy/publish/sdk.
export interface RankItem { rank: number; score: number; nickname: string; avatar: string }
export interface MyRank { ranked: boolean; rank: number; score: number }
export interface ToyContainerState {
  deviceType: 'phone' | 'tablet' | 'desktop' | 'unknown';
  viewport: { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  immersive: boolean;
  safeArea: { top: number; right: number; bottom: number; left: number };
  changedFields: string[];
}
export interface ToySdk {
  isSupport(ability: string): Promise<boolean>;
  submitScore(request: { board: number; score: number }): Promise<{ score: number }>;
  getRankList(request: { board: number; period: 'all'; limit: number }): Promise<RankItem[]>;
  getMyRank(request: { board: number; period: 'all' }): Promise<MyRank>;
  onContainerChange(listener: (state: ToyContainerState) => void): () => void;
  getContainerState(): Promise<ToyContainerState>;
  setContainerMode(request: { orientation: 'landscape'; immersive: true }): Promise<void>;
}
declare global { interface Window { toy?: ToySdk } }

const SDK_URL = 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
let loading: Promise<ToySdk | null> | undefined;

export function isToyEnvironment() {
  if (typeof window === 'undefined') return false;
  const bili = (url: string) => { try { return /(^|\.)bilibili\.com$/i.test(new URL(url).hostname); } catch { return false; } };
  // Toy may serve its content in an isolated iframe; its parent is still Bilibili.
  return !!window.toy || bili(location.href) || bili(document.referrer) || /BiliApp/i.test(navigator.userAgent);
}

export function loadToySdk(): Promise<ToySdk | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.toy) return Promise.resolve(window.toy);
  if (!isToyEnvironment()) return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise<ToySdk | null>((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (error?: Error) => {
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve(window.toy!);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('Toy SDK 载入超时'), { type: 'timeout' })), 10000);
    script.src = SDK_URL; script.async = true;
    script.onload = () => finish(window.toy ? undefined : new Error('Toy SDK 未就绪'));
    script.onerror = () => finish(new Error('Toy SDK 载入失败'));
    document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

export function toyErrorMessage(error: unknown) {
  const { type, code } = (error ?? {}) as { type?: string; code?: number };
  if (code === 307044) return '请求较多，请稍后重试。';
  if (type === 'not_logged_in' || code === -101) return '请先登录哔哩哔哩，再重试。';
  if (type === 'user_denied' || type === 'denied') return '未获得授权，可点击重试并按平台提示确认。';
  if (type === 'unsupported') return '当前环境暂不支持，请在哔哩哔哩 Toy 正式页面重试。';
  if (type === 'timeout') return '请求超时，请稍后重试。';
  return '暂时无法连接哔哩哔哩，请稍后重试。';
}

// These are retry delays, not guesses at the platform's shared request quota.
export async function retryToyRequest<T>(job: () => Promise<T>, onBackoff: () => void = () => {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await job(); }
    catch (error) {
      if ((error as { code?: number } | null)?.code !== 307044 || attempt >= 2) throw error;
      onBackoff();
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
