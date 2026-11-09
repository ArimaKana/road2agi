import { reactive } from 'vue';
import { loadToySdk, retryToyRequest, toyErrorMessage, type MyRank, type RankItem, type ToySdk } from './toySdk';

export const TRIAL_BOARD = 1;
interface TrialResult {
  room: number;
  status: 'pending' | 'submitting' | 'submitted' | 'practice' | 'error' | 'unavailable';
  message: string;
}

export function createTrialLeaderboard(getSdk: () => Promise<ToySdk | null> = loadToySdk) {
  const state = reactive({
    loading: false, loaded: false, entries: [] as RankItem[], mine: null as MyRank | null,
    message: '', mineMessage: '', result: null as TrialResult | null,
  });
  let reading: Promise<void> | undefined;
  let practice = false, submittedBest = 0;

  function load(refresh = false): Promise<void> {
    if (reading) return reading;
    if (state.loaded && !refresh) return Promise.resolve();
    state.loading = true; state.message = ''; state.mineMessage = '';
    reading = (async () => {
      try {
        const sdk = await getSdk();
        if (!sdk || !await sdk.isSupport('getRankList')) {
          state.message = '在哔哩哔哩 Toy 中查看试炼排行榜。'; return;
        }
        const [list, mine] = await Promise.allSettled([
          retryToyRequest(() => sdk.getRankList({ board: TRIAL_BOARD, period: 'all', limit: 50 }), () => { state.message = '请求较多，正在稍后重试…'; }),
          retryToyRequest(() => sdk.getMyRank({ board: TRIAL_BOARD, period: 'all' })),
        ]);
        if (list.status === 'fulfilled') { state.entries = list.value; state.loaded = true; state.message = ''; }
        else state.message = toyErrorMessage(list.reason);
        if (mine.status === 'fulfilled') { state.mine = mine.value; state.mineMessage = ''; }
        else { state.mine = null; state.mineMessage = toyErrorMessage(mine.reason); }
      } catch (error) { state.message = toyErrorMessage(error); }
      finally { state.loading = false; reading = undefined; }
    })();
    return reading;
  }

  async function submitResult() {
    const result = state.result;
    if (!result || !['pending', 'error'].includes(result.status)) return;
    result.status = 'submitting'; result.message = '正在提交试炼成绩…';
    try {
      const sdk = await getSdk();
      if (!sdk || !await sdk.isSupport('submitScore')) {
        result.status = 'unavailable'; result.message = '本地纪录已保留；排行榜提交仅在支持此功能的 Toy 正式页面开放。'; return;
      }
      if (result.room > submittedBest) {
        const response = await retryToyRequest(() => sdk.submitScore({ board: TRIAL_BOARD, score: result.room }), () => { result.message = '请求较多，正在稍后重试提交…'; });
        submittedBest = Math.max(submittedBest, response.score);
        state.loaded = false; // Next time the panel opens, fetch the changed ranking once.
      }
      result.status = 'submitted'; result.message = `成绩已记录，排行榜最佳：第 ${submittedBest} 间。`;
    } catch (error) { result.status = 'error'; result.message = `${toyErrorMessage(error)}本地纪录已保留。`; }
  }

  return {
    state, load, submitResult,
    get practice() { return practice; },
    beginRun(isPractice = false) { practice = isPractice; state.result = null; },
    markPractice() { practice = true; },
    finishRun(room: number) {
      if (state.result) return; // Opening the same result panel twice must not resubmit.
      if (!Number.isInteger(room) || room < 1 || room > 16777215) {
        state.result = { room, status: 'unavailable', message: '本次成绩超出排行榜支持的范围，本地纪录已保留。' }; return;
      }
      state.result = { room, status: practice ? 'practice' : 'pending', message: practice ? '本局使用过调试功能，仅保留本地纪录。' : '' };
      if (!practice) return submitResult();
    },
  };
}

export const trialLeaderboard = createTrialLeaderboard();
