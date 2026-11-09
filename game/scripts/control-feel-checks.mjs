// Browser coverage for DOM input, held attacks and the rendered targeting hint.
export async function runControlFeelChecks({ send, evaluate, until, check, capture, backend }) {
  await evaluate(`
    window.__feelFeedback = window.engine.feedback;
    window.__feelEvents = [];
    window.engine.feedback = function(e) { window.__feelEvents.push(e); window.__feelFeedback.call(this, e); };
    window.__feelSetup = () => {
      const g = window.game, h = g.hero;
      g.state = 'playing'; g.hitstop = g.slowmo = g.leaving = 0; g.cleared = false;
      g.room.walls.fill(0); g.traps = []; g.rings = []; g.shots = []; g.blasts = []; g.mines = [];
      Object.assign(h, { x: 0, z: 0, vx: 0, vz: 0, attack: null, summon: null, charge: null, dash: 0, ult: false,
        combo: null, comboTimer: 0, buffer: null, bufferTime: 0, dashBuffer: 0, ultBuffer: 0, cardBufferTime: 0,
        attackHeld: false, holdTime: 0, holdDenied: false, lockId: null, token: 100, zeroCharges: 0, moving: false });
      g.enemies = [g.newEnemy({ x: 30, z: 30, hp: 1000, maxHp: 1000, speed: 0, cooldown: 1000 })];
      window.engine.input.clear(); window.engine.input.mouse.active = false; window.engine.loop.reset();
      window.__feelEvents = [];
    };
    window.__feelSetup();
  `);
  try {
    // Both events arrive in the same JS task, before any animation frame can sample them.
    await evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j' }));
    `);
    await until(() => evaluate("return window.__feelEvents.some(e => e.type === 'attack');"), 'sub-frame attack reaches combat');
    await until(() => evaluate('return !window.game.hero.attack;'), 'quick attack finishes');
    check(`${backend}: a DOM tap between renders attacks once without charging`, await evaluate(`
      return window.__feelEvents.filter(e => e.type === 'attack').length === 1
        && !window.__feelEvents.some(e => e.type === 'chargeStart') && !window.game.hero.attackHeld;
    `));

    await evaluate('window.__feelSetup();');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
    await until(() => evaluate("return window.__feelEvents.filter(e => e.type === 'attack' && e.kind === 'charge').length >= 2;"), 'held attack releases twice');
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
    await until(() => evaluate('return !window.game.hero.attack && window.game.hero.charge === null;'), 'held attack stops on release');
    check(`${backend}: holding repeats charged attacks and releasing stops`, await evaluate(`
      return window.__feelEvents.filter(e => e.type === 'attack' && e.kind === 'charge').length >= 2 && !window.game.hero.attackHeld;
    `));

    await evaluate(`
      window.__feelSetup(); const g = window.game;
      g.enemies = [g.newEnemy({ x: 6.5, z: 0, hp: 1000, maxHp: 1000, speed: 0, cooldown: 1000 }),
        g.newEnemy({ x: 2, z: .7, hp: 1000, maxHp: 1000, speed: 0, cooldown: 1000 })];
    `);
    await until(() => evaluate('return window.engine.follow.length() < .02;'), 'camera settles for cursor aiming');
    const point = await evaluate(`
      const e = window.game.enemies[0], p = window.engine.aimPoint.clone().set(e.x, .6, e.z).project(window.engine.camera);
      return { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight };
    `);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    try {
      await until(() => evaluate('return window.game.hero.lockId === window.game.enemies[0].id;'), 'cursor target remains selected');
    } catch (error) {
      await capture(`${backend}-target-cursor-failure`);
      const state = await evaluate(`const g = window.game; return { state: g.state, hero: { x: g.hero.x, z: g.hero.z, aim: g.hero.aim, lockId: g.hero.lockId, action: g.hero.action }, mouse: window.engine.input.mouse, enemies: g.enemies.map(e => ({ id: e.id, x: e.x, z: e.z, hp: e.hp, arrive: e.arrive })) };`);
      throw new Error(`${error.message}: ${JSON.stringify({ point, ...state })}`);
    }
    check(`${backend}: a closer enemy cannot steal the mouse target`, await evaluate('return Math.abs(window.game.hero.aim.z) < .001 && window.game.hero.aim.x > .99;'));
    await until(() => evaluate('return document.querySelector(".target-hint")?.textContent === "靠近目标";'), 'distant target range hint');
    check(`${backend}: selection outside melee range is visibly distinguished`, await evaluate('return !document.querySelector(".target-hint").classList.contains("in-range") && window.engine.lockMark.material.opacity < .5;'));
    await capture(`${backend}-target-far`);

    await evaluate('window.game.enemies.length = 1; window.game.enemies[0].x = 3; window.engine.input.mouse.active = false;');
    await until(() => evaluate('return document.querySelector(".target-hint.in-range")?.textContent === "范围内";'), 'near target range hint');
    check(`${backend}: target inside melee range has a bright mark`, await evaluate('return window.engine.lockMark.material.opacity > .8;'));
    await capture(`${backend}-target-near`);
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('return window.engine.canvas.width === 844 && !!document.querySelector(".target-hint");'), 'landscape target hint layout');
    check(`${backend}: range hint fits mobile landscape and does not intercept touches`, await evaluate(`
      const el = document.querySelector('.target-hint'), r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && getComputedStyle(el).pointerEvents === 'none';
    `));
    await capture(`${backend}-target-landscape`);
  } finally {
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyJ', key: 'j', windowsVirtualKeyCode: 74 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await evaluate('window.engine.feedback = window.__feelFeedback; window.engine.input.clear(); window.engine.input.mouse.active = false; delete window.__feelFeedback; delete window.__feelSetup; delete window.__feelEvents;');
  }
}
