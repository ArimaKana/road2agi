import type { Game, GameEvent, GameInput } from './simulation';

export const FIXED_STEP = 1 / 60;
// Catch up ordinary slow frames, but never replay a long suspension in one frame.
const MAX_STEPS = 12;
export const MAX_FRAME_TIME = MAX_STEPS * FIXED_STEP;
const EPSILON = 1e-9;

export class GameLoop {
  private game: Game;
  private accumulated = 0;
  private pending: GameInput = {};
  private attackHeld = false;
  private attackEdges: boolean[] = [];
  constructor(game: Game) { this.game = game; }

  reset() { this.accumulated = 0; this.pending = {}; this.attackHeld = false; this.attackEdges.length = 0; }

  advance(elapsed: number, input: GameInput, feedback: (event: GameEvent) => void) {
    const game = this.game; game.events = [];
    if (game.state !== 'playing') { this.reset(); return; }
    this.accumulated += Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, MAX_FRAME_TIME)) : 0;
    this.pending.dash ||= !!input.dash; this.pending.ult ||= !!input.ult; this.pending.interact ||= !!input.interact;
    // Touch-card aiming exists only on the release frame, so keep it with the press.
    if (input.card !== undefined && input.card >= 0) {
      this.pending.card = input.card; this.pending.aimX = input.aimX ?? 0; this.pending.aimZ = input.aimZ ?? 0;
      this.pending.aimTargetId = input.aimTargetId;
    }
    // Preserve DOM edges that happened between renders as well as samples that
    // happened between fixed steps. Reconcile the held state without doubling a press.
    for (const held of input.attackEdges ?? []) {
      if (held !== this.attackHeld) { this.attackHeld = held; this.attackEdges.push(held); }
    }
    if (!!input.attack !== this.attackHeld) { this.attackHeld = !!input.attack; this.attackEdges.push(this.attackHeld); }
    for (let steps = 0; steps < MAX_STEPS && this.accumulated + EPSILON >= FIXED_STEP; steps++) {
      this.accumulated = Math.max(0, this.accumulated - FIXED_STEP);
      const sampled = { ...input, dash: false, ult: false, interact: false, card: -1, ...this.pending, attack: this.attackEdges.shift() ?? this.attackHeld };
      this.pending = {};
      game.update(FIXED_STEP, sampled);
      for (const event of game.events) feedback(event);
      // A reward, dialog or death may stop the fight midway through catching up.
      if (game.state !== 'playing') { this.reset(); break; }
    }
  }
}
