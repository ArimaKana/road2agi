// What outlives the page besides the album: three save slots, the settings and the furthest trial room. A browser with no storage simply has none of them.
import type { RunSnapshot } from './simulation';
import { isRunSnapshot } from './runSnapshot';
import { readStored, writeStored } from './storage';

export const SAVE_SLOTS = 3;
export interface SaveData { slot: number; savedAt: number; roomId: string; roomName: string; levelName: string; run: RunSnapshot }
export interface Settings { sound: boolean; music: boolean; shake: boolean; numbers: boolean; flash: boolean; touchOn: boolean; touchSize: number; touchAlpha: number; stickShift: number }
export const DEFAULT_SETTINGS: Settings = { sound: true, music: true, shake: true, numbers: true, flash: true, touchOn: false, touchSize: 1, touchAlpha: .85, stickShift: 0 };
export const SOUND_OPTIONS = [
  { mode: 'all', label: '全部开启' },
  { mode: 'effects', label: '关闭 BGM' },
  { mode: 'muted', label: '关闭所有声音' },
] as const;
export type SoundMode = typeof SOUND_OPTIONS[number]['mode'];
export const soundMode = (settings: Pick<Settings, 'sound' | 'music'>): SoundMode => !settings.sound ? 'muted' : settings.music ? 'all' : 'effects';
export type SettingToggle = 'shake' | 'numbers' | 'flash' | 'touchOn';
export type SettingCycle = 'touchSize' | 'touchAlpha' | 'stickShift';
export const SETTING_STEPS: Record<SettingCycle, number[]> = { touchSize: [.85, 1, 1.2], touchAlpha: [.5, .7, .85, 1], stickShift: [0, 40, 80] };
export type SettingCommand = { kind: 'sound'; mode: SoundMode } | { kind: 'toggle'; key: SettingToggle } | { kind: 'cycle'; key: SettingCycle } | { kind: 'rebind'; device: 'keys' | 'pad'; action: Action } | { kind: 'reset' };

// What each action is on the keyboard and the gamepad. The stick and the arrow keys always move, and the left mouse button always attacks.
export const ACTION_NAMES = { up: '上', down: '下', left: '左', right: '右', attack: '刺击', dash: '滑步', ult: '法天象地', interact: '交互', card1: '召唤卡 1', card2: '召唤卡 2', card3: '召唤卡 3' };
export type Action = keyof typeof ACTION_NAMES;
export interface Bindings { keys: Record<Action, string>; pad: Partial<Record<Action, number>> }
export const DEFAULT_BINDINGS: Bindings = {
  keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', attack: 'KeyJ', dash: 'Space', ult: 'KeyF', interact: 'KeyE', card1: 'Digit1', card2: 'Digit2', card3: 'Digit3' },
  pad: { attack: 5, dash: 4, ult: 12, interact: 0, card1: 2, card2: 3, card3: 1 },
};
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '十字上', '十字下', '十字左', '十字右'];
// Anything else is told by where the button sits, since its letters and shapes differ.
const PAD_POSITIONS = ['下键', '右键', '左键', '上键', '左肩', '右肩', '左扳机', '右扳机', '选择', '开始', '左摇杆', '右摇杆', '十字上', '十字下', '十字左', '十字右'];
let padNames = PAD_NAMES;
export const setPadStyle = (id: string) => { padNames = !id || /xbox|xinput|x-box/i.test(id) ? PAD_NAMES : PAD_POSITIONS; };
export const padName = (button: number) => padNames[button] ?? `键 ${button}`;
export const keyName = (code: string) => code === 'Space' ? '空格' : code.replace(/^(Key|Digit|Numpad)/, '').replace(/^Arrow/, '方向').replace(/(Left|Right)$/, '');
// Always a copy, since rebinding changes it in place and the defaults have to stay what they are.
export const defaultBindings = (): Bindings => ({ keys: { ...DEFAULT_BINDINGS.keys }, pad: { ...DEFAULT_BINDINGS.pad } });
export const loadBindings = () => read<Bindings>('road-to-agi.bindings', defaultBindings());
export const saveBindings = (bindings: Bindings) => write('road-to-agi.bindings', bindings);

const KEY = 'road-to-agi.saves', SETTINGS_KEY = 'road-to-agi.settings', BEST_KEY = 'road-to-agi.trials';
function read<T>(key: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(readStored(key) ?? '{}') } as T; } catch { return { ...fallback }; }
}
function write(key: string, value: unknown) {
  writeStored(key, JSON.stringify(value));
}

export function loadSaves(): (SaveData | null)[] {
  const saved = read<Record<string, SaveData>>(KEY, {});
  return Array.from({ length: SAVE_SLOTS }, (_, slot) => {
    const save = saved[slot];
    return save && save.slot === slot && Number.isFinite(save.savedAt) && typeof save.roomId === 'string'
      && typeof save.roomName === 'string' && typeof save.levelName === 'string' && isRunSnapshot(save.run) ? save : null;
  });
}
export function writeSave(save: SaveData) { write(KEY, { ...read<Record<string, SaveData>>(KEY, {}), [save.slot]: save }); }
export function deleteSave(slot: number) { const saved = read<Record<string, SaveData>>(KEY, {}); delete saved[slot]; write(KEY, saved); }
// The slot a new run goes into, or -1 when all of them hold a run.
export const freeSlot = (saves: (SaveData | null)[]) => saves.findIndex(s => !s);
export const latestSave = (saves: (SaveData | null)[]) => saves.reduce<SaveData | null>((best, s) => s && (!best || s.savedAt > best.savedAt) ? s : best, null);

export const loadSettings = () => read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (settings: Settings) => write(SETTINGS_KEY, settings);

export const loadBestRoom = () => read<{ room: number }>(BEST_KEY, { room: 0 }).room;
export const recordBestRoom = (room: number) => { if (room > loadBestRoom()) write(BEST_KEY, { room }); };

// Memory shards buy a little lasting life, and that growth stops at 20% (spec section 7).
export interface Profile { shards: number; vitality: number; memories: number }
export const MEMORY_COST = 10;
export const VITALITY_STEP = 5, VITALITY_MAX = 4, vitalityCost = (level: number) => 20 * (level + 1);
export const loadProfile = () => read<Profile>('road-to-agi.profile', { shards: 0, vitality: 0, memories: 0 });
export const saveProfile = (profile: Profile) => write('road-to-agi.profile', profile);

// The checking back door stays on across reloads until it is turned off.
export const loadGod = () => read<{ on: boolean }>('road-to-agi.god', { on: false }).on;
export const saveGod = (on: boolean) => write('road-to-agi.god', { on });
