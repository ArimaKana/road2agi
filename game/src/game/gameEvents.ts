// The contract between the rules and their presentation. Spatial events always carry a position.
import type { CardId } from './cards';
import type { BlastShape, EnemyKind } from './enemies';
import type { TrapPlan } from './level';
import type { Reward } from './rewards';
import type { Area } from './room';
import type { ShopItem, Vec2 } from './simulation';

type Empty = 'bossClear' | 'won' | 'lost' | 'doorOpen' | 'shopClosed' | 'storyDone' | 'ultAvatar' | 'ultAvatarOut' | 'ultDenied' | 'tokenDenied' | 'roomLeave';
type Positioned = 'echoSummon' | 'phantomSplit' | 'thiefLand' | 'furnaceHeat' | 'weaverLink' | 'decoyHit' | 'dashStolen' | 'mineFuse' | 'bossAdds' | 'bossRush' | 'bossMirrors' | 'bossMirrorSplit' | 'iconChains' | 'chainExposed' | 'iconBroken' | 'rally' | 'qwenOn' | 'kimiPrism' | 'decoyDrop' | 'gptReset' | 'geminiStart' | 'trainClear' | 'trainWall' | 'geminiEnd' | 'decoyEnd' | 'kimiEnd' | 'beacon' | 'claudeExecute' | 'phantomBreak' | 'iconFreed' | 'ultStart' | 'chargeStart' | 'chargeFull' | 'trapWarn';
type Identified = 'shieldBreak' | 'bossExpose' | 'bossStagger' | 'grokCharm' | 'armorBroken' | 'shieldBlock' | 'allyEnd' | 'charmEnd';
type Radial = 'glmPulse' | 'claudeForced' | 'decoyShock' | 'trainBlast' | 'ultConfirm' | 'ultPunch' | 'ultShock';
type Directed = 'trainStart' | 'trainHit' | 'trainEnd';

export type GameEventData = Record<Empty, Record<never, never>> & Record<Positioned, Vec2> & Record<Identified, Vec2 & { id: number }> & Record<Radial, Vec2 & { radius: number }> & Record<Directed, Vec2 & { dir: Vec2 }> & {
  roomEnter: { id: string; name: string; level: string; trialRoom?: number };
  unlock: { fresh: CardId[] };
  reward: { options: Reward[] };
  rewardTaken: Reward & Vec2;
  shop: { items: ShopItem[] };
  shopBuy: { name: string };
  modGained: { name: string };
  wave: { wave: number; spawns: (Vec2 & { boss: boolean; kind: EnemyKind })[] };
  cardDenied: { slot: number; reason: string };
  summonStart: Vec2 & { id: CardId };
  summonConfirm: Vec2 & { id: CardId; slot: number; aim: Vec2 };
  enemyAttack: Vec2 & { radius: number; allied: boolean; fake?: boolean; boss?: boolean; dir?: Vec2; shape?: BlastShape; length?: number };
  hit: Vec2 & { id: number; damage: number; kind: string; tier: number; boss: boolean; dirX: number; dirZ: number };
  kill: Vec2 & { id: number; boss: boolean; real: boolean; kind: string; dirX: number; dirZ: number };
  hurt: Vec2 & { damage: number };
  strike: Vec2 & { aim: Vec2; range: number; width: number; shake: number; kind: string | null; index: number; tier: number; hits: number };
  attack: Vec2 & { aim: Vec2; kind: string; index: number };
  ultFist: Vec2 & { flight: number };
  prep: { next: string };
  qwenOff: Vec2 & { refund: number };
  dash: Vec2 & { aim: Vec2 };
  pad: Vec2 & { text: string };
  story: { id: string };
  trapFire: Vec2 & { kind: TrapPlan['kind']; area: Area; feed: Area | null; dir: Vec2 };
  trapStab: Vec2 & { kind: TrapPlan['kind']; dirX: number; dirZ: number };
  mineBurst: Vec2 & { radius: number; friendly: boolean };
  bossPhase: Vec2 & { id: number; stage: number; kind: EnemyKind };
  iconCounter: Vec2 & { kind: string; name: string; safeX: number; safeZ: number; safeRadius: number };
  chainCut: Vec2 & { left: number };
  glmThread: Vec2 & { id: number; toX: number; toZ: number };
  seedHeal: Vec2 & { amount: number };
  claudeMark: Vec2 & { id: number; delay: number };
  grokWave: Vec2 & { aim: Vec2; radius: number; half: number };
  kimiBolt: Vec2 & { toX: number; toZ: number; index: number };
  combo: { key: string };
  claudeStrike: Vec2 & { unbound: boolean; splash: number };
  geminiDash: Vec2 & { toX: number; toZ: number };
};

export type EventOf<K extends keyof GameEventData> = { [P in K]: { type: P } & GameEventData[P] }[K];
export type GameEvent = EventOf<keyof GameEventData>;
export type GameEventArgs = { [K in keyof GameEventData]: K extends Empty ? [type: K] : [type: K, data: GameEventData[K]] }[keyof GameEventData];
