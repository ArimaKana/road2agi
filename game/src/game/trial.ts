// The rooms of the endless trial. They come in tens, each ten from one region: fights, a supply room at the fifth, and that region's boss at the tenth. After the last region it goes round again.
import type { Level } from './level';

const ACT = 10, SUPPLY = 5;

export function trialRoom(levels: Level[], number: number, last: string, random = Math.random) {
  const act = Math.floor((number - 1) / ACT) % levels.length;
  const rooms = levels.flatMap((level, region) => level.rooms.map((room, index) => ({ room, region, index })));
  const here = rooms.filter(r => r.region === act), kinds = (list: typeof rooms, ...wanted: string[]) => list.filter(r => wanted.includes(r.room.kind));
  const boss = kinds(here, 'boss', 'finale')[0];
  if (number % ACT === 0 && boss) return boss;
  // A region with no fights or supplies of its own, like the last, borrows from all the others.
  const supplies = kinds(rooms, 'shop');
  if (number % SUPPLY === 0 && supplies.length) return kinds(here, 'shop')[0] ?? supplies[act % supplies.length];
  const own = kinds(here, 'battle'), fights = (own.length ? own : kinds(rooms, 'battle')).filter(r => r.room.id !== last);
  return fights[Math.floor(random() * fights.length)];
}
