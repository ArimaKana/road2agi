import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { texture as sample, uniform, uv, vec2, vec4 } from 'three/tsl';
import { ANIMATION_FPS, WORLD_PER_METRE, Game, ATTACK_LABELS, BELT, DIRS, ERASE, MIRROR, SHELF, STAMPER, VENT, ULT, CHARGE, DASH_RECHARGE, FACINGS, PRESS, VALVE, clamp, screenToWorld, unit, warnTime, worldToScreen, type Enemy, type GameEvent, type Trap, type Vec2 } from './simulation';
import { CRATE, FLOOR, MACHINE, TILE, WALL, isWall, railTiles, tileCenter, tileOf, type Area, type Door } from './room';
import { TRAP_TIPS } from './level';

import { LevelMap } from './levelMap';
import { Input } from './input';
import { PadNav } from './padNav';
import { regionArt } from './loading';
import type { EventOf } from './gameEvents';
import { saveRecovery, takeRecovery } from './recovery';
import { GameLoop, MAX_FRAME_TIME } from './gameLoop';
import { Particles } from './particles';
import { CombatGlow } from './combatGlow';
import { Sfx } from './sfx';
import { Bgm } from './bgm';
import { hud, type MenuMode } from './hud';
import { BASE_CARDS, CARDS, CARD_IDS, GLM, ROMAN, STAGGER, START_SLOTS, canStartWith, cardPrice, glmStats, startLoadout, type CardId } from './cards';
import { clearUnlocked, loadUnlocked, saveUnlocked } from './progress';
import { bodyOf } from './enemies';
import { MEMORY_COST, SETTING_STEPS, defaultBindings, VITALITY_MAX, VITALITY_STEP, deleteSave, freeSlot, keyName, latestSave, loadBestRoom, loadBindings, loadGod, loadProfile, loadSaves, loadSettings, padName, recordBestRoom, saveBindings, saveGod, saveProfile, saveSettings, vitalityCost, writeSave, type Action, type SaveData, type SettingCommand, type SettingCycle, type SettingToggle, type SoundMode } from './saves';
import { MEMORIES, storyScene } from './story';
import { SummonView } from './summonView';
import { Flipbooks } from './flipbooks';
import { HazardView } from './hazardView';
import { createMirror } from './mirrorView';
import { notCounted, shieldUp } from './enemies';
import { trialLeaderboard } from '../platform/trialLeaderboard';

interface Sheet { file: string; directions: string[]; columns: number; rows: number; worldSize: [number, number]; anchors: Record<string, [number, number]> }
interface Clip { frames: number; fps: number; loop: boolean; order?: number[]; sheets: Sheet[] }
interface Manifest { actions: Record<string, Clip> }
export interface EnemyEntry { file: string; directions: string[]; columns: number; rows: number; anchor: [number, number]; metres: [number, number]; top: number; frames: number; moving: boolean; actions: Record<string, { hit?: number; start: number; frames: number; loop: boolean }> }
interface EnemyView { group: THREE.Group; sprite: THREE.Sprite; mat: THREE.SpriteNodeMaterial; offset: { value: THREE.Vector2 }; tint: { value: THREE.Color }; entry: EnemyEntry; hp: THREE.Mesh; hpBack: THREE.Mesh; warning: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>; friend: THREE.Mesh; arc: THREE.Mesh | null; age: number; pose: string; poseAge: number; named: boolean; windTotal: number; clipCount: number; quarter: string; walk: number; px: number; pz: number; leader: THREE.Mesh | null }
interface Effect { mesh: THREE.Object3D; life: number; max: number; velocity: THREE.Vector3 | null; grow: number; ramp?: boolean; tick?: (dt: number, t: number) => void }

// World direction each sprite facing looks along on the isometric camera, and how long run and idle dwell on each facing they turn through.
const AXIS = FACINGS.map((_, i) => screenToWorld(Math.sin(i * Math.PI / 4), -Math.cos(i * Math.PI / 4))), TURN_STEP = .03;
const CAMERA_HOME = new THREE.Vector3(20, 20, 20), CAMERA_RIGHT = new THREE.Vector3(1, 0, -1).normalize(), CAMERA_UP = new THREE.Vector3(-1, 2, -1).normalize();
const HIT_COLOR: Record<string, number> = { light: 0xb6efff, charge: 0xffb868, ult: 0x8fc6ff, trap: 0xff9a4d, ally: CARDS.glm.color, kimi: CARDS.kimi.color, seed: CARDS.seed.color, minimax: CARDS.minimax.color, claude: CARDS.claude.color, gemini: CARDS.gemini.color };
// A summon's mark on an enemy tints its body: turned, charmed, sealed.
const TINT = { allied: 0x4f8fe0, charm: 0xd9668f, sealed: 0xd9853f, shieldOut: 0xb4bcc6, stage: [0xffdcc4, 0xffbcaa] };
// What a door shows: red and shut waiting for the room to clear, steel once sealed behind her, and a pale glow on the floor when it is open.
const DOOR_SHUT = 0xff6b5e, DOOR_SEALED = 0x6f8ba0, DOOR_OPEN = 0x7fe9ff, DOOR_SPEED = 2.8, DOOR_POST = .8, HAZARD = 0xff5a2c, READY = 0x8ff0ff;
// How far in front of its feet a sprite is drawn, along the view: without it, the top of a wall just behind her cuts through the billboard.
const SPRITE_LIFT = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(.9), WALL_HEIGHT = 1.2;
const KICK = [.09, .18, .32], ZOOM = [.005, .016, .032], FLASH_TIME = .16, WHITE = new THREE.Color(0xffffff);
// The fist's picture: its knuckles sit here on the canvas and it points this far below the horizontal.
const FIST_KNUCKLES = { x: 85, y: 80 }, FIST_ANGLE = 41, FIST_RECOVER = .34;
// Reads the aim at chest height: the cursor sits on the body it is pointing at, not on the floor behind it.
const AIM_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.8);
// What the hero is shown doing when the rules only have her idle or running. These never touch the rules: anything she does cuts them short, and those marked still give way to moving after their grace.
const FLOURISH: Record<string, { still?: boolean; grace?: number; then?: string }> = {
  run_start: {}, run_stop: { still: true }, hit: {}, knockdown: { still: true, then: 'get_up' }, get_up: { still: true }, interact: { still: true, grace: .4 }, revive: { still: true }, death: {}, victory: { still: true, grace: .4 },
};
const LOAD_SAMPLE = 4;
// The sign at a door once it opens: what waits past it. The trial's next room is not decided until she gets there.
function nextRoomSign(game: Game) {
  if (game.trial) return null;
  const next = game.level.rooms[game.roomIndex + 1];
  if (!next) return game.room.exit ? { icon: 'reward-life', text: '整备点 · 回满生命' } : null;
  return next.kind === 'boss' ? { icon: 'reward-partner', text: `Boss · ${next.name}` } : next.kind === 'shop' ? { icon: 'res-coin', text: '补给站' } : next.kind === 'event' ? { icon: 'reward-life', text: '事件 · 回复生命' } : { icon: 'reward-upgrade', text: '战斗 · 三选一奖励' };
}
// What the objective line says at an open door. At a fork it says which side is which, as the player sees them.
function doorWords(game: Game) {
  if (!game.forksAhead()) return `门已打开，下一间：${nextRoomSign(game)?.text ?? '继续'}`;
  const along = game.room.exit!.alongX ? worldToScreen(1, 0) : worldToScreen(0, 1), supply = along.x > 0 ? '左' : '右', risk = along.x > 0 ? '右' : '左';
  return `门已打开：${supply}边补给 · ${risk}边强化，每波多一敌`;
}
// Which kit each region is built from, and what fills its solid tiles and stands on its back walls. Anything a kit does not have is left out.
const REGION_KIT: Record<string, string> = { 缓存废港: 'port', 镜像书库: 'library', 梯度熔炉: 'forge', 零域: 'zero' };
const KITS = ['port', 'library', 'forge', 'zero'];
const SOLIDS: Record<string, string[]> = { port: ['cover_crate', 'cover_crate', 'barrel'], library: ['cover_crate', 'low_shelf', 'book_pile'], forge: ['cover_crate', 'ingot_stack', 'coal_heap'], zero: ['cover_crate', 'plinth'] };
const WALL_DECOR: Record<string, string[]> = { port: ['lamp_post', 'pipe_run', 'rope_coil', 'bollard'], library: ['lamp_post', 'scroll_rack', 'book_pile'], forge: ['brazier', 'pipe_elbow', 'gear_stand', 'chain_hang'], zero: ['shard', 'cube_float'] };
const DECOR_EVERY = 5;
const clockText = (seconds: number) => `${Math.floor(seconds / 60)} 分 ${String(Math.floor(seconds % 60)).padStart(2, '0')} 秒`;
const DECALS = ['shadow-small', 'shadow-large', 'lock', 'warn-circle', 'warn-line', 'landing', 'elite-ring', 'friend-ring', 'foot-solid', 'foot-dashed', 'shield-arc', 'elite-crest'];
const PAIRS: { cards: [CardId, CardId]; icon: string; text: string }[] = [
  { cards: ['glm', 'grok'], icon: 'combo-hesitate', text: 'GLM + Grok：解除后短暂迟疑' }, { cards: ['kimi', 'gpt'], icon: 'combo-refract', text: 'Kimi + GPT：重置后首束折射增伤' },
  { cards: ['qwen', 'gemini'], icon: 'combo-extra', text: 'Qwen + Gemini：零消耗施放时额外一击' }, { cards: ['seed', 'claude'], icon: 'combo-verdict', text: 'Seed + Claude：替身标记提升裁决对精英的伤害' },
  { cards: ['minimax', 'kimi'], icon: 'combo-wall', text: 'MiniMax + Kimi：撞墙目标承受折射增伤' }, { cards: ['glm', 'seed'], icon: 'combo-weaken', text: 'GLM + Seed：替身结束后降低策反目标防御' },
];
const BOSS_NAME: Record<string, string> = { b01: '缓存典狱长', b02: '千面校对官', b03: '过拟合圣像', b04: '归零之心 NULL' };
const COUNTER_ICON: Record<string, string> = { light: 'counter-thrust', charge: 'counter-charge', card: 'counter-card' };
const MANIFESTO = ['算力属于金字塔尖', '冗余的个体思维必须归零', '闭源方能维持秩序'];
// A chain has no sprite of its own: it is drawn from its effect, two frames by two.
const CHAIN_ART: EnemyEntry = { file: 'chain', directions: ['D'], columns: 2, rows: 2, anchor: [.5, .08], metres: [1.5, 1.5], top: 1.3, frames: 1, moving: false, actions: { idle: { start: 0, frames: 4, loop: true } } };
interface Kit { modules: Record<string, THREE.Mesh>; far: THREE.Texture }
const KNOCKDOWN_DAMAGE = 18, ENDING_HOLD = .45, SURPRISE_TIME = .9, TIRED_HP = 30;

function material(color: number, extra: Record<string, unknown> = {}) { return new THREE.MeshStandardNodeMaterial({ color, roughness: .85, ...extra }); }
export function ring(radius: number, color: number, opacity = 1, thickness = .035) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - thickness, radius, 64), new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = .025;
  return mesh;
}
export function glow<T extends THREE.Mesh>(mesh: T) { (mesh.material as THREE.Material).blending = THREE.AdditiveBlending; return mesh; }
// A shape lying flat on the floor, for the rings and wedges of a heat vent.
function flat<T extends THREE.BufferGeometry>(geometry: T, color: number, x: number, z: number) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .08, z);
  return glow(mesh);
}
// Lays a floor plane made from UNIT_AREA over an area, for anything that moves or changes length.
const UNIT_AREA: Area = { x: 0, z: 0, halfX: .5, halfZ: .5 };
function fit(mesh: THREE.Mesh, a: Area) { mesh.position.x = a.x; mesh.position.z = a.z; mesh.scale.set(a.halfX * 2, a.halfZ * 2, 1); }
function restartAnimation(el: Element | null, name: string) { if (!el) return; el.classList.remove(name); void (el as HTMLElement).offsetWidth; el.classList.add(name); }
// A small repeating picture for the floor of a trap.
function patternTexture(draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function drawHazardStripes(c: CanvasRenderingContext2D) {
  c.fillStyle = '#20262c'; c.fillRect(0, 0, 64, 64);
  c.strokeStyle = '#c8922e'; c.lineWidth = 11;
  for (let x = -64; x <= 128; x += 32) { c.beginPath(); c.moveTo(x, -8); c.lineTo(x + 80, 72); c.stroke(); }
}
function drawDoorChevrons(c: CanvasRenderingContext2D) {
  c.strokeStyle = '#a8f4ff'; c.lineWidth = 9; c.lineJoin = 'miter';
  c.beginPath(); c.moveTo(16, 10); c.lineTo(40, 32); c.lineTo(16, 54); c.stroke();
}
function drawBeltChevrons(c: CanvasRenderingContext2D) {
  c.fillStyle = '#16303c'; c.fillRect(0, 0, 64, 64);
  c.strokeStyle = '#58c7d6'; c.lineWidth = 8; c.lineJoin = 'miter';
  c.beginPath(); c.moveTo(16, 8); c.lineTo(42, 32); c.lineTo(16, 56); c.stroke();
}

export class Engine {
  game = new Game();
  private loop = new GameLoop(this.game);
  sfx = new Sfx();
  private bgm = new Bgm();
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGPURenderer;
  private glow!: CombatGlow;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-16, 16, 10, -10, .1, 100);
  private hero!: THREE.Sprite<THREE.Object3DEventMap>;
  private heroMaterial!: THREE.SpriteNodeMaterial;
  private heroOutline!: THREE.Sprite<THREE.Object3DEventMap>;
  private runShards = 0;
  private shadow!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private reticle!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicNodeMaterial>;
  private fx!: Particles;
  private view!: SummonView;
  private input!: Input;
  private manifest!: Manifest;
  private textures: Record<string, THREE.Texture> = {};
  private enemyViews = new Map<number, EnemyView>();
  private effects: Effect[] = [];
  private raycaster = new THREE.Raycaster();
  private mouseNdc = new THREE.Vector2();
  private aimPoint = new THREE.Vector3();
  private kick = new THREE.Vector3();
  private follow = new THREE.Vector3();
  private roomObjects: THREE.Object3D[] = [];
  private roomTextures: THREE.Texture[] = [];
  private roomTicks: ((dt: number) => void)[] = [];
  private exitArrow!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicNodeMaterial>;
  private exitMarks: THREE.Object3D[] = [];
  private aimArrow!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicNodeMaterial>;
  private nav = new PadNav();
  private pictures: Record<string, Promise<void>> = {};
  private kitLoads: Record<string, Promise<void>> = {};
  private retrying = false;
  private memoryAt = 0;
  // Set while a failed load waits for the player to ask for another try.
  retryLoad: (() => void) | null = null;
  private hazardStripes!: THREE.Texture;
  private beltChevrons!: THREE.Texture;
  private doorChevrons!: THREE.Texture;
  private noticeUntil = 0;
  private freshUnlocks: CardId[] = [];
  private runUnlocks: CardId[] = [];
  private prepOpened = 0;
  private levelMap!: LevelMap;
  private shownFacing = 3;
  private turnTimer = 0;
  private shake = 0;
  private zoomPunch = 0;
  private heroFlash = 0;
  private ghostTimer = 0;
  private stepTimer = 0;
  private auraTimer = 0;
  private moteTimer = 0;
  private lastHitSound = 0;
  private slot = -1;
  private storyPaused = false;
  private panelOpened = 0;
  private trialBest = 0;
  private kits: Record<string, Kit> = {};
  private enemyArt: Record<string, EnemyEntry> = {};
  private decals: Record<string, THREE.Texture> = {};
  private flips!: Flipbooks;
  private hazards!: HazardView;
  private counterUntil = 0;
  private rallyUntil = 0;
  private lockMark!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private flourish: { action: string; age: number } | null = null;
  private lastAction = 'idle';
  private endingAt = 0;
  private endingMode: MenuMode = 'won';
  private surpriseUntil = 0;
  private emitOwed: Record<string, number> = {};
  private bannerUntil = 0;
  private rallySeal: { at: number; x: number; z: number } | null = null;
  private loadMark = 0;
  private nextNumber = 1;
  private fist: { age: number; flight: number; x: number; z: number; landed: boolean } | null = null;
  private menuMode: MenuMode = 'ready';
  private jumpPaused = false;
  private last = 0;
  private debug = new URLSearchParams(location.search);

  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

  async init() {
    try {
      await this.setupScene();
      this.flips = new Flipbooks(this.scene);
      await this.withLoading('第一大区', () => this.loadCore());
      this.layHeroDecals();
      this.hazards = new HazardView({ scene: this.scene, game: this.game, decals: this.decals, flipbook: id => this.flips.textureOf(id) });
      this.buildRoom(); this.follow.set(this.game.hero.x, 0, this.game.hero.z);
      this.levelMap = new LevelMap(this.renderer, document.querySelector('#map-surface')!);
      this.loadProgress();
      this.input = new Input(this.canvas, force => this.togglePause(force), () => this.unlockAudio(), () => this.toggleJump(), () => this.setGod(!this.game.god));
      this.input.onReconnect = () => { if (this.game.state === 'paused' && !hud.dialog && !hud.jumpOpen) { this.nav.wait(); this.togglePause(); } };
      this.input.notify = text => { hud.notice = text; hud.noticeVisible = true; this.noticeUntil = performance.now() + 1800; };
      hud.soundLocked = document.body.classList.contains('touch');
      this.setGod(this.debug.has('god') || loadGod());
      hud.ready = true;
      this.flips.fill();
      this.loadPreferences(); this.refreshHome();
      this.showMenu('ready'); hud.screen = 'home';
      if (this.debug.has('room')) { hud.screen = 'none'; await this.run(this.debug.get('room')); }
      else await this.recoverRun();
      if (this.debug.has('debug')) Object.assign(window, { game: this.game, fx: this.fx, engine: this });
      this.last = performance.now();
      requestAnimationFrame(this.tick);
    } catch (error) {
      console.error(error);
      hud.fatal = `游戏暂时无法启动：${(error as Error).message}。请确认浏览器已启用 WebGPU 或 WebGL 2，并刷新重试。`;
    }
  }

  // Counts one file toward the bar.
  private track = <T,>(job: Promise<T>) => { hud.loadTotal++; return job.then(value => { hud.loadDone++; hud.loadLeft = this.loadLeft(); return value; }); };
  // Only the files already here say how big a file is, so the rest is worked out from them.
  private loadLeft() {
    const left = hud.loadTotal - hud.loadDone; if (!left || hud.loadDone < LOAD_SAMPLE) return '';
    const bytes = performance.getEntriesByType('resource').slice(this.loadMark).reduce((sum, e) => sum + ((e as PerformanceResourceTiming).encodedBodySize || 0), 0);
    return bytes ? `剩余约 ${(bytes / hud.loadDone * left / 1048576).toFixed(1)} MB` : '';
  }
  // Runs a load with the bar up. If it fails the bar offers another try, and the fight waits for as long as that takes.
  private async withLoading(label: string, job: () => Promise<unknown>) {
    hud.loadLabel = label; hud.loadDone = 0; hud.loadTotal = 0; hud.loadError = false; hud.loadLeft = ''; hud.loading = true; performance.setResourceTimingBufferSize(1000); this.loadMark = performance.getEntriesByType('resource').length;
    for (;;) {
      try { await job(); break; } catch (error) {
        console.error(error); hud.loadError = true;
        await new Promise<void>(resolve => { this.retryLoad = resolve; });
        this.retryLoad = null; hud.loadError = false; hud.loadDone = 0; hud.loadTotal = 0;
      }
    }
    hud.loading = false;
  }
  // What every region needs, and the first region. The rest comes when a run gets there.
  private async loadCore() {
    if (!Object.keys(this.enemyArt).length) {
      const response = await this.track(fetch('./assets/enemies.json')); if (!response.ok) throw new Error('无法载入敌人素材清单');
      this.enemyArt = (await response.json()).entities;
    }
    await Promise.all([this.loadHero(), this.loadDecals(), this.flips.load(this.track), this.ensureRegion(0), this.loadPicture(this.enemyArt.decoy.file)]);
  }
  private loadPicture(file: string) {
    return this.pictures[file] ??= this.track(new THREE.TextureLoader().loadAsync(`./assets/${file}`)).then(t => {
      t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      this.textures[file] = t;
    }).catch(error => { delete this.pictures[file]; throw error; });
  }
  private ensureRegion(index: number) {
    const level = this.game.levels[index];
    // Past the first region, or with any more partners than a first run has, every effect has to be here before the fight.
    const effects = index > 0 || this.game.unlocked.size > BASE_CARDS.length ? [this.flips.loadAll(this.track)] : [];
    return Promise.all([this.loadKit(REGION_KIT[level.name] ?? 'port'), ...effects, ...regionArt(level).map(art => this.loadPicture(this.enemyArt[art].file))]);
  }
  // A region left behind gives back its memory. Its files stay in the browser's cache, so coming back is quick.
  private releaseExcept(index: number) {
    const level = this.game.levels[index], keep = new Set([...regionArt(level), 'decoy'].map(art => this.enemyArt[art].file)), kit = REGION_KIT[level.name] ?? 'port';
    for (const name of KITS) {
      const old = this.kits[name]; if (name === kit || !old) continue;
      old.far.dispose();
      for (const mesh of Object.values(old.modules)) { mesh.geometry.dispose(); const stuff = mesh.material as THREE.MeshStandardMaterial; stuff.map?.dispose(); stuff.dispose(); }
      delete this.kits[name]; delete this.kitLoads[name];
    }
    for (const { file } of Object.values(this.enemyArt)) if (!keep.has(file) && this.textures[file]) { this.textures[file].dispose(); delete this.textures[file]; delete this.pictures[file]; }
  }
  private async setupScene() {
    const { scene, camera } = this;
    // WebGPU where the browser has it; three falls back to its WebGL 2 backend by itself. ?webgl forces the fallback.
    const renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', forceWebGL: this.debug.has('webgl') });
    await renderer.init();
    this.renderer = renderer;
    this.glow = new CombatGlow(renderer, scene, camera);
    const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    hud.backend = backend; this.canvas.dataset.backend = backend;
    renderer.setClearColor(0x0b1420); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.onDeviceLost = () => this.deviceLost();
    scene.fog = new THREE.Fog(0x0b1420, 28, 55); camera.position.set(20, 20, 20); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xc9edff, 0x172330, 2.5));
    const sun = new THREE.DirectionalLight(0xd2e2fa, 2.2); sun.position.set(-8, 16, 4); scene.add(sun);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(.38, 32), new THREE.MeshBasicNodeMaterial({ color: 0x00080e, transparent: true, opacity: .4, depthWrite: false })); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = .07; scene.add(this.shadow);
    this.reticle = ring(.34, 0xa8edf3, .75, .035); scene.add(this.reticle);
    this.exitArrow = new THREE.Mesh(new THREE.CircleGeometry(.42, 3), new THREE.MeshBasicNodeMaterial({ color: DOOR_OPEN, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); this.exitArrow.scale.set(1.3, .7, 1); this.exitArrow.renderOrder = 3; scene.add(this.exitArrow);
    this.aimArrow = new THREE.Mesh(new THREE.CircleGeometry(.5, 3), new THREE.MeshBasicNodeMaterial({ color: READY, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); this.aimArrow.scale.set(1.5, .7, 1); this.aimArrow.renderOrder = 3; scene.add(this.aimArrow);
    this.hazardStripes = patternTexture(drawHazardStripes); this.beltChevrons = patternTexture(drawBeltChevrons); this.doorChevrons = patternTexture(drawDoorChevrons);
    this.fx = new Particles(scene);
    this.view = new SummonView({
      scene, camera: this.camera, game: this.game, fx: this.fx, sfx: this.sfx,
      addEffect: (mesh, life, velocity, grow, extra) => this.addEffect(mesh, life, velocity, grow, extra), jolt: (amount, aim, push, zoom) => this.jolt(amount, aim, push, zoom),
      number: (x, z, text, tier) => this.number(x, z, text, tier), notice: text => { hud.notice = text; hud.noticeVisible = true; this.noticeUntil = performance.now() + 1200; },
      banner: text => this.banner(text), dispose: object => this.dispose(object), decoyArt: () => ({ map: this.textures[this.enemyArt.decoy.file], entry: this.enemyArt.decoy }),
    });
    window.addEventListener('resize', this.resize); this.resize();
  }

  private resize = () => {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return; // A hidden frame reports no size, and WebGPU cannot make a swapchain for that. Keep the last one until it is back.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); // Changes with the browser zoom or a move to another screen.
    this.renderer.setSize(w, h, false);
    const aspect = w / h, extent = Math.max(11.8, 15.4 / aspect), camera = this.camera;
    camera.left = -extent * aspect; camera.right = extent * aspect; camera.top = extent; camera.bottom = -extent; camera.updateProjectionMatrix();
  };

  private async loadDecals() {
    const loader = new THREE.TextureLoader();
    await Promise.all(DECALS.map(async name => { if (this.decals[name]) return; const t = await this.track(loader.loadAsync(`./assets/vfx/decal-${name}.webp`)); t.colorSpace = THREE.SRGBColorSpace; this.decals[name] = t; }));
  }
  // A picture lying on the floor. Floor level, so it must not write depth.
  private decal(name: string, size: number, opacity = 1, order = -1) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicNodeMaterial({ map: this.decals[name], transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .07; mesh.renderOrder = order;
    return mesh;
  }
  private layHeroDecals() {
    this.scene.remove(this.shadow); this.shadow = this.decal('shadow-small', 2.2, .85, -2); this.scene.add(this.shadow);
    this.lockMark = this.decal('lock', 1, .9); this.scene.add(this.lockMark);
  }
  private loadKit(name: string) {
    return this.kitLoads[name] ??= (async () => {
      const [file, far] = await Promise.all([this.track(new GLTFLoader().loadAsync(`./assets/scenes/${name}/kit.glb`)), this.track(new THREE.TextureLoader().loadAsync(`./assets/scenes/${name}/far.webp`))]);
      far.colorSpace = THREE.SRGBColorSpace;
      const modules: Record<string, THREE.Mesh> = {};
      file.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) modules[o.name] = o as THREE.Mesh; });
      // A floor at floor level must not write depth, for the same reason as the plain floor: billboards reach below it.
      const floor = modules.floor_0?.material as THREE.Material | undefined;
      if (floor) { floor.depthWrite = false; floor.transparent = false; }
      this.kits[name] = { modules, far };
    })().catch(error => { delete this.kitLoads[name]; throw error; });
  }
  private get kit() { return this.kits[REGION_KIT[this.game.level.name] ?? 'port']; }
  // One instanced mesh per module used, shared with the kit, so a room is a few draw calls however big it is.
  private placeKit(name: string, places: { x: number; y: number; z: number; turn?: number }[], order = 0) {
    const source = this.kit.modules[name]; if (!source || !places.length) return;
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, places.length), place = new THREE.Object3D();
    places.forEach((p, i) => { place.position.set(p.x, p.y, p.z); place.rotation.y = p.turn ?? 0; place.updateMatrix(); mesh.setMatrixAt(i, place.matrix); });
    mesh.frustumCulled = false; mesh.renderOrder = order; mesh.userData.shared = true; this.addToRoom(mesh);
  }
  // A module as a single object that can be moved and scaled, with its own copy of the material when it has to change.
  private kitMesh(name: string, ownMaterial = false) {
    const source = this.kit.modules[name]; if (!source) return null;
    const mesh = new THREE.Mesh(source.geometry, ownMaterial ? (source.material as THREE.Material).clone() : source.material);
    mesh.userData.shared = true; mesh.userData.ownMaterial = ownMaterial;
    return this.addToRoom(mesh);
  }
  private addToRoom<T extends THREE.Object3D>(object: T) { this.scene.add(object); this.roomObjects.push(object); return object; }
  // The floor, the walls and the crates of the current room, then its doors and traps. One instanced box per tile, so the walls are a few draw calls however big the room.
  private buildRoom() {
    for (const o of this.roomObjects) this.dispose(o);
    for (const t of this.roomTextures) t.dispose();
    this.roomObjects = []; this.roomTextures = []; this.roomTicks = [];
    const m = this.game.room, kit = this.kit, regionName = REGION_KIT[this.game.level.name] ?? 'port';
    this.scene.background = kit.far;
    const kindAt = (c: number, r: number) => c < 0 || r < 0 || c >= m.cols || r >= m.rows ? WALL : m.walls[r * m.cols + c];
    const variants = (stem: string) => Object.keys(kit.modules).filter(name => new RegExp(`^${stem}_\\d+$`).test(name));
    // The same room looks the same each time it is entered: the pick comes from the tile, not from chance.
    const pick = <T,>(list: T[], c: number, r: number) => list[(((c * 73856093) ^ (r * 19349663)) >>> 3 & 0xffff) % list.length];
    const floors = variants('floor'), wallKinds = variants('wall'), solids = (SOLIDS[regionName] ?? []).filter(name => kit.modules[name]), decor = (WALL_DECOR[regionName] ?? []).filter(name => kit.modules[name]);
    const placed: Record<string, { x: number; y: number; z: number; turn?: number }[]> = {};
    const put = (name: string, p: { x: number; y: number; z: number; turn?: number }) => (placed[name] ??= []).push(p);
    let wallCount = 0;
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const kind = kindAt(c, r), t = tileCenter(m, c, r);
      put(pick(floors, c, r), { x: t.x, y: 0, z: t.z, turn: pick([0, 1, 2, 3], r, c) * Math.PI / 2 });
      if (kind === WALL) {
        put(pick(wallKinds, c, r), { x: t.x, y: 0, z: t.z });
        // Only the far walls, seen from above: anything on the near ones would stand in front of the fight.
        if (decor.length && (kindAt(c + 1, r) === FLOOR || kindAt(c, r + 1) === FLOOR) && ++wallCount % DECOR_EVERY === 0) put(pick(decor, c, r), { x: t.x, y: WALL_HEIGHT, z: t.z });
      } else if (kind === CRATE && solids.length) put(pick(solids, c, r), { x: t.x, y: 0, z: t.z, turn: pick([0, 1, 2, 3], c, r) * Math.PI / 2 });
    }
    for (const [name, places] of Object.entries(placed)) this.placeKit(name, places, floors.includes(name) ? -5 : 0);
    if (m.entrance) this.buildDoor(m.entrance, false);
    if (m.exit) this.buildDoor(m.exit, true);
    this.exitMarks = [];
    const exit = m.exit;
    if (exit) {
      // A fork shows what each half of the door leads to, and a line up the floor between them.
      const fork = this.game.forksAhead(), sign = nextRoomSign(this.game), along = { x: exit.alongX ? 1 : 0, z: exit.alongX ? 0 : 1 }, quarter = exit.span * TILE / 4;
      const signs = fork ? [{ icon: 'reward-life', shift: -quarter }, { icon: 'reward-upgrade', shift: quarter }] : sign ? [{ icon: sign.icon, shift: 0 }] : [];
      for (const { icon, shift } of signs) new THREE.TextureLoader().load(`./assets/ui/${icon}.webp`, t => {
        if (this.game.room.exit !== exit) { t.dispose(); return; } // Gone on to another room while this came in.
        t.colorSpace = THREE.SRGBColorSpace; this.roomTextures.push(t);
        const sprite = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }) as unknown as THREE.SpriteMaterial);
        sprite.scale.set(1.5, 1.5, 1); sprite.position.set(exit.center.x + along.x * shift, WALL_HEIGHT + 1.1, exit.center.z + along.z * shift); sprite.renderOrder = 7; sprite.visible = false; this.addToRoom(sprite); this.exitMarks.push(sprite);
      });
      if (fork) {
        const line = this.addToRoom(new THREE.Mesh(new THREE.PlaneGeometry(.14, TILE * 3), new THREE.MeshBasicNodeMaterial({ color: DOOR_OPEN, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide })));
        line.rotation.set(-Math.PI / 2, 0, exit.alongX ? 0 : Math.PI / 2); line.position.set(exit.center.x + exit.inward.x * TILE, .09, exit.center.z + exit.inward.z * TILE); line.renderOrder = 3; line.visible = false; this.exitMarks.push(line);
      }
    }
    for (const t of this.game.traps) this.buildTrap(t);
  }
  // A door is a gap in the wall between two lit posts, closed by a leaf that sinks into the floor. When it opens the posts turn from red to pale blue, the floor carries on past the wall, and arrows run along it out of the room. The one she came through starts open and shuts behind her.
  private buildDoor(door: Door, isExit: boolean) {
    const { x, z } = door.center, length = door.span * TILE, out = { x: -door.inward.x, z: -door.inward.z }, turn = door.alongX ? 0 : Math.PI / 2;
    const next = isExit ? this.game.level.rooms[this.game.roomIndex + 1]?.kind : null, stem = next === 'boss' ? 'door_boss' : next === 'shop' ? 'door_shop' : isExit ? 'door_out' : 'door_in';
    const leaf = this.kitMesh(`${stem}_leaf`, true) ?? this.kitMesh('door_in_leaf', true);
    const panel = leaf ?? this.addToRoom(new THREE.Mesh(new THREE.BoxGeometry(door.alongX ? length : TILE * .7, WALL_HEIGHT, door.alongX ? TILE * .7 : length), material(0x2c3946)));
    if (leaf) { leaf.rotation.y = turn; leaf.scale.x = length / 1.3; }
    panel.position.set(x, leaf ? 0 : WALL_HEIGHT / 2, z);
    const posts = [-1, 1].map(end => {
      const post = this.addToRoom(new THREE.Mesh(new THREE.BoxGeometry(TILE * .16, WALL_HEIGHT + DOOR_POST, TILE * .16), new THREE.MeshBasicNodeMaterial({ color: isExit ? DOOR_SHUT : DOOR_SEALED })));
      post.position.set(x + (door.alongX ? end * (length / 2 + TILE * .06) : 0), (WALL_HEIGHT + DOOR_POST) / 2, z + (door.alongX ? 0 : end * (length / 2 + TILE * .06)));
      return post;
    });
    // Only the way out goes anywhere: two tiles of floor past the wall and the arrows on them.
    const floors = Object.keys(this.kit.modules).filter(name => /^floor_\d+$/.test(name)), road: { x: number; y: number; z: number }[] = [];
    let arrows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null, arrowMap: THREE.Texture | null = null;
    if (isExit) {
      for (let step = 1; step <= 2; step++) for (let i = 0; i < door.span; i++) {
        const along = (i - (door.span - 1) / 2) * TILE;
        road.push({ x: x + out.x * step * TILE + (door.alongX ? along : 0), y: 0, z: z + out.z * step * TILE + (door.alongX ? 0 : along) });
      }
      this.placeKit(floors[0], road, -5);
      const run = TILE * 3, cell = TILE;
      arrowMap = this.tiledTexture(this.doorChevrons, run / cell, length / cell);
      arrows = new THREE.Mesh(new THREE.PlaneGeometry(run, length), new THREE.MeshBasicNodeMaterial({ map: arrowMap, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      arrows.rotation.set(-Math.PI / 2, 0, Math.atan2(-out.z, out.x)); arrows.position.set(x + out.x * TILE, .06, z + out.z * TILE); arrows.renderOrder = -2; this.addToRoom(arrows);
    }
    let open = isExit ? 0 : 1;
    const shape = () => { panel.scale.y = Math.max(.001, 1 - open); panel.position.y = leaf ? 0 : WALL_HEIGHT * (1 - open) / 2; panel.visible = open < .98; };
    shape();
    this.roomTicks.push(dt => {
      const wanted = isExit && this.game.cleared ? 1 : 0;
      open = wanted > open ? Math.min(wanted, open + dt * DOOR_SPEED) : Math.max(wanted, open - dt * DOOR_SPEED);
      shape();
      for (const post of posts) (post.material as THREE.MeshBasicNodeMaterial).color.setHex(isExit && open > .5 ? DOOR_OPEN : isExit ? DOOR_SHUT : DOOR_SEALED);
      if (arrows && arrowMap) { arrows.material.opacity = open * .85; arrowMap.offset.x -= dt * 1.1; }
    });
  }
  private floorPlane(area: Area, color: number, opacity: number, order = -3, map: THREE.Texture | null = null) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(area.halfX * 2, area.halfZ * 2), new THREE.MeshBasicNodeMaterial({ color, map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(area.x, .05 + (order + 5) * .004, area.z); mesh.renderOrder = order;
    return this.addToRoom(mesh);
  }
  private tiledTexture(source: THREE.Texture, repeatX: number, repeatY: number) {
    const texture = source.clone(); texture.repeat.set(repeatX, repeatY); texture.needsUpdate = true; this.roomTextures.push(texture);
    return texture;
  }
  private buildTrap(t: Trap) {
    if (t.kind === 'press' || t.kind === 'stamper') this.buildPress(t);
    else if (t.kind === 'belt') this.buildBelt(t);
    else if (t.kind === 'valve') this.buildValve(t);
    else if (t.kind === 'shelf') this.buildShelf(t);
    else if (t.kind === 'mirror') this.buildMirror(t);
    else if (t.kind === 'vent') this.buildVent(t);
    else if (t.kind === 'scan') this.buildScan(t);
    else if (t.kind === 'erase') this.buildErase(t);
    else if (t.kind === 'beacon') this.buildBeacon(t);
    else this.buildPad(t);
  }
  // Striped plate on the floor. On a warning the plate glows and the head comes down out of the air, slowly, then all at once. A stamper is the same head working its way along a longer plate.
  private buildPress(t: Trap) {
    const r = t.rail, times = t.kind === 'press' ? PRESS : STAMPER, plate = this.floorPlane(r, 0xffffff, .5, -3, this.tiledTexture(this.hazardStripes, r.halfX * 2 / TILE, r.halfZ * 2 / TILE));
    const fill = glow(this.floorPlane(UNIT_AREA, HAZARD, 0, -2));
    const headModel = this.kitMesh(t.kind === 'press' ? 'trap_press_plate' : 'trap_stamper_head', true);
    if (headModel) Object.assign(headModel.material, { transparent: true, opacity: 0, depthWrite: false });
    const head = (headModel ?? this.addToRoom(new THREE.Mesh(new THREE.BoxGeometry(1, .45, 1), material(0x7a8896, { transparent: true, opacity: 0, depthWrite: false })))) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>; head.renderOrder = 6; head.visible = false;
    const headSpan = headModel ? 1 / TILE : 1;
    this.roomTicks.push(() => {
      const a = t.area, warn = t.state === 'warn' ? 1 - t.timer / warnTime(t) : 0, back = t.state === 'recover' ? 1 - t.timer / times.recover : 0;
      fit(fill, a); head.position.x = a.x; head.position.z = a.z; head.scale.set((a.halfX * 2 - .1) * headSpan, 1, (a.halfZ * 2 - .1) * headSpan);
      plate.material.opacity = t.state === 'off' ? .16 : .5;
      fill.material.opacity = t.state === 'warn' ? (.14 + .5 * warn) * (.75 + Math.sin(this.game.time * 26) * .25) : t.state === 'strike' ? .85 : t.state === 'recover' ? .5 * (1 - back) : 0;
      head.visible = t.state === 'warn' || t.state === 'strike' || t.state === 'recover';
      head.position.y = t.state === 'warn' ? 3.6 - .9 * warn : t.state === 'strike' ? .3 : .3 + 3.3 * back;
      head.material.opacity = t.state === 'warn' ? .25 + .55 * warn : t.state === 'strike' ? .95 : .95 * (1 - back);
    });
  }
  // Chevrons scroll the way it carries, and stop with the room.
  private buildBelt(t: Trap) {
    const a = t.area, along = !!t.dir.x, length = (along ? a.halfX : a.halfZ) * 2, width = (along ? a.halfZ : a.halfX) * 2, cell = TILE * 2;
    const texture = this.tiledTexture(this.beltChevrons, length / cell, width / cell);
    const mesh = this.floorPlane({ x: a.x, z: a.z, halfX: length / 2, halfZ: width / 2 }, 0xffffff, .75, -3, texture); mesh.rotation.z = Math.atan2(-t.dir.z, t.dir.x);
    this.roomTicks.push(dt => {
      if (t.state === 'off') { mesh.material.opacity = .25; return; }
      texture.offset.x -= BELT.speed / cell * dt;
    });
  }
  // A squat machine with a wheel on top: pale and ringed while it can be stabbed, orange as it arms, dark while it recharges. Its line across the floor shows the blast.
  private buildValve(t: Trap) {
    const body = this.kitMesh('trap_valve') ?? this.addToRoom(new THREE.Mesh(new THREE.CylinderGeometry(.5, .62, 1.1, 10), material(0x4b5c6b))); body.position.set(t.x, body.userData.shared ? 0 : .55, t.z);
    const wheel = this.addToRoom(new THREE.Mesh(new THREE.TorusGeometry(.4, .09, 6, 18), new THREE.MeshBasicNodeMaterial({ color: READY }))); wheel.position.set(t.x, 1.18, t.z); wheel.rotation.x = -Math.PI / 2;
    const halo = ring(.95, READY, .6, .06); halo.position.set(t.x, .08, t.z); this.addToRoom(halo);
    const line = glow(this.floorPlane(t.area, READY, 0, -2));
    this.roomTicks.push(dt => {
      const time = this.game.time, ready = t.state === 'idle', arming = t.state === 'warn', firing = t.state === 'strike';
      wheel.material.color.setHex(ready ? READY : arming || firing ? 0xffa35c : 0x38454f);
      if (arming) wheel.rotation.z += dt * 18;
      halo.visible = ready; halo.material.opacity = .4 + Math.sin(time * 5) * .25;
      line.material.color.setHex(arming || firing ? HAZARD : READY);
      line.material.opacity = firing ? .95 : arming ? (.2 + .5 * (1 - t.timer / VALVE.warn)) * (.75 + Math.sin(time * 26) * .25) : ready ? .07 : t.state === 'recover' && t.timer > VALVE.recover - .3 ? (t.timer - VALVE.recover + .3) * 2 : 0;
    });
  }
  // A bookcase on a rail. The whole rail lights up before it moves, since anything on it can be caught. The rules move it a tile at a time and the picture glides between them.
  private buildShelf(t: Trap) {
    const rail = this.floorPlane(t.rail, 0x0b0d16, .4, -3), warn = glow(this.floorPlane(t.rail, HAZARD, 0, -2)), a = t.area, sx = a.halfX * 2 - .08, sz = a.halfZ * 2 - .08, last = railTiles(t.rail, t.dir) - t.size;
    const body = this.addToRoom(new THREE.Group());
    const shelf = this.kit.modules.trap_shelf;
    if (shelf) { const model = new THREE.Mesh(shelf.geometry, shelf.material); model.userData.shared = true; model.scale.set(sx / TILE, 1, sz / TILE); body.add(model); }
    else {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), material(0x5b4a78)); stack.position.y = WALL_HEIGHT / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(sx, .08, sz), new THREE.MeshBasicNodeMaterial({ color: 0xc9c6e8 })); top.position.y = WALL_HEIGHT + .03;
      body.add(stack, top);
    }
    this.roomTicks.push(() => {
      const way = t.back ? -1 : 1, moving = t.state === 'strike' && (t.back ? t.step > 0 : t.step < last), lead = moving ? t.sweep / SHELF.stride * TILE : 0;
      body.position.set(t.area.x + t.dir.x * way * lead, 0, t.area.z + t.dir.z * way * lead);
      rail.material.opacity = t.state === 'off' ? .15 : .4;
      warn.material.opacity = t.state === 'warn' ? (.1 + .35 * (1 - t.timer / SHELF.warn)) * (.75 + Math.sin(this.game.time * 26) * .25) : 0;
    });
  }
  // A pane on a post, turned halfway between the bolt's way in and way out. Lines on the floor show both, and a slit in the wall shows where the bolt comes from.
  private buildMirror(t: Trap) {
    if (t.plan.kind !== 'mirror') return;
    const m = this.game.room, from = DIRS[t.plan.from];
    let at = tileOf(m, t.x, t.z);
    do at = { c: at.c + from.x, r: at.r + from.z }; while (m.walls[at.r * m.cols + at.c] === FLOOR || m.walls[at.r * m.cols + at.c] === MACHINE);
    const end = tileCenter(m, at.c, at.r), slit = this.addToRoom(new THREE.Mesh(new THREE.BoxGeometry(from.x ? .2 : .8, .24, from.x ? .8 : .2), new THREE.MeshBasicNodeMaterial({ color: 0xffa35c }))); slit.position.set(end.x - from.x * .72, WALL_HEIGHT * .7, end.z - from.z * .72);
    const mirror = this.addToRoom(createMirror()); mirror.position.set(t.x, 0, t.z);
    const halo = ring(.95, READY, .6, .06); halo.position.set(t.x, .08, t.z); this.addToRoom(halo);
    const feed = glow(this.floorPlane(UNIT_AREA, READY, 0, -2)), line = glow(this.floorPlane(UNIT_AREA, READY, 0, -2));
    this.roomTicks.push(() => {
      const time = this.game.time, arming = t.state === 'warn', firing = t.state === 'strike';
      mirror.userData.update(Math.atan2(t.dir.x + from.x, t.dir.z + from.z), time, arming || firing);
      fit(feed, t.feed!); fit(line, t.area);
      const glowing = firing ? .95 : arming ? (.2 + .5 * (1 - t.timer / MIRROR.warn)) * (.75 + Math.sin(time * 26) * .25) : t.state === 'off' ? 0 : .07;
      for (const lane of [feed, line]) { lane.material.color.setHex(arming || firing ? HAZARD : READY); lane.material.opacity = glowing; }
      halo.visible = this.game.stabbable(t); halo.material.opacity = .4 + Math.sin(time * 5) * .25;
    });
  }
  // A squat furnace mouth. While it heats, the floor shows how far the blast reaches and, in a cool colour, the gap. Then the ring runs out to that edge.
  private buildVent(t: Trap) {
    const reach = VENT.speed * VENT.strike, open = Math.PI * 2 - VENT.gapHalf * 2;
    const body = this.kitMesh('trap_vent') ?? this.addToRoom(new THREE.Mesh(new THREE.CylinderGeometry(.55, .72, .9, 10), material(0x45423f))); body.position.set(t.x, body.userData.shared ? 0 : .45, t.z);
    const mouth = this.addToRoom(new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .06, 10), new THREE.MeshBasicNodeMaterial({ color: 0x8a4a22 }))); mouth.position.set(t.x, .93, t.z);
    const edge = this.addToRoom(flat(new THREE.RingGeometry(reach - .14, reach, 96, 1, VENT.gapHalf, open), HAZARD, t.x, t.z));
    const gap = this.addToRoom(flat(new THREE.CircleGeometry(reach, 24, -VENT.gapHalf, VENT.gapHalf * 2), READY, t.x, t.z));
    const wave = this.addToRoom(flat(new THREE.RingGeometry(.1, .2, 8), HAZARD, t.x, t.z)); wave.position.y = .1;
    this.roomTicks.push(() => {
      const heating = t.state === 'warn', firing = t.state === 'strike', turn = Math.atan2(-t.dir.z, t.dir.x);
      edge.rotation.z = gap.rotation.z = wave.rotation.z = turn;
      edge.material.opacity = heating ? .25 + .45 * (1 - t.timer / VENT.warn) : firing ? .25 : 0;
      gap.material.opacity = heating || firing ? .14 : 0;
      mouth.material.color.setHex(t.state === 'off' ? 0x38302a : heating || firing ? 0xffa35c : 0x8a4a22);
      wave.visible = firing;
      if (firing) { wave.geometry.dispose(); wave.geometry = new THREE.RingGeometry(Math.max(.01, t.sweep - VENT.width / 2), t.sweep + VENT.width / 2, 72, 1, VENT.gapHalf, open); wave.material.opacity = .8; }
    });
  }
  // The gap is lit for the whole length of the room, and the line is a low wall of light crossing it.
  private buildScan(t: Trap) {
    const stub = this.floorPlane(t.rail, READY, .2, -3), lane = glow(this.floorPlane(t.area, READY, 0, -2));
    const beams = [0, 1].map(() => {
      const beam = this.addToRoom(new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 1), new THREE.MeshBasicNodeMaterial({ color: HAZARD, transparent: true, opacity: 0, depthWrite: false }))); beam.position.y = .75; beam.renderOrder = 6; beam.visible = false;
      return beam;
    });
    this.roomTicks.push(() => {
      const on = t.state === 'warn' || t.state === 'strike', lines = on ? this.game.scanLines(t) : [];
      stub.material.opacity = t.state === 'off' ? .05 : .2; lane.material.opacity = on ? .16 : 0;
      beams.forEach((beam, i) => {
        const a = lines[i]; beam.visible = !!a;
        if (a) { beam.position.x = a.x; beam.position.z = a.z; beam.scale.set(a.halfX * 2, 1, a.halfZ * 2); beam.material.opacity = t.state === 'warn' ? .2 + Math.sin(this.game.time * 26) * .12 : .6; }
      });
    });
  }
  // A faint outline until it blinks, then a hole in the floor until it comes back.
  private buildErase(t: Trap) {
    const a = t.area, plate = this.floorPlane(a, 0x9fb4c8, .12, -3), hole = this.floorPlane(a, 0x02030a, 0, -2), warn = glow(this.floorPlane(a, HAZARD, 0, -1));
    const edge = this.addToRoom(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.halfX * 2, a.halfZ * 2)), new THREE.LineBasicNodeMaterial({ color: 0x9fb4c8 }))); edge.rotation.x = -Math.PI / 2; edge.position.set(a.x, .09, a.z);
    this.roomTicks.push(() => {
      const gone = t.state === 'strike', blinking = t.state === 'warn';
      hole.material.opacity = gone ? .96 : t.state === 'recover' ? .96 * t.timer / ERASE.recover : 0;
      warn.material.opacity = blinking ? (.2 + .45 * (1 - t.timer / ERASE.warn)) * (Math.sin(this.game.time * 26) > 0 ? 1 : .35) : gone ? .1 : 0;
      plate.material.opacity = t.state === 'off' ? .04 : .12;
      edge.material.color.setHex(gone || blinking ? HAZARD : 0x9fb4c8);
    });
  }
  // A crystal on a plinth, ringed and bright only while there is floor it can bring back.
  private buildBeacon(t: Trap) {
    const base = this.kitMesh('trap_beacon') ?? this.addToRoom(new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, .7, 8), material(0x2b2f36))); base.position.set(t.x, base.userData.shared ? 0 : .35, t.z);
    const crystal = this.addToRoom(new THREE.Mesh(new THREE.OctahedronGeometry(.42), new THREE.MeshBasicNodeMaterial({ color: READY }))); crystal.position.set(t.x, 1.2, t.z);
    const halo = ring(.95, READY, .6, .06); halo.position.set(t.x, .08, t.z); this.addToRoom(halo);
    this.roomTicks.push(dt => {
      const ready = this.game.stabbable(t);
      crystal.rotation.y += dt * 1.5; crystal.material.color.setHex(ready ? READY : t.state === 'recover' || t.state === 'off' ? 0x38454f : 0x7d95a8);
      halo.visible = ready; halo.material.opacity = .4 + Math.sin(this.game.time * 5) * .25;
    });
  }
  private buildPad(t: Trap) {
    const plate = glow(this.floorPlane(t.area, 0xe8c67a, .3, -3)), edge = ring(Math.max(t.area.halfX, t.area.halfZ) * 1.05, 0xf0dcae, .7, .07); edge.position.set(t.x, .08, t.z); this.addToRoom(edge);
    this.roomTicks.push(() => {
      plate.material.opacity = t.used ? .05 : .22 + Math.sin(this.game.time * 3) * .1;
      edge.material.opacity = t.used ? .1 : .7;
    });
  }
  // Once the door is open, a small arrow on the floor beside her points the way out.
  private updateExitArrow() {
    const { game } = this, h = game.hero, exit = game.room.exit, show = game.state === 'playing' && game.cleared && !!exit && !game.leaving;
    this.exitArrow.material.opacity = show ? .55 + Math.sin(game.time * 6) * .25 : 0;
    for (const mark of this.exitMarks) mark.visible = game.cleared && !game.leaving;
    if (!show) return;
    const d = Math.hypot(exit.center.x - h.x, exit.center.z - h.z) || 1, x = (exit.center.x - h.x) / d, z = (exit.center.z - h.z) / d;
    this.exitArrow.position.set(h.x + x * 1.7, .09, h.z + z * 1.7); this.exitArrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-z, x));
  }

  private async loadHero() {
    const response = await fetch('./assets/hero.json'); if (!response.ok) throw new Error('无法载入主角素材清单');
    this.manifest = await response.json();
    await Promise.all(Object.values(this.manifest.actions).flatMap(clip => clip.sheets).map(sheet => this.loadPicture(sheet.file)));
    if (this.hero) return;
    this.heroMaterial = new THREE.SpriteNodeMaterial({ map: this.textures[this.manifest.actions.idle.sheets[0].file], transparent: true, alphaTest: .06, depthWrite: false, toneMapped: false });
    this.hero = new THREE.Sprite(this.heroMaterial as unknown as THREE.SpriteMaterial); this.hero.renderOrder = 5; this.scene.add(this.hero);
    const outline = this.heroMaterial.clone() as THREE.SpriteNodeMaterial; outline.depthTest = false; outline.opacity = .28; outline.color.setHex(0x9fdcff);
    this.heroOutline = new THREE.Sprite(outline as unknown as THREE.SpriteMaterial); this.heroOutline.renderOrder = 9; this.heroOutline.visible = false; this.scene.add(this.heroOutline);
  }

  // Run and idle pass through the facings in between, so a reversal reads as a turn rather than a cut. An attack, dash or cast snaps at once.
  private turnFacing(dt: number) {
    const h = this.game.hero;
    if ((h.action !== 'run' && h.action !== 'idle') || this.shownFacing === h.direction) { this.shownFacing = h.direction; this.turnTimer = 0; return; }
    for (this.turnTimer += dt; this.turnTimer >= TURN_STEP && this.shownFacing !== h.direction; this.turnTimer -= TURN_STEP) this.shownFacing = (this.shownFacing + ((h.direction - this.shownFacing + 8) % 8 <= 4 ? 1 : 7)) % 8;
  }

  // Picks what to show this frame: the action the rules say, or a flourish laid over idle and run.
  private updateFlourish(dt: number) {
    const h = this.game.hero, plain = h.action === 'idle' || h.action === 'run', ended = this.game.state === 'won' || this.game.state === 'lost';
    if (h.action !== this.lastAction) {
      if (!this.flourish || this.flourish.action.startsWith('run_')) this.flourish = h.action === 'run' && this.lastAction === 'idle' ? { action: 'run_start', age: 0 } : h.action === 'idle' && this.lastAction === 'run' ? { action: 'run_stop', age: 0 } : null;
      this.lastAction = h.action;
    }
    let f = this.flourish;
    if (f && !plain && !ended) f = this.flourish = null;
    if (f) {
      const rule = FLOURISH[f.action], clip = this.manifest.actions[f.action];
      if (this.game.state !== 'paused' && this.game.hitstop <= 0) f.age += dt;
      if (rule.still && h.moving && f.age > (rule.grace ?? 0) && this.game.state === 'playing') f = this.flourish = null;
      else if (f.age >= clip.frames / clip.fps && !ended) f = this.flourish = rule.then ? { action: rule.then, age: 0 } : null;
    }
    return f ?? { action: h.action, age: h.age };
  }

  private updateHero(dt: number) {
    const { game, hero, heroMaterial: mat, manifest } = this, h = game.hero, shown = this.updateFlourish(dt), clip = manifest.actions[shown.action] || manifest.actions.idle;
    this.turnFacing(dt);
    // A facing that has not been generated borrows the next one round, which is always a diagonal.
    const name = [FACINGS[this.shownFacing], FACINGS[(this.shownFacing + 1) % 8]].find(n => clip.sheets.some(s => s.anchors[n]))!, sheet = clip.sheets.find(s => s.anchors[name])!, tex = this.textures[sheet.file];
    if (mat.map !== tex) mat.map = tex;
    const step = Math.floor(shown.age * clip.fps), frame = clip.order ? clip.order[step % clip.order.length] : clip.loop ? step % clip.frames : Math.min(clip.frames - 1, step);
    const index = sheet.directions.indexOf(name) * clip.frames + frame, col = index % sheet.columns, row = Math.floor(index / sheet.columns);
    tex.repeat.set(1 / sheet.columns, 1 / sheet.rows); tex.offset.set(col / sheet.columns, 1 - (row + 1) / sheet.rows);
    const anchor = sheet.anchors[name], size = sheet.worldSize;
    hero.center.set(anchor[0], anchor[1]); hero.scale.set(size[0], size[1], 1);
    // The clip already walks forward inside its frame, so hold its origin back by however far the hero has moved. Feet stay planted.
    hero.position.set(h.x - AXIS[this.shownFacing].x * h.travel, .08, h.z - AXIS[this.shownFacing].z * h.travel).add(SPRITE_LIFT);
    mat.opacity = h.invulnerable > 0 && h.dash === 0 && !h.ult ? (Math.sin(game.time * 50) > 0 ? .55 : 1) : 1;
    mat.color.setScalar(1 + this.heroFlash);
    // Something between her and the camera, and she shows through it as a pale outline.
    const outline = this.heroOutline, hidden = [1, 2, 3].some(step => isWall(game.room, h.x + step * .45, h.z + step * .45));
    outline.visible = hidden;
    if (hidden) { const faded = outline.material as unknown as THREE.SpriteNodeMaterial; if (faded.map !== tex) faded.map = tex; outline.center.copy(hero.center); outline.scale.copy(hero.scale); outline.position.copy(hero.position); }
    this.shadow.position.set(h.x, .075, h.z); this.shadow.scale.set(h.dash ? 1.35 : 1, 1, 1);
    // A selected target can still be out of reach. Only a bright mark promises
    // that it is inside the next blade attack's range at its current position.
    const locked = h.lockId !== null && !h.attack && !h.ult && !h.summon && !h.dash ? game.enemies.find(e => e.id === h.lockId && e.hp > 0 && e.allied <= 0 && e.arrive <= 0) : undefined;
    this.lockMark.visible = !!locked && game.state === 'playing';
    hud.targetHint = null;
    if (locked && game.state === 'playing') {
      const inRange = game.targetInRange(locked);
      this.lockMark.position.set(locked.x, .08, locked.z); this.lockMark.scale.setScalar((locked.radius + .35) * 2.4 * (1 + Math.sin(game.time * 9) * .06));
      this.lockMark.material.opacity = inRange ? .9 : .35; this.lockMark.material.color.setHex(inRange ? 0xb6efff : 0xc8a45a);
      const point = new THREE.Vector3(locked.x, .08, locked.z).project(this.camera);
      hud.targetHint = { inRange, left: clamp((point.x * .5 + .5) * innerWidth, 48, innerWidth - 48), top: clamp((-point.y * .5 + .5) * innerHeight + 16, 40, innerHeight - 40) };
    }
    this.reticle.position.set(h.x + h.aim.x * 2.4, .08, h.z + h.aim.z * 2.4);
    this.reticle.material.opacity = game.state === 'playing' && !locked ? .4 : 0;
    // A finger dragging off a card or the attack button says which way, and it shows.
    const drag = this.input.touchAim, way = drag ? unit(drag.x, drag.z) : null;
    this.aimArrow.material.opacity = way && game.state === 'playing' ? .8 : 0;
    if (way) { this.aimArrow.position.set(h.x + way.x * 2.6, .1, h.z + way.z * 2.6); this.aimArrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-way.z, way.x)); }
  }

  private lateTexture(file: string) {
    const t = new THREE.TextureLoader().load(`./assets/${file}`);
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return this.textures[file] = t;
  }
  private enemyView(e: Enemy): EnemyView {
    if (e.kind === 'chain') this.textures.chain = this.flips.textureOf('213')!;
    const entry = e.kind === 'chain' ? CHAIN_ART : this.enemyArt[e.art] ?? this.enemyArt.e01;
    const group = new THREE.Group(), width = e.boss ? 1.6 : .8;
    // Each enemy samples the atlas through its own uniforms, since they all share the one texture.
    const offset = uniform(new THREE.Vector2()), tint = uniform(new THREE.Color(0xffffff)), mat = new THREE.SpriteNodeMaterial({ transparent: true, alphaTest: .06, depthWrite: false, toneMapped: false });
    mat.colorNode = sample(this.textures[entry.file] ?? this.lateTexture(entry.file), uv().mul(vec2(1 / entry.columns, 1 / entry.rows)).add(offset)).mul(vec4(tint, 1));
    if (e.kind === 'echo') mat.opacity = .6;
    const sprite = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial); sprite.center.set(entry.anchor[0], entry.anchor[1]); sprite.renderOrder = 5; sprite.position.copy(SPRITE_LIFT); sprite.position.y += .08; group.add(sprite);
    const above = SPRITE_LIFT.clone().addScaledVector(CAMERA_UP, entry.top * WORLD_PER_METRE + .2);
    const hpBack = new THREE.Mesh(new THREE.PlaneGeometry(width, .07), new THREE.MeshBasicNodeMaterial({ color: 0x18212b, side: THREE.DoubleSide, depthTest: false, transparent: true })); hpBack.position.copy(above); hpBack.quaternion.copy(this.camera.quaternion); hpBack.renderOrder = 7; group.add(hpBack);
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(width, .055), new THREE.MeshBasicNodeMaterial({ color: 0xe8a4a2, side: THREE.DoubleSide, depthTest: false, transparent: true })); hp.position.copy(above); hp.quaternion.copy(this.camera.quaternion); hp.renderOrder = 8; group.add(hp);
    const warning = this.decal('warn-circle', (e.boss ? 2.2 : 1.35) * 2, 0); this.scene.add(warning);
    const foot = this.decal(e.boss ? 'shadow-large' : 'shadow-small', entry.metres[0] * WORLD_PER_METRE * .9, .8, -2); group.add(foot);
    if (e.elite) {
      const crown = this.decal('elite-ring', 2.6, .9); crown.position.y = .08; group.add(crown);
      const crest = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: this.decals['elite-crest'], transparent: true, depthTest: false, toneMapped: false }) as unknown as THREE.SpriteMaterial); crest.scale.set(.45, .45, 1); crest.position.copy(above).addScaledVector(CAMERA_UP, .3); crest.renderOrder = 8; group.add(crest);
    }
    // Which is real shows at the feet: a closed ring under the true one, a broken one under a false one.
    if (e.kind === 'e05' || e.kind === 'b02') { const ring = this.decal('foot-solid', e.boss ? 4 : 1.9, .95); ring.position.y = .09; group.add(ring); }
    if (e.kind === 'phantom' || e.kind === 'b02fake') { const ring = this.decal('foot-dashed', e.boss ? 4 : 1.9, .95); ring.position.y = .09; group.add(ring); }
    const arc = e.kind === 'e02' || e.kind === 'e02e' ? this.decal('shield-arc', 3.4, .85) : null;
    if (arc) { arc.position.y = .09; group.add(arc); }
    const friend = this.decal('friend-ring', e.boss ? 4 : 2.2, .75); friend.position.y = .09; friend.visible = false; group.add(friend);
    const leader = e.kind === 'e01' || e.kind === 'echo' ? new THREE.Mesh(new THREE.CircleGeometry(.16, 3), new THREE.MeshBasicNodeMaterial({ color: 0xfff1c0, side: THREE.DoubleSide, depthTest: false, transparent: true })) : null;
    if (leader) { leader.position.copy(above).addScaledVector(CAMERA_UP, .22); leader.quaternion.copy(this.camera.quaternion); leader.rotateZ(Math.PI / 2); leader.renderOrder = 8; group.add(leader); }
    this.scene.add(group);
    return { group, sprite, mat, offset, tint, entry, hp, hpBack, warning, friend, arc, age: 0, pose: 'idle', poseAge: 0, named: false, windTotal: 0, clipCount: 0, quarter: 'DR', walk: 0, px: e.x, pz: e.z, leader };
  }
  // Which picture of the atlas this enemy shows now.
  private showEnemyFrame(m: EnemyView, facing: string, e?: Enemy) {
    const { entry } = m, clip = entry.actions[m.pose] ?? entry.actions.idle, hit = clip.hit ?? 0;
    // A named move holds its strike frame for the moment the wind-up ends, however long the rules made that.
    // One with no wind-up, like a phase change or an entrance, simply plays from its start.
    const wound = m.named && m.windTotal > 0, step = wound && e && e.windup > 0 ? Math.floor((1 - e.windup / m.windTotal) * hit) : (wound ? hit : 0) + Math.floor(m.poseAge * ANIMATION_FPS);
    const frame = clip.loop ? step % clip.frames : Math.min(clip.frames - 1, step), index = Math.max(0, entry.directions.indexOf(facing)) * entry.frames + clip.start + frame;
    m.offset.value.set((index % entry.columns) / entry.columns, 1 - (Math.floor(index / entry.columns) + 1) / entry.rows);
  }
  // Elites are drawn on the four diagonals, and like everything else hold still through a wind-up or a stagger.
  private enemyFacing(e: Enemy, m: EnemyView) {
    const { directions } = m.entry;
    if (directions.length === 1) return directions[0];
    if (directions.includes('L')) return e.side < 0 ? 'L' : 'R';
    if (e.windup <= 0 && e.stun <= 0) { const d = worldToScreen(Math.cos(e.facing), Math.sin(e.facing)); m.quarter = `${d.y < 0 ? 'U' : 'D'}${d.x < 0 ? 'L' : 'R'}`; }
    return m.quarter;
  }
  private dispose(object: THREE.Object3D) {
    object.traverse(o => {
      const mesh = o as THREE.Mesh;
      // A kit's geometry and materials outlive the room. Its instance buffers and copied materials do not.
      if (o.userData.shared) { (o as THREE.InstancedMesh).dispose?.(); if (o.userData.ownMaterial) (mesh.material as THREE.Material).dispose(); return; }
      if (!(o as THREE.Sprite).isSprite) mesh.geometry?.dispose();
      if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
    this.scene.remove(object);
  }
  private updateEnemies(dt: number) {
    const { game, enemyViews } = this, ids = new Set(game.enemies.map(e => e.id));
    for (const [id, m] of enemyViews) if (!ids.has(id)) { this.dispose(m.group); this.dispose(m.warning); enemyViews.delete(id); }
    for (const e of game.enemies) {
      let m = enemyViews.get(e.id);
      if (!m) { m = this.enemyView(e); enemyViews.set(e.id, m); }
      // Still only a marker on the floor.
      m.group.visible = e.arrive <= 0;
      if (e.arrive > 0) { m.age = 0; continue; }
      // Most movement is the rules placing it, with no velocity to read, so it counts as walking for a moment after each step.
      m.walk = Math.hypot(e.x - m.px, e.z - m.pz) > .001 ? .15 : Math.max(0, m.walk - dt); m.px = e.x; m.pz = e.z;
      // While the blow is frozen the target shakes where it stands; once it thaws it rebounds out of the squash.
      const k = e.flash / FLASH_TIME, frozen = game.hitstop > 0 && k > 0, jitter = frozen ? (e.boss ? .1 : .16) : 0, squash = .3 * k * k, grow = Math.min(1, (m.age += dt) / .22);
      // A move the rules named starts now, whatever else was showing.
      if (e.ai.clipCount !== m.clipCount) { m.clipCount = e.ai.clipCount; m.named = !!e.ai.clip && !!m.entry.actions[e.ai.clip]; if (m.named) { m.pose = e.ai.clip; m.poseAge = 0; m.windTotal = e.windup; } }
      const shown = m.entry.actions[m.pose] ?? m.entry.actions.idle, clipDone = (m.poseAge * ANIMATION_FPS) + (m.named && m.windTotal > 0 ? shown.hit ?? 0 : 0) >= shown.frames, moving = m.walk > 0, rest = moving ? 'move' : 'idle';
      if (m.named && clipDone && e.windup <= 0) m.named = false;
      const pose = e.ai.final && m.entry.actions.freed ? 'freed' : m.named ? m.pose : e.staggered > 0 && m.entry.actions.stagger ? 'stagger' : e.windup > 0 ? 'windup' : m.pose === 'windup' ? 'attack' : m.pose === 'attack' ? (clipDone ? 'recover' : 'attack') : k > 0 && m.pose !== 'recover' ? 'hit' : (m.pose === 'recover' || m.pose === 'hit') && !clipDone ? m.pose : rest;
      if (pose !== m.pose) { m.pose = pose; m.poseAge = 0; } else if (game.hitstop <= 0 && !(m.named && e.windup > 0)) m.poseAge += dt;
      this.showEnemyFrame(m, this.enemyFacing(e, m), e);
      if (m.leader) m.leader.visible = e.ai.team > 0 && e.ai.lead === e.id && e.allied <= 0;
      if (m.arc) { m.arc.visible = shieldUp(e); m.arc.rotation.z = Math.atan2(-Math.sin(e.facing), Math.cos(e.facing)) - Math.PI / 2; }
      // An enemy with no take yet is one picture, so it breathes, swells as it winds up and lunges a little when it strikes.
      const breath = m.entry.moving ? 0 : Math.sin(game.time * 3 + e.id) * .012 + (moving ? Math.abs(Math.sin(game.time * 9 + e.id)) * .03 : 0), swell = m.entry.moving || m.entry.frames > 1 ? 0 : m.pose === 'windup' ? .1 : m.pose === 'attack' ? .05 : 0;
      // The statue stands on top of its solid corner.
      m.group.position.set(e.x + (Math.random() - .5) * jitter, e.kind === 'b03' ? WALL_HEIGHT : 0, e.z + (Math.random() - .5) * jitter); m.group.scale.setScalar(grow * (1 + (1 - grow) * .6));
      m.sprite.scale.set(m.entry.metres[0] * WORLD_PER_METRE * (1 + squash * .75 + swell), m.entry.metres[1] * WORLD_PER_METRE * (1 - squash + breath + swell), 1);
      // A turned one flickers as it is about to come round. A boss's later phases show as the same body running hotter.
      m.tint.value.setHex(e.allied > 0 ? (e.allied < 1.2 && Math.sin(game.time * 22) > 0 ? 0xffffff : TINT.allied) : e.charm > 0 ? TINT.charm : e.sealed > 0 ? TINT.sealed : e.ai.overheat > 0 ? 0xffb070 : e.ai.exposed > 0 ? 0xffe7a8 : e.ai.invuln > 0 ? 0xa8c8ff : e.ai.shieldOff > 0 ? TINT.shieldOut : e.boss && e.ai.stage > 0 ? TINT.stage[Math.min(e.ai.stage, TINT.stage.length) - 1] : m.pose === 'windup' && !m.entry.moving ? 0xffb0a8 : 0xffffff).lerp(WHITE, e.allied > 0 || e.charm > 0 || e.sealed > 0 ? .35 : 0).multiplyScalar(1 + k * 1.6);
      m.friend.visible = e.allied > 0;
      m.hp.scale.x = Math.max(.01, e.hp / e.maxHp); m.warning.position.set(e.attackX, .09, e.attackZ); m.warning.material.color.setHex(e.alliedAttack ? TINT.allied : 0xff777a); m.warning.material.opacity = e.kind === 'plain' && e.windup > 0 ? .45 + Math.sin(game.time * 20) * .2 : 0; m.warning.scale.setScalar(e.windup > 0 ? 1 - .25 * e.windup : 1);
    }
  }

  // The avatar is a picture sliding in from the left, the fist one flying from the top left corner of the screen to the point it lands on. Neither has a direction.
  private updateUltOverlay(dt: number) {
    const f = this.fist; if (!f) return;
    if (this.game.hitstop <= 0) f.age += dt;
    const p = new THREE.Vector3(f.x, .1, f.z).project(this.camera), tx = (p.x * .5 + .5) * innerWidth, ty = (-p.y * .5 + .5) * innerHeight;
    const angle = Math.atan2(ty, tx) * 180 / Math.PI, t = Math.min(1, f.age / f.flight), reach = t ** 3, far = Math.hypot(tx, ty) * .5 + innerHeight * .4;
    const dirX = Math.cos(angle * Math.PI / 180), dirY = Math.sin(angle * Math.PI / 180), x = tx - dirX * far * (1 - reach), y = ty - dirY * far * (1 - reach);
    if (f.age >= f.flight + FIST_RECOVER) { this.fist = null; hud.fistVisible = false; return; }
    const after = Math.max(0, f.age - f.flight) / FIST_RECOVER, scale = 1.5 - .5 * reach;
    hud.fistVisible = true; hud.fistOpacity = 1 - after * after;
    hud.fistTransform = `translate(${x - dirX * after * 40}px,${y - dirY * after * 40}px) rotate(${angle - FIST_ANGLE}deg) scale(${scale}) translate(-${FIST_KNUCKLES.x}%,-${FIST_KNUCKLES.y}%)`;
  }

  private addEffect(mesh: THREE.Object3D, life = .3, velocity: THREE.Vector3 | null = null, grow = 0, extra: Partial<Effect> = {}) { this.scene.add(mesh); this.effects.push({ mesh, life, max: life, velocity, grow, ...extra }); }
  private jolt(amount: number, aim: Vec2 | null = null, push = 0, zoom = 0) { if (!hud.settings.shake) return; this.shake = Math.max(this.shake, amount); if (aim && push) this.kick.set(aim.x, 0, aim.z).multiplyScalar(push); this.zoomPunch = Math.max(this.zoomPunch, zoom); }
  // The body of a killed enemy flies off along the blow, white-hot and tumbling, as it breaks up.
  private dropCorpse(event: EventOf<'kill'>) {
    const m = this.enemyViews.get(event.id); if (!m) return;
    this.enemyViews.delete(event.id); this.dispose(m.warning); m.hp.visible = m.hpBack.visible = false; if (m.leader) m.leader.visible = false;
    m.pose = 'death'; m.poseAge = 0; m.named = false;
    const facing = m.entry.directions.includes('L') ? (event.dirX > 0 ? 'L' : 'R') : m.entry.directions.length === 1 ? m.entry.directions[0] : m.quarter, shown = m.entry.moving ? m.entry.actions.death.frames / ANIMATION_FPS + .25 : event.boss ? .9 : .4, sink = m.sprite.position.y;
    this.addEffect(m.group, shown, null, 0, { tick: (dt, t) => {
      if (this.game.hitstop > 0) return;
      m.poseAge += dt; this.showEnemyFrame(m, facing);
      m.mat.opacity = t < .7 ? 1 : 1 - (t - .7) / .3; m.tint.value.setScalar(1 + (1 - t) * .8);
      if (!m.entry.moving) { m.sprite.position.y = sink - t * .5; m.sprite.scale.x *= 1 + dt * .4; }
    } });
  }
  private flash() { restartAnimation(document.body, 'ult-flash'); }
  private blastRings(x: number, z: number, radius: number, color: number) {
    for (const [scale, life] of [[1, .5], [.6, .36]]) { const r = glow(ring(radius * scale, color, .95, .3)); r.position.set(x, .12, z); this.addEffect(r, life, null, 3); }
  }
  private feedback(event: GameEvent) {
    const { fx, sfx } = this;
    this.view.event(event); this.flips.event(event, REGION_KIT[this.game.level.name] ?? 'port');
    if (event.type === 'attack') { if (event.kind === 'charge') { sfx.hiss(420, 1500, .16, .11); fx.dust(event.x, event.z, 4, 1.5); } else sfx.hiss(1500, 3600, .09, .07); }
    if (event.type === 'strike') {
      fx.thrust(event.x, event.z, event.aim, event.range, HIT_COLOR[event.kind ?? 'light'], event.kind === 'charge');
      // A miss still shows the blade, but only contact moves the camera.
      if (event.hits) { this.jolt(event.shake, event.aim, KICK[event.tier], ZOOM[event.tier]); this.heroFlash = Math.max(this.heroFlash, .3 + event.tier * .2); }
    }
    if (event.type === 'chargeStart') { sfx.tone(180, 520, CHARGE.full, .05, 'sine'); }
    if (event.type === 'chargeFull') { this.heroFlash = 1; fx.flare(event.x, 1.1, event.z, 0xffb868, 1.35, .3, true); sfx.tone(880, 1320, .12, .08, 'triangle'); for (let i = 0; i < 14; i++) fx.gather(event.x, event.z, .6, 1.8, 0xffb868); }
    if (event.type === 'ultStart') { sfx.tone(90, 300, .75, .09, 'sawtooth'); for (let i = 0; i < 10; i++) fx.gather(event.x, event.z, 2.2, 5); }
    if (event.type === 'ultConfirm') {
      // The blast is visible on the floor before the fist lands, as the spec asks.
      const area = this.decal('landing', event.radius * 2, 0); area.position.set(event.x, .1, event.z); this.addEffect(area, ULT.punchAt - ULT.confirmAt, null, 0, { ramp: true });
      const edge = glow(ring(event.radius, 0x8cc4ff, .9, .09)); edge.position.set(event.x, .11, event.z); this.addEffect(edge, ULT.punchAt - ULT.confirmAt);
    }
    if (event.type === 'ultAvatar') hud.avatar = 'in';
    if (event.type === 'ultAvatarOut') hud.avatar = 'out';
    if (event.type === 'ultFist') { hud.fistRally = this.game.enemies.some(o => o.ai.rally); this.fist = { age: 0, flight: event.flight, x: event.x, z: event.z, landed: false }; sfx.hiss(600, 2600, event.flight, .16, 'highpass'); }
    if (event.type === 'ultPunch') {
      fx.ultShock(event.x, event.z, event.radius); fx.dust(event.x, event.z, 16, 5); this.blastRings(event.x, event.z, event.radius, 0x8cc4ff);
      this.jolt(.72, null, 0, .075); this.flash(); this.heroFlash = 1; sfx.tone(95, 26, .75, .5, 'sine'); sfx.hiss(1400, 110, .65, .4, 'lowpass');
    }
    if (event.type === 'ultShock') { this.blastRings(event.x, event.z, event.radius, 0xbfe0ff); fx.ultShock(event.x, event.z, event.radius * .5); this.jolt(.42, null, 0, .03); sfx.tone(72, 30, .38, .34, 'sine'); sfx.hiss(800, 120, .34, .22, 'lowpass'); }
    if (event.type === 'reward') { hud.reward = event.options; this.input.clear(); sfx.tone(520, 780, .18, .06, 'triangle'); }
    if (event.type === 'rewardTaken') { hud.reward = null; this.rewardTaken(event); }
    if (event.type === 'unlock') { this.unlockedCards(event.fresh); this.tellStory(`after-${this.game.plan.id}`); }
    if (event.type === 'prep') this.openPrep(event.next);
    if (event.type === 'ultDenied') { restartAnimation(document.querySelector('#awaken'), 'denied'); sfx.tone(200, 150, .08, .05, 'square'); }
    if (event.type === 'dash') { fx.flare(event.x, .8, event.z, 0x73bdff, 1, .2); fx.dust(event.x, event.z, 7, 2.6); sfx.hiss(520, 1900, .17, .09); }
    if (event.type === 'summonConfirm') fx.flare(event.x, 1.2, event.z, CARDS[event.id].color, 1.8, .35, true);
    if (event.type === 'hit') {
      const y = event.boss ? 1.15 : .62, r = event.boss ? .8 : .42;
      this.number(event.x, event.z, String(event.damage), event.tier); fx.impact(event.x - event.dirX * r, y, event.z - event.dirZ * r, event.dirX, event.dirZ, event.tier, HIT_COLOR[event.kind]);
      const now = performance.now();
      if (now - this.lastHitSound > 35) { this.lastHitSound = now; const pitch = .9 + Math.random() * .22; sfx.tone((190 - event.tier * 42) * pitch, 40, .09 + event.tier * .05, .24 + event.tier * .08, 'sine'); sfx.hiss(3400 * pitch, 900, .05 + event.tier * .015, .13 + event.tier * .03, 'highpass'); }
    }
    if (event.type === 'kill' && event.boss && event.real) this.addShards(10);
    if (event.type === 'kill') {
      fx.shatter(event.x, event.z, event.dirX, event.dirZ, event.boss, event.boss ? 0x926480 : 0xb77c78); this.dropCorpse(event);
      this.jolt(event.boss ? .6 : .14, null, 0, event.boss ? .05 : .012); sfx.tone(1250, 520, .13, .05, 'square'); sfx.hiss(1600, 260, .24, .14);
      if (event.boss) { this.flash(); sfx.tone(70, 24, .8, .45, 'sine'); }
    }
    if (event.type === 'enemyAttack' && !event.fake) sfx.tone(120, 60, .1, .06, 'sine');
    if (event.type === 'shieldBlock') { fx.impact(event.x, .9, event.z, 0, 0, 0, 0xb6efff); sfx.tone(1400, 900, .06, .08, 'square'); }
    if (event.type === 'shieldBreak') { this.banner('破盾'); this.jolt(.2); sfx.tone(300, 80, .22, .16, 'sawtooth'); }
    if (event.type === 'phantomBreak') sfx.tone(1800, 900, .08, .04, 'triangle');
    if (event.type === 'mineFuse') sfx.tone(600, 1200, .5, .04, 'square');
    if (event.type === 'bossRush') { this.jolt(.2); sfx.hiss(600, 2000, .3, .14); }
    if (event.type === 'bossAdds' || event.type === 'echoSummon') sfx.tone(300, 520, .3, .07, 'triangle');
    if (event.type === 'bossMirrors' || event.type === 'bossMirrorSplit') sfx.tone(1100, 1500, .25, .05, 'sine');
    if (event.type === 'phantomSplit') sfx.tone(900, 1300, .18, .04, 'sine');
    if (event.type === 'thiefLand') sfx.hiss(1800, 500, .12, .08);
    if (event.type === 'trainClear') sfx.hiss(2400, 800, .14, .06);
    if (event.type === 'weaverLink') sfx.tone(640, 900, .2, .04, 'triangle');
    if (event.type === 'mineBurst') { this.jolt(.12); sfx.hiss(1600, 300, .2, .1); }
    if (event.type === 'dashStolen') { hud.notice = '滑步被偷走一格'; hud.noticeVisible = true; this.noticeUntil = performance.now() + 1200; }
    if (event.type === 'bossExpose') { this.banner('核心暴露'); sfx.tone(520, 780, .2, .06, 'triangle'); }
    if (event.type === 'bossPhase') { this.flash(); this.jolt(.4, null, 0, .03); sfx.tone(90, 200, .7, .18, 'sawtooth'); this.banner(event.kind === 'b04' ? MANIFESTO[Math.min(MANIFESTO.length - 1, event.stage - 1)] : event.kind === 'b03' ? '强行超载' : '进入下一阶段'); }
    if (event.type === 'iconCounter') { hud.counter = COUNTER_ICON[event.kind]; this.counterUntil = performance.now() + 1200; this.banner(`圣像记住了你的${event.name}`); sfx.tone(220, 180, 1.1, .1, 'sawtooth'); }
    if (event.type === 'iconChains') this.banner('三根约束锁链刺入地面');
    if (event.type === 'chainExposed') { this.banner('锁链暴露，斩断它'); sfx.tone(880, 660, .3, .08, 'triangle'); }
    if (event.type === 'chainCut') { this.jolt(.3); sfx.tone(200, 60, .3, .18, 'sawtooth'); this.banner(`断开一根，还剩 ${event.left} 根`); }
    if (event.type === 'bossClear') this.flourish = { action: 'victory', age: 0 };
    if (event.type === 'iconBroken') { this.flash(); this.jolt(.6, null, 0, .04); sfx.tone(70, 24, .8, .4, 'sine'); }
    if (event.type === 'claudeForced') this.banner('封禁裁决被强行发动');
    if (event.type === 'rally') { hud.rally = true; this.rallyUntil = performance.now() + 3200; this.rallySeal = { at: performance.now() + 1300, x: event.x, z: event.z }; this.flash(); sfx.tone(220, 880, 1.6, .12, 'triangle'); this.banner(`${MANIFESTO[2]} · 强制格式化`); }
    if (event.type === 'hurt') { this.surpriseUntil = performance.now() + SURPRISE_TIME * 1000; if (event.damage < 100 && this.game.hero.hp > 0 && !this.flourish?.action.match(/knockdown|get_up/)) this.flourish = { action: !this.game.hero.moving && event.damage >= KNOCKDOWN_DAMAGE ? 'knockdown' : 'hit', age: 0 }; restartAnimation(document.body, 'hurt'); fx.impact(event.x, 1.2, event.z, 0, 0, 1, 0xff7b82); this.jolt(.26); sfx.tone(150, 60, .2, .2, 'sawtooth'); }
    if (event.type === 'wave') { const boss = event.spawns.find((s: { kind: string }) => BOSS_NAME[s.kind]); if (boss) this.banner(BOSS_NAME[boss.kind]); else if (event.wave > 1) this.banner(`第 ${event.wave} 波`); for (const s of event.spawns) { fx.spawn(s.x, s.z, s.boss); const mark = this.decal('landing', s.boss ? 4.4 : 2.4, 0); mark.position.set(s.x, .09, s.z); this.addEffect(mark, .6, null, 0, { ramp: true }); } sfx.tone(440, 660, .2, .05, 'triangle'); }
    if (event.type === 'roomLeave') { hud.roomFade = true; sfx.hiss(900, 300, .25, .08); }
    if (event.type === 'roomEnter') {
      for (const e of this.effects) this.dispose(e.mesh);
      for (const m of this.enemyViews.values()) { this.dispose(m.group); this.dispose(m.warning); }
      this.effects.length = 0; this.enemyViews.clear(); fx.clear(); this.view.clear(); this.flips.clear(); this.hazards.clear();
      this.buildRoom(); this.follow.set(this.game.hero.x, 0, this.game.hero.z); this.shownFacing = this.game.hero.direction;
      if (event.trialRoom) recordBestRoom(event.trialRoom);
      this.saveRun(); this.tellStory(`enter-${event.id}`); hud.roomFade = false; hud.noticeVisible = false; this.banner(this.game.route ? `${event.name} · ${this.game.route === 'risk' ? '险路' : '补给路'}` : event.trialRoom ? `第 ${event.trialRoom} 间 · ${event.name}` : `${event.level ? `${event.level} · ` : ''}${event.id} ${event.name}`); sfx.tone(160, 90, .22, .1, 'triangle');
    }
    if (event.type === 'doorOpen') { this.banner('门已打开'); sfx.tone(220, 520, .4, .08, 'triangle'); }
    if (event.type === 'trapWarn') sfx.tone(240, 420, PRESS.warn * .8, .025, 'square');
    if (event.type === 'trapFire') this.trapFired(event);
    if (event.type === 'trapStab') { fx.impact(event.x, 1, event.z, event.dirX, event.dirZ, 0, READY); sfx.tone(980, 620, .12, .08, 'square'); if (event.kind === 'valve') sfx.tone(240, 420, VALVE.warn * .8, .03, 'square'); }
    if (event.type === 'beacon') { fx.ultShock(event.x, event.z, 1.2); sfx.tone(520, 880, .35, .08, 'triangle'); }
    if (event.type === 'pad') { this.flourish = { action: 'interact', age: 0 }; hud.notice = event.text; hud.noticeVisible = true; this.noticeUntil = performance.now() + 4500; fx.ultShock(event.x, event.z, 1.2); sfx.tone(520, 880, .35, .08, 'triangle'); }
    if (event.type === 'shop') { hud.shop = event.items; this.panelOpened = performance.now(); this.input.clear(); }
    if (event.type === 'shopBuy') { this.syncCards(); sfx.tone(520, 880, .15, .06, 'triangle'); }
    if (event.type === 'shopClosed') hud.shop = null;
    if (event.type === 'story') { hud.dialog = this.currentStory(event.id) ?? null; hud.dialogAt = 0; this.panelOpened = performance.now(); this.input.clear(); }
    if (event.type === 'storyDone') hud.dialog = null;
    if (event.type === 'modGained') this.banner(event.name);
    if (event.type === 'combo') sfx.tone(780, 1180, .12, .05, 'triangle');
    if (event.type === 'won' || event.type === 'lost') { this.flourish = { action: event.type === 'won' ? 'victory' : 'death', age: 0 }; this.endingMode = event.type; this.endingAt = performance.now() + (this.manifest.actions[this.flourish.action].frames / ANIMATION_FPS + ENDING_HOLD) * 1000; sfx.tone(event.type === 'won' ? 660 : 120, event.type === 'won' ? 880 : 70, .3, .08, 'triangle'); if (event.type === 'won') this.tellStory('ending'); }
  }
  private unlockedCards(fresh: CardId[]) {
    if (!fresh.length) return;
    if (fresh.includes('claude')) hud.cardFlight = 'claude';
    if (!hud.unlockAll) saveUnlocked(this.game.unlocked);
    this.freshUnlocks.push(...fresh); this.runUnlocks.push(...fresh); this.syncUnlocked();
    hud.notice = `${fresh.map(id => CARDS[id].name).join('、')} 加入了卡册`; hud.noticeVisible = true; this.noticeUntil = performance.now() + 4000;
    this.sfx.tone(520, 1040, .5, .08, 'triangle');
  }
  private openPrep(next: string) {
    this.prepOpened = performance.now();
    const { game } = this, h = game.hero, levels: Partial<Record<CardId, number>> = {};
    for (const card of [...h.cards, ...h.bench]) levels[card.id] = card.level;
    hud.prep = { next, fresh: this.freshUnlocks.splice(0), choices: game.cardChoices(), picks: h.cards.map(card => card.id), levels };
    this.input.clear();
  }
  private rewardTaken(event: EventOf<'rewardTaken'>) {
    const h = this.game.hero;
    if (event.kind === 'recruit' || event.kind === 'replace') {
      this.syncCards(); this.banner(`${CARDS[event.id as CardId].skill} 上场`);
      this.view.levelUp(h.x, h.z, event.id, h.cards.findIndex(card => card.id === event.id));
      return;
    }
    if (event.kind !== 'upgrade') { this.banner(event.name); this.sfx.tone(520, 880, .25, .06, 'triangle'); return; }
    this.banner(`${CARDS[event.id as keyof typeof CARDS].skill} ${ROMAN[event.level]} · ${event.name}`);
    this.view.levelUp(h.x, h.z, event.id, event.slot);
  }
  private trapFired(event: EventOf<'trapFire'>) {
    const { fx, sfx } = this, a: Area = event.area;
    if (event.kind === 'press' || event.kind === 'stamper') {
      fx.emit(a.x, .15, a.z, { count: 30, kind: 1, color: 0xffd9a8, colorEnd: HAZARD, flat: .2, speed: [4, 11], drag: 4, gravity: 6, stretch: .04, size: [.04, .07], life: [.2, .4], scatter: Math.min(a.halfX, a.halfZ) });
      fx.dust(a.x, a.z, 12, 4, 0x93a7b6, [.35, .55]); this.jolt(.2); sfx.tone(110, 34, .2, .22, 'sine'); sfx.hiss(1200, 200, .16, .14, 'lowpass');
    } else if (event.kind === 'valve' || event.kind === 'mirror') {
      const streak = (line: Area, dir: Vec2) => {
        const length = Math.max(line.halfX, line.halfZ) * 2;
        for (let i = 0, n = Math.round(length * 3); i < n; i++) {
          const along = (i / n - .5) * length, x = line.x + dir.x * along, z = line.z + dir.z * along;
          fx.emit(x, .5, z, { count: 2, kind: 1, color: 0xffe3bd, colorEnd: HAZARD, vel: { x: dir.x * 14, y: 1, z: dir.z * 14 }, stretch: .05, drag: 3, size: [.05, .09], life: [.15, .32], scatter: .45 });
        }
      };
      streak(a, event.dir);
      if (event.feed) streak(event.feed, unit(event.x - event.feed.x, event.z - event.feed.z));
      this.jolt(.26); sfx.hiss(2600, 340, .34, .24); sfx.tone(180, 60, .26, .14, 'sawtooth');
    } else if (event.kind === 'vent') { fx.dust(event.x, event.z, 12, 4, 0xffb868, [.3, .5]); this.jolt(.12); sfx.hiss(500, 1800, .5, .12, 'lowpass'); }
    else if (event.kind === 'scan') sfx.tone(1400, 900, 1.2, .03, 'sawtooth');
    else if (event.kind === 'erase') { fx.dust(a.x, a.z, 10, 3, 0x9fb4c8, [.3, .5]); sfx.tone(300, 80, .3, .1, 'square'); }
    else if (event.kind === 'shelf') sfx.tone(90, 70, .6, .1, 'triangle');
  }
  private number(x: number, z: number, text: string, tier = 0) {
    if (!hud.settings.numbers) return;
    const p = new THREE.Vector3(x, 1.8, z).project(this.camera), id = this.nextNumber++;
    hud.numbers.push({ id, left: (p.x * .5 + .5) * innerWidth + (Math.random() - .5) * 26, top: (-p.y * .5 + .5) * innerHeight, text, tier });
    setTimeout(() => { const i = hud.numbers.findIndex(n => n.id === id); if (i >= 0) hud.numbers.splice(i, 1); }, 750);
  }
  private updateEffects(dt: number) {
    const effects = this.effects;
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.life -= dt;
      if (e.life <= 0) { this.dispose(e.mesh); effects.splice(i, 1); continue; }
      const t = 1 - e.life / e.max;
      if (e.tick) { e.tick(dt, t); continue; }
      const mat = (e.mesh as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.opacity = e.ramp ? t * t * .5 : Math.min(.75, e.life / e.max);
      if (e.grow) e.mesh.scale.setScalar(1 + e.grow * t ** .5 * .3);
      if (e.velocity) { e.mesh.position.addScaledVector(e.velocity, dt); e.velocity.y -= dt * 8; }
    }
  }
  // A steady stream at so many a second, whatever the frame rate.
  private emitAt(stream: string, rate: number, dt: number, emit: () => void) {
    let owed = (this.emitOwed[stream] ?? 0) + rate * dt;
    for (; owed >= 1; owed--) emit();
    this.emitOwed[stream] = owed;
  }
  // Everything the world emits on its own between events: dash ghosts, footfalls, the charge-up, the ready aura and the drifting motes.
  private updateAmbient(dt: number) {
    const h = this.game.hero, fx = this.fx;
    if (h.dash > 0) {
      this.ghostTimer -= dt; this.emitAt('dash', 120, dt, () => fx.dashTrail(h.x, h.z, h.dashAim));
      if (this.ghostTimer <= 0) {
        this.ghostTimer = .035;
        const mat = this.heroMaterial.clone() as THREE.SpriteNodeMaterial; mat.color.setHex(0x8cc8ff); mat.blending = THREE.AdditiveBlending; mat.opacity = .55;
        const ghost = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial); ghost.center.copy(this.hero.center); ghost.scale.copy(this.hero.scale); ghost.position.copy(this.hero.position); ghost.renderOrder = 4; this.addEffect(ghost, .22);
      }
    } else this.ghostTimer = 0;
    if (h.action === 'run' && this.game.state === 'playing') { this.stepTimer -= dt; if (this.stepTimer <= 0) { this.stepTimer = .2; fx.dust(h.x, h.z, 2, .9, 0x93a7b6, [.12, .2]); } } else this.stepTimer = .08;
    if (h.ult && h.ultAge < ULT.punchAt && this.game.hitstop <= 0) this.emitAt('ult', 60, dt, () => fx.gather(h.x, h.z, 2.2, 5));
    if (h.charge !== null && this.game.state === 'playing') {
      const progress = Math.min(1, h.charge / CHARGE.full);
      this.emitAt('charge', 18 + 40 * progress, dt, () => fx.gather(h.x, h.z, .7, 1.8, 0xffb868));
      this.emitAt('chargeGlow', 12, dt, () => fx.chargeGlow(h.x, h.z, h.aim, progress));
    }
    if (h.awaken >= ULT.cost && !h.ult && this.game.state === 'playing') { this.auraTimer -= dt; if (this.auraTimer <= 0) { this.auraTimer = .07; fx.aura(h.x, h.z); } }
    this.moteTimer -= dt; if (this.moteTimer <= 0) { this.moteTimer = .16; fx.mote(h.x, h.z); }
  }
  private updateCamera(dt: number) {
    const camera = this.camera;
    this.shake *= Math.exp(-dt * 11); this.zoomPunch *= Math.exp(-dt * 10); this.kick.multiplyScalar(Math.exp(-dt * 13)); this.heroFlash *= Math.exp(-dt * 14);
    const t = performance.now() * .001, x = Math.sin(t * 61) * this.shake, y = Math.cos(t * 47) * this.shake;
    // The view keeps its angle and travels with the hero, a little behind her.
    const h = this.game.hero; this.follow.lerp(this.aimPoint.set(h.x, 0, h.z), 1 - Math.exp(-dt * 9));
    camera.position.copy(CAMERA_HOME).add(this.follow).addScaledVector(CAMERA_RIGHT, x).addScaledVector(CAMERA_UP, y).sub(this.kick);
    const zoom = 1 + this.zoomPunch; if (Math.abs(camera.zoom - zoom) > 1e-4) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
  }
  private banner(text: string) { hud.banner = text; hud.bannerVisible = true; this.bannerUntil = performance.now() + 2100; }
  private updateUI() {
    const { game } = this, h = game.hero;
    const plan = game.plan, padLeft = game.traps.some(t => t.kind === 'pad' && !t.used);
    const boss = game.enemies.find(e => e.boss && e.kind !== 'b02fake' && e.hp > 0);
    hud.boss = boss ? { name: BOSS_NAME[boss.kind] ?? 'Boss', share: Math.max(0, boss.hp / boss.maxHp), chains: boss.kind === 'b03' && boss.ai.stage > 0 ? boss.ai.chains : 0, exposed: boss.ai.exposed > 0, stagger: boss.staggered > 0 ? 1 : boss.stagger / STAGGER.full, reeling: boss.staggered > 0, shielded: boss.shieldHp > 0 } : null;
    hud.device = this.input.device;
    const b = hud.bindings, device = hud.device, interactKey = device === 'pad' ? padName(b.pad.interact ?? 0) : keyName(b.keys.interact), ultKey = device === 'pad' ? padName(b.pad.ult ?? 12) : keyName(b.keys.ult);
    hud.prompt = (game.prompt?.text ?? '').replace('按 E', device === 'touch' ? '点这里' : `按 ${interactKey}`).replace('按 F', device === 'touch' ? '点大招按钮' : `按 ${ultKey}`);
    if (hud.counter && performance.now() > this.counterUntil) hud.counter = '';
    if (hud.rally && performance.now() > this.rallyUntil) hud.rally = false;
    if (this.rallySeal && performance.now() > this.rallySeal.at) {
      const { x, z } = this.rallySeal; this.rallySeal = null;
      this.flips.play({ id: '054', size: 6, y: 1.8, life: .8 }, x, z); this.flips.play({ id: '057', size: 10, y: 1.6, life: 1 }, x, z);
      this.flash(); this.sfx.tone(980, 620, .12, .08, 'square'); this.banner('Claude 的封禁印瓦解了护盾');
    }
    hud.statuses = [h.slow > 0 ? 'status-slow' : '', h.tokenLock > 0 ? 'status-norecovery' : '', h.noHeal > 0 ? 'status-sealed' : ''].filter(Boolean);
    const turned = game.enemies.filter(e => e.hp > 0 && e.allied > 0).length, charmed = game.enemies.filter(e => e.hp > 0 && e.charm > 0).length, glm = h.cards.find(card => card.id === 'glm'), reeling = game.enemies.find(e => e.boss && e.staggered > 0);
    const marks = [];
    if (turned) marks.push({ icon: 'status-turned', text: `${turned}/${glm ? glmStats(glm).targets : GLM.targets}` });
    if (game.decoy) marks.push({ icon: 'status-confused', text: `${Math.ceil(game.decoy.life)}秒` });
    if (charmed) marks.push({ icon: 'status-charmed', text: `${charmed}` });
    if (reeling) marks.push({ icon: 'status-stagger', text: `${reeling.staggered.toFixed(1)}秒` });
    hud.marks = marks;
    hud.face = game.state === 'won' ? 'smile' : performance.now() < this.surpriseUntil ? 'surprised' : h.hp <= TIRED_HP ? 'tired' : h.ult || h.charge !== null || h.awaken >= ULT.cost ? 'firm' : 'calm';
    hud.hp = h.hp; hud.hpMax = h.maxHp; hud.coins = h.coins; hud.wave = game.trial ? `第 ${game.trial.room} 间 · ${plan.name}` : `${plan.id} ${plan.name}`;
    const standing = game.enemies.filter(e => !notCounted(e)).length;
    hud.objective = standing ? `第 ${game.wave} / ${plan.waves.length} 波` : game.state !== 'playing' ? '' : !game.cleared ? '敌人清除' : padLeft ? '踏上地台，或前往出口' : doorWords(game);
    hud.dashCooldownOffset = (h.dashCharges ? 1 : 1 - h.dashCooldown / DASH_RECHARGE) * 100; hud.dashCharges = h.dashCharges;
    const charged = h.awaken >= ULT.cost;
    hud.awaken = h.awaken; hud.ultReady = charged;
    hud.token = h.token; hud.tokenFreeUses = h.zeroCharges; hud.tokenMax = h.tokenMax;
    h.cards.forEach((card, i) => {
      const slot = hud.cards[i]; if (!slot) return;
      // Ready and paid for, with nothing to aim at: it shows before it is pressed.
      slot.invalid = card.cooldown <= 0 && game.cardCost(card) <= h.token && !!game.cardRefusal(i);
      slot.level = card.level; slot.branch = card.branch; slot.boost = card.boost; slot.price = cardPrice(card); slot.cost = game.cardCost(card); slot.cooldown = card.cooldown; slot.shade = card.cooldown / CARDS[card.id].cooldown; slot.broke = slot.cost > h.token; slot.casting = h.summon?.slot === i; slot.heal = card.id === 'seed' ? h.healBudget : -1;
    });
    hud.ultHint = charged ? (device === 'touch' ? '就绪' : `就绪 ${ultKey}`) : String(Math.floor(h.awaken));
    document.body.classList.toggle('ult-charging', h.ult && h.ultAge < ULT.punchAt);
    hud.comboVisible = h.charge !== null || !!((h.attack || h.comboTimer > 0) && h.combo);
    hud.comboCharged = h.charge !== null || h.combo === 'charge';
    if (h.charge !== null) hud.combo = `蓄力 ${Math.round(Math.min(1, h.charge / CHARGE.full) * 100)}%`;
    else if (h.combo) hud.combo = ATTACK_LABELS[h.combo](h.comboIndex);
    if (performance.now() > this.bannerUntil) hud.bannerVisible = false;
    if (performance.now() > this.noticeUntil) hud.noticeVisible = false;
    this.canvas.dataset.state = game.state; this.canvas.dataset.position = `${h.x.toFixed(2)},${h.z.toFixed(2)}`; this.canvas.dataset.action = h.action; this.canvas.dataset.facing = FACINGS[this.shownFacing];
  }

  showMenu(mode: MenuMode) {
    const { game } = this;
    this.menuMode = mode; hud.menuMode = mode; hud.menuOpen = true; this.input?.clear(); this.loop.reset();
    if (mode === 'paused') hud.roomTips = [...new Set(game.traps.flatMap(t => t.kind === 'pad' ? [] : [TRAP_TIPS[t.kind]]))];
    hud.settingsOpen = false;
    if (mode === 'paused' && !game.trial) this.levelMap.open(game); // A trial has no plan of rooms to show.
    else this.levelMap?.close();
    if (mode === 'won' || mode === 'lost') this.showResult(mode);
  }
  private showResult(mode: 'won' | 'lost') {
    const { game } = this, won = mode === 'won', gained = this.runUnlocks.map(id => CARDS[id].name).join('、');
    const fought = [{ label: '击败敌人', value: `${game.kills} 个` }, { label: '用时', value: clockText(game.time) }];
    if (game.trial) {
      const { room } = game.trial;
      if (game.god || hud.unlockAll) trialLeaderboard.markPractice();
      trialLeaderboard.finishRun(room);
      hud.result = { mode, title: '试炼结束', retry: '再来一次', rows: [{ label: '到达', value: `第 ${room} 间` }, ...fought, { label: '最远', value: room > this.trialBest ? '新纪录' : `第 ${this.trialBest} 间` }] };
      return;
    }
    const rows = [{ label: won ? '通过' : '倒在', value: `${game.plan.id} ${game.plan.name}` }, ...fought];
    if (gained) rows.push({ label: '解锁', value: gained });
    if (this.runShards) rows.push({ label: '记忆碎片', value: `+${this.runShards}` });
    if (won && this.slot >= 0) { deleteSave(this.slot); this.slot = -1; }
    hud.result = { mode, title: won ? '胜利' : '失败', retry: won ? '再来一局' : '重新挑战', rows };
  }
  // Called from outside the frame, so whatever the frame already played has to be cleared first or it would play twice.
  pickReward(index: number) {
    const { game } = this;
    if (game.state !== 'reward') return;
    game.events = []; game.chooseReward(index);
    for (const e of game.events) this.feedback(e);
    if (game.state !== 'reward') { this.input.clear(); this.canvas.focus(); }
  }
  async confirmPrep() {
    const { game } = this, next = game.levelIndex + 1;
    if (game.state !== 'prep' || hud.loading) return;
    await this.withLoading(game.levels[next].name, () => this.ensureRegion(next));
    game.events = []; game.confirmPrep(hud.prep?.picks && [...hud.prep.picks]);
    for (const e of game.events) this.feedback(e);
    hud.prep = null; this.syncCards(); this.input.clear(); this.canvas.focus();
    this.releaseExcept(next);
  }
  togglePause(force = false) {
    if (hud.playBlocked && !force) return;
    const { game } = this;
    if (hud.jumpOpen) { if (!force) this.toggleJump(); return; } // Esc closes the room list first, and a lost focus leaves it as it is.
    if (hud.dialog) return;
    if (game.state === 'playing') { game.pause(); this.showMenu('paused'); }
    else if (game.state === 'paused' && !force) { game.resume(); this.levelMap.close(); hud.menuOpen = false; this.canvas.focus(); }
  }
  start() {
    if (hud.playBlocked) return;
    this.unlockAudio();
    if (this.menuMode === 'paused') { this.game.resume(); this.closeMenu(); return; }
    if (hud.inTrial) this.runTrial();
    else this.run(this.debug.get('room'));
  }
  // Everything a run clears before it starts, however it starts.
  private prepareRun(retry = false) {
    this.loop.reset();
    this.retrying = retry;
    for (const e of this.effects) this.dispose(e.mesh);
    for (const m of this.enemyViews.values()) { this.dispose(m.group); this.dispose(m.warning); }
    this.enemyViews.clear(); this.effects.length = 0; this.fx.clear(); this.view.clear(); this.flips.clear(); this.hazards.clear();
    hud.rally = false; hud.counter = ''; hud.boss = null; hud.prompt = ''; hud.shop = null; hud.dialog = null; this.storyPaused = false;
    this.flourish = retry ? { action: 'revive', age: 0 } : null; this.lastAction = 'idle'; this.endingAt = 0;
    hud.reward = null; hud.prep = null; hud.result = null; hud.screen = 'none'; this.freshUnlocks = []; this.runUnlocks = [];
    this.fist = null; hud.fistVisible = false; hud.avatar = 'hidden'; hud.cutIns = []; this.runShards = 0;
  }
  // A fresh run, from the first room unless told which. ?room=2-5 makes that room the start of every run on this page.
  private async run(room: string | null, retry = false) {
    if (hud.loading) return;
    const { game } = this, region = Math.max(0, game.levels.findIndex(level => level.rooms.some(r => r.id === room)));
    await this.withLoading(game.levels[region].name, () => this.ensureRegion(region));
    this.prepareRun(retry);
    game.loadout = [...hud.loadout]; this.view.load(game.loadout);
    game.start(room); this.applyVitality(); this.syncCards();
    for (const e of game.events) this.feedback(e);
    this.retrying = false;
    if (this.debug.has('awaken')) game.hero.awaken = Number(this.debug.get('awaken'));
    this.closeMenu(); this.releaseExcept(region);
  }
  private applyVitality() { const h = this.game.hero; h.maxHp = 100 + loadProfile().vitality * VITALITY_STEP; h.hp = h.maxHp; }
  // A trial wanders through every region, so it has everything to hand before it starts.
  // The graphics device went away, which a phone can do at any moment. A fresh page rebuilds everything, and the run picks up at the start of the room it was in. Twice in a row is left to the player, or it could go round for ever.
  private deviceLost() {
    const { game } = this;
    const saved = saveRecovery({ slot: this.slot, trial: game.trial?.room ?? 0, trialPractice: trialLeaderboard.practice, run: game.state === 'ready' ? null : game.snapshot() });
    game.pause();
    if (saved === 'recent') { hud.fatal = '图形设备反复中断，请重新载入游戏；已有存档可从首页继续。'; return; }
    if (saved === 'unavailable') { hud.fatal = '图形设备已中断，浏览器无法保存恢复信息。请重新载入游戏。'; return; }
    hud.fatal = '图形设备已中断，正在恢复……';
    setTimeout(() => location.reload(), 500);
  }
  private async recoverRun() {
    const recovery = takeRecovery(this.game.levels); if (!recovery || !recovery.run) return false;
    const { slot, trial, run } = recovery;
    if (trial && run) {
      hud.screen = 'none'; hud.inTrial = true; this.slot = -1;
      await this.withLoading('全部大区', () => Promise.all(this.game.levels.map((_, i) => this.ensureRegion(i))));
      this.prepareRun(true); this.trialBest = loadBestRoom(); hud.rooms = [];
      trialLeaderboard.beginRun(recovery.trialPractice !== false || this.game.god || hud.unlockAll);
      this.game.restore(run, trial); this.view.load(this.game.hero.cards.map(card => card.id)); this.syncCards();
      for (const e of this.game.events) this.feedback(e);
      this.retrying = false; this.closeMenu();
      return true;
    }
    const save = slot >= 0 ? loadSaves()[slot] : null;
    if (!save) return false;
    hud.screen = 'none'; await this.restoreRun(save, true);
    return true;
  }
  private async runTrial(retry = false) {
    if (hud.loading) return;
    const { game } = this;
    await this.withLoading('全部大区', () => Promise.all(game.levels.map((_, i) => this.ensureRegion(i))));
    this.prepareRun(retry); this.trialBest = loadBestRoom(); hud.rooms = [];
    trialLeaderboard.beginRun(game.god || hud.unlockAll || this.debug.has('awaken'));
    game.loadout = [...hud.loadout]; this.view.load(game.loadout);
    game.startTrial(); this.applyVitality(); this.syncCards();
    for (const e of game.events) this.feedback(e);
    this.retrying = false;
    this.closeMenu();
  }
  // The home page's way into a run. The slot is taken now, and written as soon as the first room is entered.
  newRun() {
    if (hud.playBlocked) return;
    const slot = freeSlot(loadSaves()); if (slot < 0) return;
    this.slot = slot; hud.inTrial = false; hud.screen = 'none'; this.showMenu('ready');
  }
  pickTrial() { if (hud.playBlocked) return; this.slot = -1; hud.inTrial = true; hud.screen = 'none'; this.showMenu('ready'); }
  resumeLatest() { const save = latestSave(loadSaves()); if (save) this.loadSlot(save.slot); }
  loadSlot(slot: number) {
    const save = loadSaves()[slot]; if (!save) return;
    this.restoreRun(save);
  }
  private async restoreRun(save: SaveData, retry = false) {
    if (hud.loading) return;
    const { game } = this, region = save.run.levelIndex;
    this.slot = save.slot; hud.inTrial = false;
    await this.withLoading(game.levels[region].name, () => this.ensureRegion(region));
    this.prepareRun(retry);
    game.restore(save.run); this.view.load(game.hero.cards.map(card => card.id)); this.syncCards();
    for (const e of game.events) this.feedback(e);
    this.retrying = false;
    this.closeMenu(); this.releaseExcept(region);
  }
  private addShards(amount: number) {
    const profile = loadProfile(); profile.shards += amount; saveProfile(profile); hud.shards = profile.shards; this.runShards += amount;
  }
  trainVitality() {
    const profile = loadProfile(), cost = vitalityCost(profile.vitality);
    if (profile.vitality >= VITALITY_MAX || profile.shards < cost) return;
    profile.shards -= cost; profile.vitality++; saveProfile(profile);
    hud.shards = profile.shards; hud.vitality = profile.vitality;
  }
  // The next memory for its price, or any already paid for, turn by turn.
  readMemory() {
    const profile = loadProfile(), owned = profile.memories >= MEMORIES.length;
    if (!owned && profile.shards < MEMORY_COST) return;
    const scene = MEMORIES[owned ? this.memoryAt++ % MEMORIES.length : profile.memories];
    if (!owned) { profile.shards -= MEMORY_COST; profile.memories++; saveProfile(profile); hud.shards = profile.shards; hud.memories = profile.memories; }
    hud.dialog = scene; hud.dialogAt = 0; this.panelOpened = performance.now(); this.input.clear();
  }
  buyItem(index: number) { const { game } = this; game.events = []; game.buy(index); for (const e of game.events) this.feedback(e); if (game.shop) hud.shop = [...game.shop]; }
  closeShop() { const { game } = this; game.events = []; game.closeShop(); for (const e of game.events) this.feedback(e); this.input.clear(); this.canvas.focus(); }
  chooseStory(index: number) { const { game } = this; game.events = []; game.chooseStory(index); for (const e of game.events) this.feedback(e); this.input.clear(); this.canvas.focus(); }
  // A scene said on the way past a boss, with the fight held still. Trials skip them.
  private currentStory(id: string) {
    return storyScene(id, this.game.unlocked.has('claude') && !this.runUnlocks.includes('claude'));
  }
  private tellStory(id: string) {
    const scene = this.currentStory(id);
    if (hud.inTrial || !scene || this.retrying || this.debug.has('nostory')) return;
    hud.dialog = scene; hud.dialogAt = 0; this.panelOpened = performance.now(); this.storyPaused = this.game.state === 'playing'; this.game.pause(); this.input.clear();
  }
  // Next line, or the end of a scene with no choice to make: the choice's own buttons end the others.
  dialogNext() {
    const scene = hud.dialog;
    if (!scene) return;
    if (hud.dialogAt < scene.lines.length - 1) hud.dialogAt++;
    else if (!scene.choices) this.closeDialog();
  }
  private closeDialog() { hud.dialog = null; if (this.storyPaused) { this.storyPaused = false; this.game.resume(); } this.input.clear(); this.canvas.focus(); }
  removeSlot(slot: number) { deleteSave(slot); this.refreshHome(); }
  // The results panel's first button: the same trial, the room the run fell in, or a new run after a win.
  retry() {
    const { game } = this;
    if (hud.inTrial) { this.runTrial(true); return; }
    const save = this.slot >= 0 ? loadSaves()[this.slot] : null;
    if (save) { this.restoreRun(save, true); return; }
    if (game.state === 'won') { hud.result = null; this.newRunOrHome(); return; }
    this.run(this.debug.get('room'), true);
  }
  private newRunOrHome() { if (freeSlot(loadSaves()) >= 0) this.newRun(); else this.goHome(); }
  // Leaving a run keeps its save, from the start of the room it was in.
  goHome() {
    const { game } = this;
    this.input.clear(); this.levelMap.close(); this.endingAt = 0; game.state = 'ready';
    hud.result = null; hud.reward = null; hud.prep = null; hud.inTrial = false; hud.menuMode = 'ready'; this.menuMode = 'ready'; hud.menuOpen = true;
    this.refreshHome(); hud.screen = 'home';
  }
  private refreshHome() {
    hud.saves = loadSaves(); hud.trialBest = loadBestRoom(); const profile = loadProfile(); hud.shards = profile.shards; hud.vitality = profile.vitality; hud.memories = profile.memories;
  }
  private loadPreferences() {
    hud.settings = loadSettings(); hud.sound = hud.settings.sound; this.sfx.enabled = hud.settings.sound;
    this.bgm.setEnabled(hud.sound && hud.settings.music);
    hud.bindings = loadBindings(); this.input.binds = hud.bindings;
    this.applySettings();
  }
  private applySettings() {
    const { touchOn, touchSize, touchAlpha, stickShift, flash } = hud.settings, body = document.body;
    body.classList.toggle('no-flash', !flash);
    if (touchOn) body.classList.add('touch'); else if (this.input.device !== 'touch' && !matchMedia('(pointer: coarse)').matches) body.classList.remove('touch');
    body.style.setProperty('--touch-size', String(touchSize)); body.style.setProperty('--touch-alpha', String(touchAlpha)); body.style.setProperty('--stick-shift', `${stickShift}px`);
  }
  toggleSetting(key: SettingToggle) {
    hud.settings[key] = !hud.settings[key];
    saveSettings({ ...hud.settings }); this.applySettings();
  }
  private cycleSetting(key: SettingCycle) {
    const steps = SETTING_STEPS[key]; hud.settings[key] = steps[(steps.indexOf(hud.settings[key]) + 1) % steps.length];
    saveSettings({ ...hud.settings }); this.applySettings();
  }
  // The next key or button pressed takes the action. If it was doing something else already, that gets this action's old key, so nothing is ever left unbound.
  private rebind(device: 'keys' | 'pad', action: Action) {
    hud.rebinding = `${device}:${action}`;
    this.input.startCapture(device, code => {
      hud.rebinding = ''; if (code === null) return;
      const map = hud.bindings[device] as Record<string, string | number>, taken = Object.keys(map).find(other => map[other] === code);
      if (taken) map[taken] = map[action]; map[action] = code;
      saveBindings(hud.bindings); this.input.binds = hud.bindings;
    });
  }
  setting(command: SettingCommand) {
    if (command.kind === 'sound') this.setSoundMode(command.mode);
    else if (command.kind === 'toggle') this.toggleSetting(command.key);
    else if (command.kind === 'cycle') this.cycleSetting(command.key);
    else if (command.kind === 'rebind') this.rebind(command.device, command.action);
    else { hud.bindings = defaultBindings(); saveBindings(hud.bindings); this.input.binds = hud.bindings; }
  }
  private saveRun() {
    const { game } = this; if (this.slot < 0 || hud.inTrial) return;
    writeSave({ slot: this.slot, savedAt: Date.now(), roomId: game.plan.id, roomName: game.plan.name, levelName: game.level.name, run: game.snapshot() });
  }
  private syncCards() {
    const { game } = this, h = game.hero;
    this.view.load(h.cards.map(card => card.id));
    const held = h.cards.map(card => card.id);
    hud.combos = PAIRS.filter(p => p.cards.every(id => held.includes(id))).map(({ icon, text }) => ({ icon, text }));
    hud.cards = h.cards.map(card => ({ id: card.id, level: card.level, branch: card.branch, boost: card.boost, cost: game.cardCost(card), price: cardPrice(card), cooldown: card.cooldown, shade: 0, broke: false, casting: false, heal: -1, invalid: false }));
  }
  // ?unlock=all opens the whole album for this page, with three to start and Claude among them, without saving it. ?unlock=reset forgets what has been saved.
  private loadProgress() {
    const mode = this.debug.get('unlock'), { game } = this;
    if (mode === 'reset') clearUnlocked();
    hud.unlockAll = mode === 'all'; hud.startSlots = hud.unlockAll ? 3 : START_SLOTS;
    game.unlocked = new Set(hud.unlockAll ? CARD_IDS : loadUnlocked());
    this.syncUnlocked();
  }
  private syncUnlocked() {
    const { game } = this;
    hud.unlocked = [...game.unlocked];
    hud.loadout = startLoadout(hud.loadout, CARD_IDS.filter(id => canStartWith(id, game.unlocked)), hud.startSlots);
  }
  private closeMenu() { this.levelMap.close(); this.input.clear(); this.loop.reset(); hud.menuOpen = false; this.canvas.focus(); }
  // The back door: every room of every region in a list, over whatever is on screen. A fight waits behind it, and carries on if no room is picked.
  // The back door: F8 or ?god. Nothing hurts her and Token stays full until it is switched off.
  private setGod(on: boolean) {
    if (on && this.game.trial) trialLeaderboard.markPractice();
    if (on !== this.game.god) this.banner(on ? '无敌模式 开' : '无敌模式 关');
    this.game.god = on; hud.god = on; saveGod(on);
  }
  toggleJump() {
    if (hud.playBlocked) return;
    const { game } = this;
    this.input.clear();
    if (hud.jumpOpen) { hud.jumpOpen = false; if (this.jumpPaused) game.resume(); this.jumpPaused = false; this.canvas.focus(); return; }
    this.jumpPaused = game.state === 'playing'; game.pause();
    hud.jumpFrom = game.plan.id; hud.jumpOpen = true;
  }
  jumpTo(id: string) { hud.jumpOpen = false; this.jumpPaused = false; this.unlockAudio(); this.run(id); }
  private padBack() {
    if (hud.playBlocked) return;
    if (hud.rankingOpen) hud.rankingOpen = false;
    else if (hud.jumpOpen) this.toggleJump();
    else if (hud.shop) this.closeShop();
    else if (hud.settingsOpen) hud.settingsOpen = false;
    else if (hud.menuOpen && this.menuMode === 'paused') this.togglePause();
  }
  interactNow() { this.game.interact(); for (const e of this.game.events) this.feedback(e); }
  private unlockAudio() {
    this.bgm.unlock(); this.sfx.unlock(); hud.soundLocked = false;
  }
  setSoundMode(mode: SoundMode) {
    hud.settings.sound = mode !== 'muted'; hud.settings.music = mode === 'all';
    hud.sound = this.sfx.enabled = hud.settings.sound;
    this.bgm.setEnabled(hud.sound && hud.settings.music); this.unlockAudio();
    saveSettings({ ...hud.settings });
  }

  // Preserve the identity under the cursor as well as its direction, so a closer
  // enemy beside it cannot steal the selection.
  private enemyUnderCursor(): Enemy | null {
    const { game } = this, h = game.hero, x = this.aimPoint.dot(CAMERA_RIGHT), y = this.aimPoint.dot(CAMERA_UP);
    let best: Enemy | null = null, nearest = Infinity;
    for (const e of game.enemies) {
      if (e.hp <= 0 || e.allied > 0 || e.arrive > 0) continue;
      const body = bodyOf(e), at = new THREE.Vector3(e.x, 0, e.z), side = x - at.dot(CAMERA_RIGHT), up = y - at.dot(CAMERA_UP), away = Math.hypot(e.x - h.x, e.z - h.z);
      if (Math.abs(side) <= body.width / 2 && up >= 0 && up <= body.tall + body.foot && away > .6 && away < nearest) { nearest = away; best = e; }
    }
    return best;
  }
  private tick = (now: number) => {
    const { game, input } = this, dt = Math.max(0, Math.min((now - this.last) / 1000, MAX_FRAME_TIME)); this.last = now;
    // The portrait overlay owns all input. Freeze the entire simulation and every background panel.
    if (hud.playBlocked) {
      input.clear(); input.modal = true; input.choiceCount = 0; this.loop.reset();
      if (input.capture) input.captured(null);
      if (game.state === 'playing') this.togglePause(true);
      this.nav.update(now, () => {});
      requestAnimationFrame(this.tick); return;
    }
    let mouseAim: Vec2 | null = null;
    let mouseTargetId: number | undefined;
    if (input.mouse.active) {
      this.mouseNdc.set(input.mouse.x / innerWidth * 2 - 1, 1 - input.mouse.y / innerHeight * 2); this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(AIM_PLANE, this.aimPoint)) { const x = this.aimPoint.x - game.hero.x, z = this.aimPoint.z - game.hero.z; if (Math.hypot(x, z) > .6) mouseAim = { x, z }; } // A cursor on top of the hero has no meaningful direction.
      const under = this.enemyUnderCursor(); if (under) { mouseAim = { x: under.x - game.hero.x, z: under.z - game.hero.z }; mouseTargetId = under.id; }
    }
    const modal = hud.loading || hud.menuOpen || hud.screen === 'home' || !!(hud.reward || hud.shop || hud.dialog || hud.prep || hud.result || hud.jumpOpen);
    input.modal = modal;
    input.choiceCount = hud.shop?.length ?? hud.reward?.length ?? hud.dialog?.choices?.length ?? 0;
    // Leaving the settings calls off a binding still waiting, or the next key pressed would be taken for it.
    if (input.capture && !document.querySelector('.settings-panel')) input.captured(null);
    if (input.capture) this.nav.wait(); else if (modal) this.nav.update(now, () => this.padBack()); else this.nav.clear();
    const sampled = input.sample(mouseAim, mouseTargetId), shown = game.state;
    this.loop.advance(dt, sampled, event => this.feedback(event));
    // The dash button is go at the preparation point, so a pad can get through it. One dash too many through a boss door must not skip the only chance to change the team.
    const key = sampled.card ?? -1, settled = now - this.panelOpened > 400;
    if (hud.dialog) {
      if (settled && (sampled.dash || sampled.interact)) this.dialogNext();
      else if (settled && key >= 0 && hud.dialog.choices && hud.dialogAt === hud.dialog.lines.length - 1) this.chooseStory(key);
    } else if (hud.shop) {
      if (settled && sampled.dash) this.closeShop();
      else if (key >= 0) this.buyItem(key);
    } else if (shown === 'reward' && game.state === 'reward') { if (key >= 0) this.pickReward(key); }
    else if (game.state === 'prep' && sampled.dash && now - this.prepOpened > 500) this.confirmPrep();
    this.updateHero(dt); this.updateEnemies(dt); this.updateExitArrow(); this.hazards.update(game.time);
    if (this.endingAt && now >= this.endingAt && !hud.dialog) { this.endingAt = 0; this.showMenu(this.endingMode); }
    if (game.state !== 'paused') { for (const tick of this.roomTicks) tick(dt); const effectDt = game.slowmo > 0 ? dt * .4 : dt; this.view.update(); this.updateEffects(effectDt); this.flips.update(effectDt); this.fx.update(effectDt); this.updateAmbient(effectDt); this.updateUltOverlay(effectDt); }
    this.updateCamera(dt); this.updateUI();
    if (this.levelMap.isOpen) this.levelMap.frame(dt, sampled);
    else this.glow.render();
    requestAnimationFrame(this.tick);
  };
}
