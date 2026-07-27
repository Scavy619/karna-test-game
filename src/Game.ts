import * as BABYLON from '@babylonjs/core';
import { Input } from './core/Input';
import { RTSCamera } from './camera/RTSCamera';
import { World } from './world/World';
import { Wildlife } from './world/Wildlife';
import { ResourceNode } from './world/ResourceNode';
import { CampaignMap } from './ui/CampaignMap';
import { Minion } from './entities/Minion';
import { Warrior } from './entities/Warrior';
import { Building, BuildingKey, BUILDING_DEFS, COMPACT_KEYS, COMPACT_MIN_DIST, Cost } from './buildings/Building';
import { SelectionSystem } from './systems/Selection';
import { StorySystem } from './systems/Story';
import { FX } from './systems/Effects';
import { Sfx } from './systems/Sound';
import { HUD, costLabel } from './ui/HUD';
import { pastel } from './core/Materials';

export type TechKey = 'sharpAxes' | 'ironBlades' | 'warBanners' | 'suryapuja' | 'festival' | 'silkRoute';

export interface TechDef {
  name: string;
  icon: string;
  building: 'library' | 'temple';
  cost: Cost;
  costLabel: string;
  time: number;
  desc: string;
}

const TECHS: Record<TechKey, TechDef> = {
  sharpAxes:  { name: 'Sharp Axes',      icon: '🪓', building: 'library', cost: { wood: 80, gold: 40 },   costLabel: '80🌲 40🪙',  time: 12, desc: '+50% gather speed' },
  ironBlades: { name: 'Iron Blades',     icon: '⚔️', building: 'library', cost: { gold: 100, stone: 60 }, costLabel: '100🪙 60🪨', time: 14, desc: '+50% warrior damage' },
  warBanners: { name: 'War Banners',     icon: '🚩', building: 'library', cost: { gold: 80, stone: 40 },  costLabel: '80🪙 40🪨',  time: 14, desc: '+30% HP for new warriors' },
  suryapuja:  { name: 'Suryapuja',       icon: '☀️', building: 'temple',  cost: { gold: 90, food: 60 },   costLabel: '90🪙 60🌾',  time: 14, desc: 'Sun-god blessing: Karna +50% damage, +200 HP' },
  festival:   { name: 'Festival of Anga', icon: '🎉', building: 'temple', cost: { food: 100, gold: 50 },  costLabel: '100🌾 50🪙', time: 12, desc: '+50% food gathering' },
  silkRoute:  { name: 'Silk Route',      icon: '🐫', building: 'temple',  cost: { gold: 120 },            costLabel: '120🪙',      time: 16, desc: 'Trade caravans: +1 gold every 2s' },
};

const AGE_UP_COST: Cost = { wood: 200, stone: 100, gold: 150 };
const ENEMY_SPAWN_INTERVAL = 30;
const MAX_ENEMIES = 8;
/** Cap on one drag-built wall line, so a wild drag can't spawn hundreds. */
const MAX_CHAIN_SEGMENTS = 40;

/** One planned piece of a dragged wall line. */
export interface ChainSegment {
  pos: BABYLON.Vector3;
  yaw: number;
  valid: boolean;
}

/**
 * Level 1 — Anga, land of Karna. Build the economy (wood/stone/gold/food),
 * ascend to the Kingdom Age, raise an army of soldiers, horsemen and
 * chariots, and shatter the Dark Totem in the north-east.
 */
export class Game {
  readonly engine: BABYLON.Engine;
  readonly scene: BABYLON.Scene;
  readonly world: World;
  readonly input: Input;
  readonly cameraRig: RTSCamera;
  readonly hud: HUD;
  readonly selection: SelectionSystem;
  readonly story: StorySystem;
  readonly wildlife: Wildlife;
  readonly campaign: CampaignMap;

  resources = { wood: 250, stone: 120, gold: 180, food: 150 };
  research: Record<TechKey, boolean> = {
    sharpAxes: false, ironBlades: false, warBanners: false,
    suryapuja: false, festival: false, silkRoute: false,
  };
  storyFlags = { warriorOath: false };
  readonly techs = TECHS;
  age = 1;

  minions: Minion[] = [];
  warriors: Warrior[] = [];
  enemies: Warrior[] = [];
  buildings: Building[] = [];
  nodes: ResourceNode[] = [];

  townCenter!: Building;
  private totem!: Building;
  private enemyCampPos = new BABYLON.Vector3(60, 0, 60);
  private enemySpawnTimer = ENEMY_SPAWN_INTERVAL;
  private enemySpawnCount = 0;
  private goldTrickle = 0;
  private autoAssignTimer = 3;
  private gameOver = false;

  constructor() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);

    this.world = new World(this.scene);
    FX.init(this.scene);
    Sfx.init();
    this.input = new Input(canvas);
    this.cameraRig = new RTSCamera(this.scene, new BABYLON.Vector3(-55, 0, -55));
    this.hud = new HUD();
    this.hud.bind(this);
    this.selection = new SelectionSystem(this.scene, this.input, this);
    this.story = new StorySystem(this);
    this.wildlife = new Wildlife(this.scene, this.world);

    // Post-processing: antialiasing, soft bloom on gold, gentle vignette
    const pipeline = new BABYLON.DefaultRenderingPipeline('render', false, this.scene, [this.cameraRig.camera]);
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.88;
    pipeline.bloomWeight = 0.15;
    pipeline.bloomKernel = 48;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.contrast = 1.12;
    pipeline.imageProcessing.exposure = 1.03;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.4;
    pipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0.15, 0.1, 0.2, 0);

    this.setupLevel();

    // Campaign map: shown first, Anga begins the game
    this.campaign = new CampaignMap(() => {
      this.toast('🌅 Anga, seat of Karna — sworn to the Kauravas, ruled by no one but you.');
    });
    this.campaign.show();
    document.getElementById('mapBtn')?.addEventListener('click', () => this.campaign.show());

    // Digit hotkeys drive the build palette
    this.input.onKeyPress((key) => {
      if (key >= '1' && key <= '9') this.hud.pressHotkey(key);
    });

    window.addEventListener('resize', () => this.engine.resize());
    (window as unknown as { game: Game }).game = this;
  }

  // ── Modifiers ──────────────────────────────────────────────────

  get gatherMult(): number { return this.research.sharpAxes ? 1.5 : 1; }
  get foodMult(): number { return this.research.festival ? 1.5 : 1; }
  get damageMult(): number { return this.research.ironBlades ? 1.5 : 1; }
  get hpMult(): number { return this.research.warBanners ? 1.3 : 1; }

  get hero(): Warrior | null {
    return this.warriors.find((w) => w.variant === 'hero' && w.alive) ?? null;
  }

  techKeys(building: 'library' | 'temple'): TechKey[] {
    return (Object.keys(TECHS) as TechKey[]).filter((k) => TECHS[k].building === building);
  }

  // ── Economy ────────────────────────────────────────────────────

  addResource(type: 'wood' | 'stone' | 'gold' | 'food', amount: number): void {
    this.resources[type] += amount;
  }

  canAfford(cost: Cost): boolean {
    return (this.resources.wood >= (cost.wood ?? 0)) &&
           (this.resources.stone >= (cost.stone ?? 0)) &&
           (this.resources.gold >= (cost.gold ?? 0)) &&
           (this.resources.food >= (cost.food ?? 0));
  }

  /** How many copies of `cost` the treasury can pay for right now. */
  affordableCount(cost: Cost): number {
    let n = Infinity;
    for (const k of ['wood', 'stone', 'gold', 'food'] as const) {
      const c = cost[k] ?? 0;
      if (c > 0) n = Math.min(n, Math.floor(this.resources[k] / c));
    }
    return n === Infinity ? MAX_CHAIN_SEGMENTS : n;
  }

  private deduct(cost: Cost): boolean {
    if (!this.canAfford(cost)) {
      this.toast('Not enough resources! ❌');
      return false;
    }
    this.resources.wood -= cost.wood ?? 0;
    this.resources.stone -= cost.stone ?? 0;
    this.resources.gold -= cost.gold ?? 0;
    this.resources.food -= cost.food ?? 0;
    return true;
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  // ── Building ───────────────────────────────────────────────────

  requestPlacement(key: BuildingKey): void {
    const def = BUILDING_DEFS[key];
    if (this.age < (def.requiresAge ?? 1)) {
      this.toast('👑 Requires the Kingdom Age — upgrade at your Town Center!');
      return;
    }
    if (!this.canAfford(def.cost)) {
      this.toast('Not enough resources! ❌');
      return;
    }
    this.selection.beginPlacement(key);
  }

  isPlacementValid(key: BuildingKey, pos: BABYLON.Vector3): boolean {
    const def = BUILDING_DEFS[key];
    if (Math.abs(pos.x) > 95 || Math.abs(pos.z) > 95) return false;

    if (key === 'fishingDock') {
      // Docks sit on a shore: the pond's or the river's
      if (!this.world.isDockSpot(pos.x, pos.z)) return false;
    } else if (this.world.overlapsWater(pos.x, pos.z)) {
      return false; // nothing else builds on water
    }

    for (const b of this.buildings) {
      if (!b.alive) continue;
      // Wall/gate/tower chains may sit nearly touching to form a line
      const chained = COMPACT_KEYS.includes(key) && COMPACT_KEYS.includes(b.def.key);
      const minDist = chained ? COMPACT_MIN_DIST : def.footprint + b.def.footprint + 1.5;
      if (BABYLON.Vector3.Distance(pos, b.position) < minDist) return false;
    }
    for (const n of this.nodes) {
      if (!n.depleted && BABYLON.Vector3.Distance(pos, n.position) < def.footprint + n.radius + 1) return false;
    }
    return true;
  }

  placeBuilding(key: BuildingKey, pos: BABYLON.Vector3): void {
    if (!this.deduct(BUILDING_DEFS[key].cost)) return;
    const b = new Building(this.scene, this.world, key, pos, 'player', false);
    this.buildings.push(b);
    this.toast(`${b.def.icon} ${b.def.name} site placed`);
    Sfx.play('build');

    const selMinions = this.selection.selected.filter((s): s is Minion => s instanceof Minion);
    const builders = selMinions.length > 0 ? selMinions : this.nearestMinions(pos, 2);
    builders.forEach((m) => m.commandBuild(b));
  }

  /**
   * Lays out a wall line from `start` to `end`: evenly spaced segments, all
   * rotated to face along the line, each flagged with whether it may be built.
   * Used both for the drag preview and for the actual placement.
   */
  planChain(key: BuildingKey, start: BABYLON.Vector3, end: BABYLON.Vector3): ChainSegment[] {
    const def = BUILDING_DEFS[key];
    const spacing = def.chainSpacing ?? 3.3;
    const dir = new BABYLON.Vector3(end.x - start.x, 0, end.z - start.z);
    const len = dir.length();
    // A rotation of `yaw` about Y sends local +X to (cos yaw, 0, -sin yaw)
    const yaw = len > 0.001 ? Math.atan2(-dir.z, dir.x) : 0;

    // Too short to be a line — a single segment, as if simply clicked
    if (len < spacing * 0.6) {
      return [{ pos: start.clone(), yaw, valid: this.isPlacementValid(key, start) }];
    }

    let gaps = Math.max(1, Math.round(len / spacing));
    // Rounding down must never leave a visible hole between segments
    if (len / gaps > spacing * 1.09) gaps = Math.ceil(len / spacing);
    gaps = Math.min(gaps, MAX_CHAIN_SEGMENTS - 1);

    const step = dir.scale(1 / gaps);
    const out: ChainSegment[] = [];
    for (let i = 0; i <= gaps; i++) {
      const pos = start.add(step.scale(i));
      out.push({ pos, yaw, valid: this.isPlacementValid(key, pos) });
    }
    return out;
  }

  /** Builds every valid, affordable segment of a planned wall line. */
  placeChain(key: BuildingKey, plan: ChainSegment[]): void {
    const def = BUILDING_DEFS[key];
    const built: Building[] = [];
    let brokeOnCost = false;

    for (const seg of plan) {
      if (!seg.valid) continue;
      if (!this.canAfford(def.cost)) { brokeOnCost = true; break; }
      this.deduct(def.cost);
      const b = new Building(this.scene, this.world, key, seg.pos, 'player', false, seg.yaw);
      this.buildings.push(b);
      built.push(b);
    }

    if (built.length === 0) {
      this.toast(brokeOnCost ? 'Not enough resources! ❌' : 'Cannot build there ❌');
      return;
    }

    Sfx.play('build');
    const n = built.length;
    const total: Cost = {
      wood: (def.cost.wood ?? 0) * n || undefined,
      stone: (def.cost.stone ?? 0) * n || undefined,
      gold: (def.cost.gold ?? 0) * n || undefined,
      food: (def.cost.food ?? 0) * n || undefined,
    };
    this.toast(n === 1
      ? `${def.icon} ${def.name} site placed`
      : `${def.icon} Wall line laid — ${n} segments (${costLabel(total)})`);
    if (brokeOnCost) this.toast('Ran out of stone — the line stops short 🪨');

    // Spread the crew along the line so it rises evenly
    const selMinions = this.selection.selected.filter((s): s is Minion => s instanceof Minion);
    const mid = built[Math.floor(built.length / 2)].position;
    const crew = selMinions.length > 0 ? selMinions : this.nearestMinions(mid, Math.min(4, n));
    crew.forEach((m, i) => {
      const target = built[Math.min(n - 1, Math.floor((i * n) / Math.max(1, crew.length)))];
      m.commandBuild(target);
    });
  }

  /** Farms/docks produce a linked harvestable node when they finish. */
  private onBuildingCompleted(b: Building): void {
    FX.confetti(b.position.add(new BABYLON.Vector3(0, 3, 0)));
    Sfx.play('complete');
    this.story.onBuildingCompleted();

    if (b.def.key === 'farm') {
      const nodePos = b.position.add(new BABYLON.Vector3(0, 0, b.def.footprint + 1.2));
      const node = new ResourceNode(this.scene, 'food', nodePos, 1500, 'wheat');
      b.foodNode = node;
      this.nodes.push(node);
    } else if (b.def.key === 'fishingDock') {
      const water = this.world.nearestWaterCenter(b.position.x, b.position.z);
      const toWater = new BABYLON.Vector3(water.x - b.position.x, 0, water.z - b.position.z).normalize();
      const nodePos = b.position.add(toWater.scale(b.def.footprint + 2));
      const node = new ResourceNode(this.scene, 'food', nodePos, 2000, 'fish');
      b.foodNode = node;
      this.nodes.push(node);
    }
  }

  // ── Training & research ────────────────────────────────────────

  private train(b: Building, label: string, cost: Cost, seconds: number, spawn: (game: Game, b: Building) => void): void {
    if (b.queue.length >= 3) { this.toast('Queue is full'); return; }
    if (!this.deduct(cost)) return;
    b.queueItem(label, seconds, (game, building) => {
      spawn(game, building);
      Sfx.play('spawn');
    });
  }

  trainMinion(tc: Building): void {
    this.train(tc, 'Training Minion 👶', { gold: 40, food: 20 }, 6, (g, b) => {
      const m = g.spawnMinion(b.position.add(new BABYLON.Vector3(0, 0, b.def.footprint + 2)));
      FX.poof(m.position);
      g.toast('A new minion joins! 👶');
    });
  }

  trainScout(tc: Building): void {
    this.train(tc, 'Training Scout 🏃', { gold: 30, food: 10 }, 5, (g, b) => {
      g.spawnWarrior('scout', b.position.add(new BABYLON.Vector3(2, 0, b.def.footprint + 2)));
      g.toast('A swift scout reports! 🏃');
    });
  }

  trainSoldier(barracks: Building): void {
    this.train(barracks, 'Training Soldier 🗡️', { gold: 60, wood: 20, food: 20 }, 8, (g, b) => {
      g.spawnWarrior('soldier', b.position.add(new BABYLON.Vector3(0, 0, b.def.footprint + 2)));
      g.toast('A soldier reports for duty! 🗡️');
    });
  }

  trainHorseman(stable: Building): void {
    this.train(stable, 'Training Horseman 🐎', { gold: 80, food: 40 }, 10, (g, b) => {
      g.spawnWarrior('horseman', b.position.add(new BABYLON.Vector3(0, 0, b.def.footprint + 2)));
      g.toast('Cavalry rides forth! 🐎');
    });
  }

  trainChariot(stable: Building): void {
    this.train(stable, 'Building War Chariot 🛞', { gold: 150, wood: 80, food: 60 }, 14, (g, b) => {
      g.spawnWarrior('chariot', b.position.add(new BABYLON.Vector3(0, 0, b.def.footprint + 3)));
      g.toast('A war chariot thunders out — worthy of Karna himself! 🛞');
    });
  }

  upgradeAge(tc: Building): void {
    if (this.age >= 2 || tc.queue.some((q) => q.label.includes('Kingdom'))) return;
    if (tc.queue.length >= 3) { this.toast('Queue is full'); return; }
    if (!this.deduct(AGE_UP_COST)) return;
    tc.queueItem('Ascending to Kingdom Age 👑', 20, (game) => {
      game.age = 2;
      Sfx.play('ageUp');
      FX.confetti(tc.position.add(new BABYLON.Vector3(0, 5, 0)));
      game.toast('👑 Welcome to the Kingdom Age! The War Stable is unlocked.');
    });
    this.toast('👑 Ascending to the Kingdom Age…');
  }

  startResearch(building: Building, key: TechKey): void {
    if (this.research[key]) return;
    if (building.queue.length > 0) { this.toast('Already researching…'); return; }
    const tech = TECHS[key];
    if (!this.deduct(tech.cost)) return;
    building.queueItem(`Researching ${tech.name} ${tech.icon}`, tech.time, (game) => {
      game.research[key] = true;
      Sfx.play('research');
      if (key === 'suryapuja') {
        const hero = game.hero;
        if (hero) { hero.maxHp += 200; hero.hp = Math.min(hero.maxHp, hero.hp + 200); }
      }
      game.toast(`Research complete: ${tech.icon} ${tech.name} — ${tech.desc}!`);
    });
    this.toast(`${tech.icon} Researching ${tech.name}…`);
  }

  // ── Spawning & queries ─────────────────────────────────────────

  spawnMinion(pos: BABYLON.Vector3): Minion {
    const m = new Minion(this.scene, this.world, pos);
    this.registerUnit(m);
    this.minions.push(m);
    return m;
  }

  spawnWarrior(variant: 'soldier' | 'scout' | 'horseman' | 'chariot', pos: BABYLON.Vector3): Warrior {
    const w = new Warrior(this.scene, this.world, pos, variant, this.hpMult);
    this.registerUnit(w);
    this.warriors.push(w);
    FX.poof(w.position);
    return w;
  }

  /** Used by story events. */
  spawnSoldier(pos: BABYLON.Vector3): Warrior {
    return this.spawnWarrior('soldier', pos);
  }

  private registerUnit(u: Minion | Warrior): void {
    for (const mesh of u.getMeshes()) this.world.addShadowCaster(mesh);
  }

  nearestDepot(pos: BABYLON.Vector3): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || !b.completed || b.def.key !== 'townCenter' || b.team !== 'player') continue;
      const d = BABYLON.Vector3.Distance(pos, b.position);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Free workers help nearby construction first, then gather the nearest
   * resource. Runs every few seconds so newly trained or finished minions
   * never stand around.
   */
  private autoAssignIdleMinions(): void {
    const sites = this.buildings.filter((b) => b.alive && !b.completed && b.team === 'player');
    let assigned = 0;
    for (const m of this.minions) {
      if (!m.isIdle) continue;

      let bestSite: Building | null = null;
      let bestSiteD = 60;
      for (const s of sites) {
        const d = BABYLON.Vector3.Distance(m.position, s.position);
        if (d < bestSiteD) { bestSiteD = d; bestSite = s; }
      }
      if (bestSite) {
        m.commandBuild(bestSite);
        assigned++;
        continue;
      }

      let bestNode: ResourceNode | null = null;
      let bestNodeD = 45;
      for (const n of this.nodes) {
        if (n.depleted) continue;
        const d = BABYLON.Vector3.Distance(m.position, n.position);
        if (d < bestNodeD) { bestNodeD = d; bestNode = n; }
      }
      if (bestNode) {
        m.commandGather(bestNode);
        assigned++;
      }
    }
    if (assigned > 0) this.toast(`👶 ${assigned} idle minion${assigned > 1 ? 's' : ''} found work`);
  }

  private nearestMinions(pos: BABYLON.Vector3, count: number): Minion[] {
    return this.minions
      .filter((m) => m.alive)
      .sort((a, b) => BABYLON.Vector3.Distance(a.position, pos) - BABYLON.Vector3.Distance(b.position, pos))
      .slice(0, count);
  }

  // ── Level 1: Anga ──────────────────────────────────────────────

  private setupLevel(): void {
    this.nodes = this.world.spawnLevelResources();

    const basePos = new BABYLON.Vector3(-55, 0, -55);
    this.townCenter = new Building(this.scene, this.world, 'townCenter', basePos, 'player', true);
    this.buildings.push(this.townCenter);

    const patch = BABYLON.MeshBuilder.CreateDisc('basePatch', { radius: 9, tessellation: 36 }, this.scene);
    patch.rotation.x = Math.PI / 2;
    patch.position.set(basePos.x, this.world.getHeight(basePos.x, basePos.z) + 0.06, basePos.z);
    patch.material = pastel(this.scene, 'dirtPatch', new BABYLON.Color3(0.82, 0.72, 0.52));
    patch.isPickable = false;

    const hero = new Warrior(this.scene, this.world, basePos.add(new BABYLON.Vector3(4, 0, 6)), 'hero');
    this.registerUnit(hero);
    this.warriors.push(hero);
    for (let i = 0; i < 4; i++) {
      this.spawnMinion(basePos.add(new BABYLON.Vector3(-4 + i * 2.2, 0, 7)));
    }

    const campGround = BABYLON.MeshBuilder.CreateDisc('campPatch', { radius: 14, tessellation: 36 }, this.scene);
    campGround.rotation.x = Math.PI / 2;
    campGround.position.set(this.enemyCampPos.x, this.world.getHeight(this.enemyCampPos.x, this.enemyCampPos.z) + 0.06, this.enemyCampPos.z);
    campGround.material = pastel(this.scene, 'campPatch', new BABYLON.Color3(0.45, 0.4, 0.5));
    campGround.isPickable = false;

    this.totem = new Building(this.scene, this.world, 'enemyTotem', this.enemyCampPos, 'enemy', true);
    this.buildings.push(this.totem);
    for (let i = 0; i < 4; i++) this.spawnEnemy();

    this.toast('Welcome to Anga, land of Karna! 🌅 Gather, build, and rise.');
    setTimeout(() => this.toast('🎯 Destroy the Dark Totem in the north-east to conquer Anga!'), 2600);
    setTimeout(() => this.toast('Tip: build a 🌾 Farm or 🎣 Fishing Dock — armies march on food'), 5600);
  }

  private spawnEnemy(): void {
    const a = Math.random() * Math.PI * 2;
    const pos = this.enemyCampPos.add(new BABYLON.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
    this.enemySpawnCount++;
    const variant = this.enemySpawnCount % 3 === 0 ? 'darkRider' : 'brute';
    const enemy = new Warrior(this.scene, this.world, pos, variant, 1, this.enemyCampPos);
    this.registerUnit(enemy);
    this.enemies.push(enemy);
  }

  // ── Main loop ──────────────────────────────────────────────────

  start(): void {
    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);

      this.cameraRig.update(dt, this.input);

      const allUnits = [...this.minions, ...this.warriors, ...this.enemies];
      this.minions = this.minions.filter((m) => !m.update(dt, this));
      this.warriors = this.warriors.filter((w) => !w.update(dt, this));
      this.enemies = this.enemies.filter((e) => !e.update(dt, this));
      for (const u of allUnits) {
        u.applySeparation(allUnits, dt);
        u.collideWithBuildings(this.buildings);
      }
      this.buildings = this.buildings.filter((b) => !b.update(dt, this));
      this.nodes = this.nodes.filter((n) => !n.update(dt));

      // Idle minions find their own work
      this.autoAssignTimer -= dt;
      if (this.autoAssignTimer <= 0) {
        this.autoAssignTimer = 3;
        this.autoAssignIdleMinions();
      }

      // Consume construction-finished flags
      for (const b of this.buildings) {
        if (b.justCompleted) {
          b.justCompleted = false;
          this.onBuildingCompleted(b);
        }
      }

      // Silk Route passive income
      if (this.research.silkRoute) {
        this.goldTrickle += dt;
        if (this.goldTrickle >= 2) {
          this.goldTrickle -= 2;
          this.resources.gold += 1;
        }
      }

      // The totem raises its army — brutes, and dark riders every third spawn
      if (this.totem.alive) {
        this.enemySpawnTimer -= dt;
        if (this.enemySpawnTimer <= 0) {
          this.enemySpawnTimer = ENEMY_SPAWN_INTERVAL;
          if (this.enemies.filter((e) => e.alive).length < MAX_ENEMIES) {
            this.spawnEnemy();
            this.toast(this.enemySpawnCount % 3 === 0 ? 'A Dark Rider gallops from the totem! 🐴' : 'The Dark Totem spawned a brute! 👹');
          }
        }
      }

      this.story.update(dt);
      this.selection.prune();
      this.world.update(dt);
      this.wildlife.update(dt, this);
      this.hud.tick(dt);
      this.checkEndConditions();

      this.scene.render();
    });
  }

  private checkEndConditions(): void {
    if (this.gameOver) return;
    const enemyAlive = this.totem.alive || this.enemies.some((e) => e.alive);
    if (!enemyAlive) {
      this.gameOver = true;
      this.hud.showVictory();
      return;
    }
    if (!this.townCenter.alive) {
      this.gameOver = true;
      this.hud.showDefeat();
    }
  }
}
