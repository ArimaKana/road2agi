// What a region needs in memory besides what every region shares, so a run only downloads what it is about to meet.
import { artOf, type EnemyKind } from './enemies.ts';
import type { Level } from './level.ts';

// Who else turns up in a fight with these: what they call in, and the false images that borrow a picture.
const BROUGHT: Partial<Record<EnemyKind, EnemyKind[]>> = { b01: ['e01'], b02: ['b02fake'], b03: ['e11'], e04: ['echo'], e05: ['phantom'] };
export function regionArt(level: Level) {
  const kinds = level.rooms.flatMap(room => room.waves.flatMap(wave => wave.units ?? []));
  return [...new Set(['e01', ...kinds.flatMap(kind => [kind, ...(BROUGHT[kind] ?? [])]).map(artOf)])];
}
