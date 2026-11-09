import { screenToWorld, type GameInput, type Vec2 } from './simulation';
import { defaultBindings, setPadStyle, type Action, type Bindings } from './saves';

const RESERVED_KEYS = new Set(['Escape', 'Backquote', 'F8', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Keyboard and mouse, the standard gamepad and the on-screen controls, all boiled down to one GameInput per frame.
export class Input {
  keys = new Set<string>();
  mouse = { x: 0, y: 0, active: false };
  stick = { x: 0, y: 0 };
  touchAim: Vec2 | null = null;
  attackHeld = false;
  dashPressed = false;
  ultPressed = false;
  interactPressed = false;
  cardPressed = -1;
  cardAim: Vec2 | null = null;
  padPrevious: { dash?: boolean; pause?: boolean; ult?: boolean; interact?: boolean; cards?: boolean[]; all?: boolean[] } = {};
  onPause: (force?: boolean) => void;
  binds: Bindings = defaultBindings();
  // Which hands are on the game right now, for what the screen calls the buttons.
  device: 'keys' | 'pad' | 'touch' = 'keys';
  // With a screen of buttons up the gamepad belongs to them, not to the fight.
  modal = false;
  // Numbered choices belong to the visible panel; combat otherwise uses the player's bindings.
  choiceCount = 0;
  // Waiting for the next key or button, to bind it. Esc calls it off.
  capture: 'keys' | 'pad' | null = null;
  onCapture: ((code: string | number | null) => void) | null = null;
  notify: (text: string) => void = () => {};
  onReconnect: () => void = () => {};
  private padGone = false;
  private padAttack = false;
  private lastAttack = false;
  private attackEdges: boolean[] = [];
  private activate: () => void;

  constructor(canvas: HTMLElement, onPause: (force?: boolean) => void, onActivate: () => void, onJump: () => void, onGod: () => void) {
    this.onPause = onPause; this.activate = onActivate;
    const consume = (e: KeyboardEvent) => ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
    // The device that attacks decides the aiming: J drops the mouse aim for the soft lock until the mouse moves or clicks again.
    window.addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); if (e.code === 'Escape') this.captured(null); else if (this.capture === 'keys' && !e.repeat) this.captured(e.code); return; }
      if (consume(e)) e.preventDefault();
      this.device = 'keys';
      if (e.code === 'Escape' && !e.repeat) onPause();
      if ((e.code === 'Backquote' || e.key === '`') && !e.repeat) onJump();
      if (e.code === 'F8' && !e.repeat) onGod();
      this.keys.add(e.code);
      const choice = /^Digit[1-9]$/.test(e.code) ? Number(e.code[5]) - 1 : -1;
      if (choice >= 0 && choice < this.choiceCount) { if (!e.repeat) this.cardPressed = choice; onActivate(); return; }
      const k = this.binds.keys, card = [k.card1, k.card2, k.card3].indexOf(e.code);
      if (e.code === k.dash && !e.repeat) this.dashPressed = true;
      if (e.code === k.ult && !e.repeat) this.ultPressed = true;
      if (e.code === k.interact && !e.repeat) this.interactPressed = true;
      if (card >= 0 && !e.repeat) this.cardPressed = card;
      if (e.code === k.attack) { this.mouse.active = false; this.recordAttack(); }
      onActivate();
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); this.recordAttack(); });
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && (e.movementX || e.movementY || e.clientX !== this.mouse.x || e.clientY !== this.mouse.y)) { this.device = 'keys'; this.mouse = { x: e.clientX, y: e.clientY, active: true }; } });
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { this.attackHeld = true; this.recordAttack(); this.mouse = { x: e.clientX, y: e.clientY, active: true }; canvas.focus(); onActivate(); } });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) { this.attackHeld = false; this.recordAttack(); } });
    window.addEventListener('blur', () => { this.clear(); onPause(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); onPause(true); } });
    window.addEventListener('gamepaddisconnected', () => { this.padPrevious = {}; this.padGone = true; this.clear(); onPause(true); this.notify('手柄已断开'); });
    window.addEventListener('gamepadconnected', e => { setPadStyle((e as GamepadEvent).gamepad?.id ?? ''); this.notify(this.padGone ? '手柄已连接，按任意键继续' : '手柄已连接'); });
    window.addEventListener('pointerdown', e => { onActivate(); if (e.pointerType === 'touch') { this.device = 'touch'; document.body.classList.add('touch'); this.mouse.active = false; } }, { passive: true });
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    this.bindStick();
    this.bindCombat(onActivate);
    this.bindCards(onActivate);
  }
  // Whatever is already held down, like the button that asked for this, is not the answer.
  startCapture(device: 'keys' | 'pad', done: (code: string | number | null) => void) {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
    if (pad) this.padPrevious.all = pad.buttons.map(b => b.pressed);
    this.capture = device; this.onCapture = done;
  }
  captured(code: string | number | null) {
    if ((this.capture === 'keys' && typeof code === 'string' && RESERVED_KEYS.has(code)) || (this.capture === 'pad' && code === 9)) {
      this.notify('这个按键已用于固定操作，请选择其他按键'); return;
    }
    const done = this.onCapture; this.capture = null; this.onCapture = null; done?.(code);
  }
  clear() {
    this.padAttack = this.lastAttack = false; this.attackEdges.length = 0;
    this.keys.clear(); this.attackHeld = false; this.dashPressed = false; this.ultPressed = false; this.interactPressed = false; this.cardPressed = -1; this.cardAim = null; this.stick = { x: 0, y: 0 }; this.touchAim = null;
    const knob = document.querySelector<HTMLElement>('.stick-knob'); if (knob) knob.style.transform = '';
  }
  // DOM presses can begin and end between renders. Keep both edges, but do not
  // invent a release while another input source is still holding the attack.
  private recordAttack() {
    const held = this.attackHeld || this.keys.has(this.binds.keys.attack) || this.padAttack;
    if (held !== this.lastAttack) { this.lastAttack = held; this.attackEdges.push(held); }
  }
  bindStick() {
    const el = document.querySelector<HTMLElement>('#move-stick')!, knob = el.querySelector<HTMLElement>('.stick-knob')!;
    let id: number | null = null;
    const update = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      let x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
      const max = b.width * .32, d = Math.hypot(x, y);
      if (d > max) { x *= max / d; y *= max / d; }
      this.stick = { x: x / max, y: y / max }; knob.style.transform = `translate(${x}px,${y}px)`;
    };
    el.addEventListener('pointerdown', e => { if (id !== null) return; id = e.pointerId; el.setPointerCapture(id); this.mouse.active = false; update(e); e.preventDefault(); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) update(e); });
    const stop = (e: PointerEvent) => { if (e.pointerId === id) { id = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('lostpointercapture', stop);
  }
  bindCombat(onActivate: () => void) {
    const button = document.querySelector<HTMLElement>('#attack-button')!;
    let id: number | null = null, origin = { x: 0, y: 0 };
    button.addEventListener('pointerdown', e => { if (id !== null) return; id = e.pointerId; origin = { x: e.clientX, y: e.clientY }; button.setPointerCapture(id); this.attackHeld = true; this.recordAttack(); this.mouse.active = false; this.touchAim = null; onActivate(); e.preventDefault(); });
    button.addEventListener('pointermove', e => { if (e.pointerId !== id) return; const x = e.clientX - origin.x, y = e.clientY - origin.y; this.touchAim = Math.hypot(x, y) > 14 ? screenToWorld(x, y) : null; });
    const stop = (e: PointerEvent) => { if (e.pointerId === id) { id = null; this.attackHeld = false; this.recordAttack(); this.touchAim = null; } };
    button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
    document.querySelector('#dash-button')!.addEventListener('pointerdown', e => { this.dashPressed = true; onActivate(); e.preventDefault(); });
    document.querySelector('#ult-button')!.addEventListener('pointerdown', e => { this.ultPressed = true; onActivate(); e.preventDefault(); });
  }
  // A click/tap uses the soft lock, never the mouse position over the HUD.
  // Dragging works with mouse and touch; returning to the card cancels the cast.
  bindCards(onActivate: () => void) {
    const row = document.querySelector<HTMLElement>('#card-row')!;
    let id: number | null = null, slot = -1, origin = { x: 0, y: 0 }, dragged = false;
    row.addEventListener('pointerdown', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!card || id !== null) return;
      id = e.pointerId; slot = Number(card.dataset.slot); origin = { x: e.clientX, y: e.clientY }; dragged = false; this.touchAim = null; row.setPointerCapture(id); onActivate(); e.preventDefault();
    });
    row.addEventListener('pointermove', e => { if (e.pointerId !== id) return; const x = e.clientX - origin.x, y = e.clientY - origin.y, off = Math.hypot(x, y) > 14; dragged ||= off; this.touchAim = off ? screenToWorld(x, y) : null; });
    row.addEventListener('pointerup', e => {
      if (e.pointerId !== id) return;
      // Having left the spot it started on, coming back to the card is a change of mind, right down to the very spot.
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]'), called = dragged && over && Number(over.dataset.slot) === slot;
      if (!called) { this.cardPressed = slot; this.cardAim = this.touchAim ?? { x: 0, z: 0 }; }
      id = null; this.touchAim = null;
    });
    const cancel = (e: PointerEvent) => { if (e.pointerId === id) { id = null; this.touchAim = null; } };
    row.addEventListener('pointercancel', cancel); row.addEventListener('lostpointercapture', cancel);
  }
  sample(mouseAim: Vec2 | null, mouseTargetId?: number): GameInput {
    const k = this.binds.keys;
    let sx = (this.keys.has(k.right) || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has(k.left) || this.keys.has('ArrowLeft') ? 1 : 0) + this.stick.x;
    let sy = (this.keys.has(k.down) || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has(k.up) || this.keys.has('ArrowUp') ? 1 : 0) + this.stick.y;
    let aim = this.cardAim || this.touchAim || (this.mouse.active ? mouseAim : null), attack = this.attackHeld || this.keys.has(k.attack), dash = this.dashPressed, ult = this.ultPressed, card = this.cardPressed;
    let aimTargetId = this.mouse.active && !this.cardAim && !this.touchAim ? mouseTargetId : undefined;
    let interact = this.interactPressed; this.interactPressed = false; this.dashPressed = false; this.ultPressed = false; this.cardPressed = -1; this.cardAim = null;
    const pads = navigator.getGamepads?.() || [], pad = Array.from(pads).find(p => p?.connected);
    this.padAttack = false;
    if (pad) {
      const dead = (v: number) => Math.abs(v) > .18 ? v : 0;
      const px = dead(pad.axes[0] || 0), py = dead(pad.axes[1] || 0), ax = dead(pad.axes[2] || 0), ay = dead(pad.axes[3] || 0);
      const down = (action: Action) => { const button = this.binds.pad[action]; return button !== undefined && !!pad.buttons[button]?.pressed; };
      const pa = down('attack'), pd = down('dash'), pp = !!pad.buttons[9]?.pressed, pu = down('ult'), pi = down('interact'), pc = (['card1', 'card2', 'card3'] as Action[]).map(down), all = pad.buttons.map(b => b.pressed);
      if (this.capture === 'pad') { const fresh = all.findIndex((held, i) => held && !this.padPrevious.all?.[i]); if (fresh >= 0) this.captured(fresh); }
      if (px || py || ax || ay || all.includes(true)) { this.device = 'pad'; this.mouse.active = false; this.activate(); }
      if (this.padGone && all.includes(true)) { this.padGone = false; this.onReconnect(); }
      // On a screen of buttons the left stick walks them, which leaves the right one for moving the pause map.
      if (this.modal && (ax || ay)) { sx = ax; sy = ay; }
      if (!this.modal) {
        if (px || py || ax || ay || pa || pd || pu || pc.includes(true)) { sx = px; sy = py; aim = ax || ay ? screenToWorld(ax, ay) : null; aimTargetId = undefined; }
        this.padAttack = pa; attack ||= pa; dash ||= pd && !this.padPrevious.dash; ult ||= pu && !this.padPrevious.ult;
        pc.forEach((held, i) => { if (held && !this.padPrevious.cards?.[i]) card = i; });
        if (pi && !this.padPrevious.interact) interact = true;
      }
      if (pp && !this.padPrevious.pause && !this.capture) this.onPause();
      this.padPrevious = { dash: pd, pause: pp, ult: pu, interact: pi, cards: pc, all };
    }
    this.recordAttack();
    const move = screenToWorld(sx, sy);
    return { moveX: move.x, moveZ: move.z, aimX: aim?.x || 0, aimZ: aim?.z || 0, aimTargetId, attack, attackEdges: this.attackEdges.splice(0), dash, ult, card, interact };
  }
}
