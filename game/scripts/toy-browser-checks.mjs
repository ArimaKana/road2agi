// Exercise the actual Vue panels and engine lifecycle without writing to a live Toy.
export async function runToyBrowserChecks({ send, evaluate, until, check, capture, click, base }) {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('road-to-agi.god', '{"on":false}');
    localStorage.setItem('road-to-agi.trials', '{"room":99}');
    window.__toyCalls = { list: 0, mine: 0, scores: [], modes: [] };
    window.__toyContainer = { deviceType: 'phone', viewport: { width: innerWidth, height: innerHeight }, orientation: innerWidth > innerHeight ? 'landscape' : 'portrait', immersive: false, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, changedFields: [] };
    window.__emitToyContainer = () => {};
    window.toy = {
      isSupport: async ability => !sessionStorage.getItem('toy-container-unsupported') || !['onContainerChange', 'getContainerState', 'setContainerMode'].includes(ability),
      getRankList: async () => { window.__toyCalls.list++; return [{ rank: 1, score: 42, nickname: '试炼先锋', avatar: '' }]; },
      getMyRank: async () => { window.__toyCalls.mine++; return { ranked: true, rank: 2, score: 7 }; },
      submitScore: async request => { window.__toyCalls.scores.push(request); return { score: request.score }; },
      onContainerChange: listener => { window.__emitToyContainer = state => { window.__toyContainer = state; listener(state); }; return () => { window.__emitToyContainer = () => {}; }; },
      getContainerState: async () => window.__toyContainer,
      setContainerMode: async request => { window.__toyCalls.modes.push(request); },
    };
  ` });
  try {
    await evaluate('if (document.fullscreenElement) await document.exitFullscreen();');
    await send('Page.navigate', { url: `${base}?debug&nostory&webgl` });
    await until(() => evaluate('return !!window.engine;'), 'Toy test game starts');
    check('a landscape Toy starts immediately without fullscreen or immersion', await evaluate(`return !document.querySelector('#game-content').inert && !document.querySelector('#rotate-hint') && !document.fullscreenElement && !window.__toyContainer.immersive && window.__toyCalls.modes.length === 0;`));
    await evaluate(`window.__emitToyContainer({ ...window.__toyContainer, viewport: { width: 390, height: 844 }, orientation: 'portrait', immersive: false });`);
    check('a stale Toy portrait report cannot block an actually-wide game area', await evaluate('return !document.querySelector("#rotate-hint") && !document.querySelector("#game-content").inert;'));
    await capture('toy-landscape-windowed');
    check('local best is retained and never automatically uploaded', await evaluate(`
      const { hud } = await import('/src/game/hud.ts');
      return hud.trialBest === 99 && window.__toyCalls.scores.length === 0;
    `));
    const toggleTrial = `Array.from(document.querySelectorAll('.home-button')).find(button => button.textContent === '试炼模式').click();`;
    await evaluate(toggleTrial);
    check('the trial entry does not fetch a board before its button is clicked', await evaluate('return !document.querySelector("#trial-leaderboard") && window.__toyCalls.list === 0;'));
    const openRanking = `Array.from(document.querySelectorAll('[aria-label="试炼模式"] button')).find(button => button.textContent === '排行榜').click();`;
    await evaluate(openRanking);
    await until(() => evaluate(`return document.querySelector('.ranking-table')?.textContent.includes('试炼先锋');`), 'Toy leaderboard appears');
    check('trial panel renders ranked rooms and personal rank', await evaluate(`return document.querySelector('.ranking-table').textContent.includes('第 42 间') && document.querySelector('.ranking-mine').textContent.includes('第 2 名');`));
    await evaluate(`document.querySelector('[aria-label="关闭排行榜"]').click();`);
    await evaluate(openRanking);
    check('reopening the trial panel uses its cached board', await evaluate('return window.__toyCalls.list === 1 && window.__toyCalls.mine === 1;'));
    await capture('toy-trial-leaderboard');
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
    check('leaderboard dialog fits a phone landscape viewport', await evaluate(`const box = document.querySelector('[aria-labelledby="ranking-title"]').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;`));
    await capture('toy-leaderboard-phone');
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('.ranking-toolbar button').click();`);
    await until(() => evaluate('return window.__toyCalls.list === 2;'), 'manual board refresh');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await until(() => evaluate('return !document.querySelector("#trial-leaderboard");'), 'Escape closes leaderboard');
    check('leaderboard opens as an independent modal and closes with Escape', true);
    await evaluate(`Array.from(document.querySelectorAll('[aria-label="试炼模式"] .save-row button')).find(button => button.textContent === '开始').click(); document.querySelector('#start').click();`);
    await until(() => evaluate(`return window.game.trial?.room === 1 && window.game.state === 'playing';`), 'trial starts');
    await evaluate(`window.game.trial.room = 6; window.game.state = 'lost'; window.engine.showMenu('lost');`);
    await until(() => evaluate(`return document.querySelector('.trial-submission')?.textContent.includes('成绩已记录');`), 'trial score submission');
    check('real trial result submits reached room, independently of the old local best', await evaluate(`return window.__toyCalls.scores.length === 1 && window.__toyCalls.scores[0].score === 6 && window.__toyCalls.scores[0].board === 1;`));
    await evaluate(`window.engine.showMenu('lost');`);
    check('reopening a result does not resubmit', await evaluate('return window.__toyCalls.scores.length === 1;'));
    await capture('toy-trial-result');
    await evaluate(`document.querySelector('.result-ranking-button').click();`);
    await until(() => evaluate('return !!document.querySelector("#trial-leaderboard");'), 'result leaderboard opens');
    await evaluate(`window.engine.padBack();`);
    check('gamepad back closes the ranking without leaving the result', await evaluate('return !document.querySelector("#trial-leaderboard") && !!document.querySelector("#result");'));
    await evaluate(`document.querySelector('#result .result-actions button').click();`);
    await until(() => evaluate(`return window.game.trial?.room === 1 && window.game.state === 'playing';`), 'trial retries');
    await evaluate(`window.engine.setGod(true); window.engine.setGod(false); window.game.trial.room = 15; window.game.state = 'lost'; window.engine.showMenu('lost');`);
    check('a trial remains excluded after invincibility is switched back off', await evaluate(`return window.__toyCalls.scores.length === 1 && document.querySelector('.trial-submission').textContent.includes('调试功能');`));

    await evaluate(`document.querySelector('#result .result-actions button').click();`);
    await until(() => evaluate(`return window.game.state === 'playing';`), 'trial begins for rotation check');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.__emitToyContainer({ ...window.__toyContainer, viewport: { width: 390, height: 844 }, orientation: 'portrait', immersive: false });`);
    await until(() => evaluate(`return !!document.querySelector('#rotate-hint button:not(:disabled)') && window.game.state === 'paused';`), 'portrait detection pauses battle');
    check('portrait automatically blocks play and pauses battle', await evaluate(`return document.querySelector('#rotate-hint').textContent.includes('切换横屏') && window.__toyCalls.modes.length === 0 && document.querySelector('#game-content').inert;`));
    check('the portrait prompt covers the entire viewport and intercepts every corner', await evaluate(`
      const box = document.querySelector('#rotate-hint').getBoundingClientRect();
      return box.x === 0 && box.y === 0 && box.width === innerWidth && box.height === innerHeight
        && [[1,1],[innerWidth-1,1],[1,innerHeight-1],[innerWidth-1,innerHeight-1]].every(([x,y]) => document.elementFromPoint(x,y).closest('#rotate-hint'));
    `));
    await capture('toy-portrait-rotate');
    await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate(`
      const { trialLeaderboard } = await import('/src/platform/trialLeaderboard.ts');
      const { hud } = await import('/src/game/hud.ts');
      trialLeaderboard.state.entries = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, score: 50 - i, nickname: '试炼玩家 ' + (i + 1), avatar: '' }));
      trialLeaderboard.state.loaded = true; hud.rankingOpen = true;
    `);
    await until(() => evaluate('return !!document.querySelector("#trial-leaderboard");'), 'ranking beside rotation hint');
    await evaluate(`window.__blockedTime = window.game.time; window.__blockedGod = window.game.god;`);
    await click('[aria-label="关闭排行榜"]');
    for (const code of ['Escape', 'F8', 'Backquote', 'Digit1', 'KeyW']) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code });
    }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Tab', key: 'Tab' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab' });
    check('pointer clicks, Escape, shortcuts and Tab cannot reach the blocked game or ranking', await evaluate(`
      const { hud } = await import('/src/game/hud.ts');
      return hud.rankingOpen && !hud.jumpOpen && window.game.god === window.__blockedGod
        && window.game.time === window.__blockedTime && window.game.state === 'paused'
        && !!document.activeElement.closest('#rotate-hint');
    `));
    await evaluate(`
      window.__originalGetGamepads = navigator.getGamepads;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, axes: [0,0,0,0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: [1,2,9].includes(i) })) }] });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    `);
    check('gamepad back and pause cannot bypass the gate', await evaluate(`const { hud } = await import('/src/game/hud.ts'); return hud.rankingOpen && window.game.time === window.__blockedTime && window.game.state === 'paused';`));
    await evaluate(`Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: window.__originalGetGamepads });`);
    await capture('toy-ranking-with-rotate-hint');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await click('#rotate-hint button');
    await until(() => evaluate('return window.__toyCalls.modes.length === 1;'), 'native rotation request');
    check('native rotation requests landscape plus immersion and waits after promise resolution', await evaluate(`const request = window.__toyCalls.modes[0]; return request.orientation === 'landscape' && request.immersive === true && document.querySelector('#rotate-hint button').disabled;`));
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.__emitToyContainer({ ...window.__toyContainer, orientation: 'landscape', immersive: false, viewport: { width: 844, height: 390 }, changedFields: ['orientation', 'viewport'] });`);
    await until(() => evaluate('return !document.querySelector("#rotate-hint");'), 'landscape viewport unlocks without immersion');
    check('landscape without immersion or browser fullscreen is playable', await evaluate('return !document.fullscreenElement && !document.querySelector("#game-content").inert;'));
    await evaluate(`window.__emitToyContainer({ ...window.__toyContainer, orientation: 'landscape', immersive: true, viewport: { width: 844, height: 390 }, changedFields: ['orientation', 'viewport', 'immersive'] });`);
    await until(() => evaluate('return !document.querySelector("#rotate-hint");'), 'landscape confirmation hides button');
    check('confirmed landscape hides the hint while battle remains paused', await evaluate(`return window.game.state === 'paused';`));
    await click('[aria-label="关闭排行榜"]');
    await capture('toy-landscape-confirmed');
    await evaluate(`window.__emitToyContainer({ ...window.__toyContainer, immersive: false, changedFields: ['immersive'] });`);
    check('leaving native immersion keeps landscape playable', await evaluate('return !document.querySelector("#rotate-hint") && !document.querySelector("#game-content").inert;'));

    await evaluate(`sessionStorage.setItem('toy-container-unsupported', '1');`);
    await send('Page.reload');
    await until(() => evaluate('return !!window.engine && !document.querySelector("#loading");'), 'browser fallback game starts');
    check('standalone landscape needs no fullscreen support', await evaluate('return !document.querySelector("#rotate-hint") && !document.fullscreenElement;'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('return !!document.querySelector("#rotate-hint button:not(:disabled)");'), 'browser fallback button');
    await evaluate(`
      window.__fullscreenCalls = 0;
      window.__originalRequestFullscreen = document.documentElement.requestFullscreen;
      screen.orientation.lock = async () => {};
      document.documentElement.requestFullscreen = async () => { window.__fullscreenCalls++; throw new DOMException('Fullscreen denied by test', 'NotAllowedError'); };
      document.querySelector('#rotate-hint button').click();
    `);
    await until(() => evaluate(`return document.querySelector('#rotate-hint')?.textContent.includes('手动旋转');`), 'unsupported browser hint');
    check('a rejected auto-rotation offers manual rotation while portrait stays blocked', await evaluate(`return window.__fullscreenCalls === 1 && window.__toyCalls.modes.length === 0 && !document.querySelector('#rotate-hint button').disabled && document.querySelector('#game-content').inert;`));
    await capture('toy-rotation-failed');
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('return !document.querySelector("#rotate-hint");'), 'manual resize after failed fullscreen');
    check('manual landscape unlocks even after fullscreen was denied', await evaluate('return !document.fullscreenElement && !document.querySelector("#game-content").inert && window.__fullscreenCalls === 1;'));
    await evaluate(`document.documentElement.requestFullscreen = window.__originalRequestFullscreen;`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('return !!document.querySelector("#rotate-hint button:not(:disabled)");'), 'portrait before browser rotation retry');
    await click('#rotate-hint button');
    await until(() => evaluate('return !!document.fullscreenElement;'), 'browser fullscreen for rotation');
    check('portrait remains blocked even in browser fullscreen', await evaluate('return !!document.fullscreenElement && document.querySelector("#game-content").inert;'));
    await capture('toy-portrait-browser-fallback');
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('return !document.querySelector("#rotate-hint");'), 'landscape after browser rotation');
    await evaluate('await document.exitFullscreen();');
    check('exiting browser fullscreen does not block an already-landscape game', await evaluate('return !document.fullscreenElement && !document.querySelector("#rotate-hint") && !document.querySelector("#game-content").inert;'));
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}
