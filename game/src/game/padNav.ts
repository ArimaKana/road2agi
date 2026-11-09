// While a screen of buttons is up a gamepad walks them: the stick or the d-pad steps to the nearest button that way, A presses it and B backs out.
const LAYERS = ['#rotate-hint', '#loading', '#trial-leaderboard', '#room-jump', '#dialog', '#reward', '#shop', '#prep', '#result', '#menu-settings', '#home', '.menu:not(.hidden)'];
const REPEAT = 220, THRESHOLD = .5;
const WAYS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const middle = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

export class PadNav {
  private focus: HTMLElement | null = null;
  private held = '';
  private nextStep = 0;
  private pressed = { a: false, b: false };

  private top() {
    for (const selector of LAYERS) { const root = document.querySelector<HTMLElement>(selector); if (root) return root; }
    return null;
  }
  private show(el: HTMLElement | null) {
    this.focus?.classList.remove('pad-focus');
    this.focus = el;
    if (el) { el.classList.add('pad-focus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  // Takes the nearest button in that direction, counting one off to the side as further away than one straight ahead.
  private step(buttons: HTMLElement[], way: [number, number]) {
    if (!this.focus) { this.show(buttons[0]); return; }
    const from = middle(this.focus);
    let best: HTMLElement | null = null, score = Infinity;
    for (const el of buttons) {
      if (el === this.focus) continue;
      const to = middle(el), x = to.x - from.x, y = to.y - from.y, along = x * way[0] + y * way[1], across = Math.abs(x * way[1]) + Math.abs(y * way[0]);
      if (along <= 1) continue;
      const s = along + across * 2;
      if (s < score) { score = s; best = el; }
    }
    if (best) this.show(best);
  }
  update(now: number, back: () => void) {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
    if (!pad) return;
    const root = this.top(), buttons = root ? [...root.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(el => el.offsetParent !== null) : [];
    if (this.focus && !buttons.includes(this.focus)) this.show(null);
    const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
    const way = pad.buttons[12]?.pressed || y < -THRESHOLD ? 'up' : pad.buttons[13]?.pressed || y > THRESHOLD ? 'down' : pad.buttons[14]?.pressed || x < -THRESHOLD ? 'left' : pad.buttons[15]?.pressed || x > THRESHOLD ? 'right' : '';
    if (way && (way !== this.held || now >= this.nextStep) && buttons.length) { this.step(buttons, WAYS[way]); this.nextStep = now + REPEAT; }
    this.held = way;
    const a = !!pad.buttons[0]?.pressed, b = !!pad.buttons[1]?.pressed;
    if (a && !this.pressed.a) {
      if (this.focus) this.focus.click();
      else if (buttons.length) this.show(buttons[0]);
      else root?.click(); // A line of a dialog has nothing to press but itself.
    }
    if (b && !this.pressed.b) back();
    this.pressed = { a, b };
  }
  // While a binding waits for its button, that press belongs to it: nothing counts until both are let go.
  wait() { this.pressed = { a: true, b: true }; }
  // Off the screens, so nothing stays lit and the buttons start fresh next time.
  clear() { this.show(null); this.pressed = { a: true, b: true }; }
}
