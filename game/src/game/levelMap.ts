// The pause map: the rooms of the level as plain wireframe boxes joined by corridor lines, seen from the game's own fixed angle. It can be dragged and zoomed.
// It has its own scene and camera and takes over the canvas while the game is paused. Nothing inside a room is drawn, and a locked room is only a dim outline.
import { nextTick } from 'vue';
import * as THREE from 'three/webgpu';
import { TILE, type Door } from './room';
import { ROOM_KINDS, type Level, type RoomPlan } from './level';
import { layoutLevel, type Box, type MapLayout, type PlacedRoom } from './mapLayout';
import { hud } from './hud';
import type { Game, GameInput, RoomState } from './simulation';

const VIEW = 40, ELEVATION = Math.atan(1 / Math.SQRT2), EASE = 14, STICK_PAN = 60, ZOOM_PER_WHEEL = .0013, ROOM_HEIGHT = 3, DOOR_DEPTH = .8;
const CAMERA_HOME = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(400), RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }, FORWARD = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
const COMPACT_BELOW = 2.4; // Pixels per world unit. Zoomed out further than this a room is too small for its name, so its label drops to the room number.
const LINE_COLOR: Record<RoomState, number> = { current: 0x8ff0ff, cleared: 0x6f8ba0, open: 0x7fe9ff, locked: 0x34454f };
const DOOR_SHUT = 0xff6b5e, DOOR_SEALED = 0x6f8ba0, DOOR_OPEN = 0x7fe9ff, CORRIDOR_LIT = 0x6f8ba0, CORRIDOR_DIM = 0x2a3942;

interface RoomView { plan: RoomPlan; placed: PlacedRoom; group: THREE.Group; lines: THREE.LineBasicNodeMaterial; fill: THREE.Mesh; doorIn?: THREE.Mesh; doorOut?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> }
interface Pointer { x: number; y: number }

export class LevelMap {
  isOpen = false;
  private renderer: THREE.WebGPURenderer;
  private surface: HTMLElement;
  private level: Level | null = null;
  private layout!: MapLayout;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 800);
  private rooms: RoomView[] = [];
  private corridors: THREE.Line[] = [];
  private corridorLit = new THREE.LineBasicNodeMaterial({ color: CORRIDOR_LIT });
  private corridorDim = new THREE.LineBasicNodeMaterial({ color: CORRIDOR_DIM });
  private marker = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicNodeMaterial({ color: 0xbff6ff, side: THREE.DoubleSide }));
  private game: Game | null = null;
  private target = new THREE.Vector3();
  private targetGoal = new THREE.Vector3();
  private zoom = 1;
  private zoomGoal = 1;
  private minZoom = .2;
  private maxZoom = 8;
  private pointers = new Map<number, Pointer>();
  private time = 0;

  constructor(renderer: THREE.WebGPURenderer, surface: HTMLElement) {
    this.renderer = renderer; this.surface = surface;
    this.camera.position.copy(CAMERA_HOME); this.camera.lookAt(0, 0, 0);
    this.marker.rotation.x = -Math.PI / 2; this.scene.add(this.marker);
    surface.addEventListener('pointerdown', this.onDown); surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp); surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('contextmenu', e => e.preventDefault());
  }

  open(game: Game) {
    this.game = game; this.isOpen = true; this.pointers.clear();
    if (this.level !== game.level) this.build(game.level);
    this.refresh();
    // Framing has to dodge the menu panel, which is only laid out once Vue has shown it.
    void nextTick(() => {
      if (!this.isOpen) return;
      this.focusCurrent();
      this.target.copy(this.targetGoal); this.zoom = this.zoomGoal * .85; // It settles in as it opens.
    });
  }
  close() { this.isOpen = false; this.pointers.clear(); }

  // What each room shows depends only on how far the run has got, so nothing needs rebuilding from one pause to the next.
  private refresh() {
    const game = this.game!, states = game.roomStates();
    hud.levelName = game.level.name;
    hud.rooms = this.rooms.map((view, i) => {
      const state = states[i], current = state === 'current', visited = current || state === 'cleared', through = state === 'cleared' || (current && game.cleared);
      view.lines.color.setHex(LINE_COLOR[state]); view.fill.visible = current;
      if (view.doorIn) view.doorIn.visible = visited;
      if (view.doorOut) { view.doorOut.visible = visited; view.doorOut.material.color.setHex(through ? DOOR_OPEN : DOOR_SHUT); }
      return { id: view.plan.id, name: view.plan.name, kind: ROOM_KINDS[view.plan.kind], state, left: 0, top: 0 };
    });
    this.corridors.forEach((line, i) => { line.material = states[i + 1] === 'locked' ? this.corridorDim : this.corridorLit; });
  }

  // The map shows the region she is in, so a new region clears the last one off.
  private build(level: Level) {
    for (const { group } of this.rooms) {
      group.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); (mesh.material as THREE.Material | undefined)?.dispose(); });
      this.scene.remove(group);
    }
    for (const line of this.corridors) { line.geometry.dispose(); this.scene.remove(line); }
    this.rooms = []; this.corridors = []; this.level = level; this.layout = layoutLevel(level);
    level.rooms.forEach((plan, i) => this.rooms.push(this.buildRoom(plan, this.layout.rooms[i])));
    for (const path of this.layout.corridors) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(p => new THREE.Vector3(p.x, 0, p.z))), this.corridorDim);
      this.corridors.push(line); this.scene.add(line);
    }
  }
  private buildRoom(plan: RoomPlan, placed: PlacedRoom): RoomView {
    const { room } = placed, width = room.cols * TILE, depth = room.rows * TILE, group = new THREE.Group();
    group.position.set(placed.x, 0, placed.z); this.scene.add(group);
    const lines = new THREE.LineBasicNodeMaterial({ color: LINE_COLOR.locked }), box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, ROOM_HEIGHT, depth)), lines);
    box.position.y = ROOM_HEIGHT / 2; group.add(box);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicNodeMaterial({ color: LINE_COLOR.current, transparent: true, opacity: .05, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2; group.add(fill);
    const view: RoomView = { plan, placed, group, lines, fill };
    if (room.entrance) view.doorIn = this.buildDoor(group, room.entrance, DOOR_SEALED);
    if (room.exit) view.doorOut = this.buildDoor(group, room.exit, DOOR_SHUT);
    return view;
  }
  // A door is a short coloured bar across the wall line.
  private buildDoor(group: THREE.Group, door: Door, color: number) {
    const along = door.span * TILE, bar = new THREE.Mesh(new THREE.PlaneGeometry(door.alongX ? along : DOOR_DEPTH, door.alongX ? DOOR_DEPTH : along), new THREE.MeshBasicNodeMaterial({ color, side: THREE.DoubleSide }));
    bar.rotation.x = -Math.PI / 2; bar.position.set(door.center.x, .02, door.center.z); group.add(bar);
    return bar;
  }

  private get pixelsPerUnit() { return innerHeight / (VIEW * 2) * this.zoomGoal; }
  // Moves the view so what is on screen shifts by this many pixels. Up the screen covers more ground than across it, because the view looks down at an angle.
  private shift(pixelsX: number, pixelsY: number) {
    const unit = 1 / this.pixelsPerUnit, along = pixelsY * unit / Math.sin(ELEVATION), across = -pixelsX * unit;
    this.targetGoal.x += RIGHT.x * across + FORWARD.x * along; this.targetGoal.z += RIGHT.z * across + FORWARD.z * along;
    this.clampTarget();
  }
  private clampTarget() {
    const { minX, maxX, minZ, maxZ } = this.layout.bounds;
    this.targetGoal.x = Math.min(maxX, Math.max(minX, this.targetGoal.x)); this.targetGoal.z = Math.min(maxZ, Math.max(minZ, this.targetGoal.z));
  }
  // Zooms about a point on the screen, so whatever is under the cursor stays there.
  private zoomAt(pixelX: number, pixelY: number, ratio: number) {
    const before = this.zoomGoal; this.zoomGoal = Math.min(this.maxZoom, Math.max(this.minZoom, before * ratio));
    const grown = this.zoomGoal / before; if (grown === 1) return;
    const away = (pixel: number, centre: number) => (pixel - centre) * (1 - grown); // Pixels the point would drift off by.
    this.shift(away(pixelX, innerWidth / 2), away(pixelY, innerHeight / 2));
  }
  // Frames the room she is in, in the part of the screen the menu panel leaves free, with room left over for its neighbours.
  focusCurrent() {
    const game = this.game; if (!game) return;
    const { box } = this.rooms[game.roomIndex].placed, panel = this.surface.parentElement?.querySelector('.menu-panel')?.getBoundingClientRect(), left = panel ? panel.right + 16 : 0;
    const fit = (b: Box, w: number, h: number) => { const across = (b.maxX - b.minX + b.maxZ - b.minZ) * Math.SQRT1_2; return Math.min(w / (across + 6), h / (across * Math.sin(ELEVATION) + 6)) / (innerHeight / (VIEW * 2)); };
    const roomZoom = fit(box, innerWidth - left, innerHeight - 90) * .42;
    this.minZoom = fit(this.layout.bounds, innerWidth, innerHeight) * .7; this.maxZoom = roomZoom * 3;
    this.zoomGoal = Math.max(this.minZoom, roomZoom);
    this.targetGoal.set((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
    this.shift((left + innerWidth) / 2 - innerWidth / 2, 0);
  }

  private onDown = (e: PointerEvent) => { this.surface.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); e.preventDefault(); };
  private onUp = (e: PointerEvent) => { this.pointers.delete(e.pointerId); };
  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const before = [...this.pointers.values()].map(q => ({ ...q })), dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) this.shift(dx, dy);
    else if (this.pointers.size === 2) {
      // Two fingers: the point between them pans and their spread zooms.
      const after = [...this.pointers.values()], mid = (s: Pointer[]) => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 }), spread = (s: Pointer[]) => Math.hypot(s[0].x - s[1].x, s[0].y - s[1].y) || 1;
      const a = mid(before), b = mid(after);
      this.shift(b.x - a.x, b.y - a.y); this.zoomAt(b.x, b.y, spread(after) / spread(before));
    }
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * ZOOM_PER_WHEEL)); };

  private updateCamera(dt: number) {
    const k = 1 - Math.exp(-dt * EASE), camera = this.camera, aspect = innerWidth / innerHeight;
    this.target.lerp(this.targetGoal, k); this.zoom += (this.zoomGoal - this.zoom) * k;
    camera.position.copy(CAMERA_HOME).add(this.target);
    camera.left = -VIEW * aspect; camera.right = VIEW * aspect; camera.top = VIEW; camera.bottom = -VIEW; camera.zoom = this.zoom;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  // A room is hollow on the map, so its label sits in the middle of it.
  private updateLabels() {
    const point = new THREE.Vector3();
    hud.mapCompact = this.pixelsPerUnit < COMPACT_BELOW;
    this.rooms.forEach((view, i) => {
      const { minX, maxX, minZ, maxZ } = view.placed.box, label = hud.rooms[i];
      point.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2).project(this.camera);
      label.left = Math.round((point.x * .5 + .5) * innerWidth); label.top = Math.round((-point.y * .5 + .5) * innerHeight);
    });
  }
  // Keys and the stick pan too.
  frame(dt: number, input: GameInput) {
    const game = this.game!, placed = this.rooms[game.roomIndex].placed;
    this.time += dt;
    if (input.moveX || input.moveZ) { const speed = STICK_PAN / this.zoomGoal * dt; this.targetGoal.x += (input.moveX || 0) * speed; this.targetGoal.z += (input.moveZ || 0) * speed; this.clampTarget(); }
    this.updateCamera(dt);
    this.marker.position.set(placed.x + game.hero.x, .03, placed.z + game.hero.z); this.marker.scale.setScalar(1 + Math.sin(this.time * 4) * .2);
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }
}
