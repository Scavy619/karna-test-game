import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { World } from '../world/World';
import { Damageable, Team } from '../entities/Unit';
import { FX } from '../systems/Effects';
import { Sfx } from '../systems/Sound';
import type { ResourceNode } from '../world/ResourceNode';
import type { Game } from '../Game';

export type BuildingKey =
  | 'townCenter' | 'library' | 'barracks' | 'farm' | 'fishingDock'
  | 'warStable' | 'temple' | 'wall' | 'gate' | 'watchtower' | 'enemyTotem';

const TOWER_RANGE = 13;
const TOWER_DAMAGE = 9;
const TOWER_COOLDOWN = 1.4;

export interface Cost {
  wood?: number;
  stone?: number;
  gold?: number;
  food?: number;
}

export interface BuildingDef {
  key: BuildingKey;
  name: string;
  icon: string;
  hp: number;
  footprint: number;
  cost: Cost;
  buildSeconds: number;
  requiresAge?: number; // minimum age to build (default 1)
  /** Drag-placed in a continuous line (walls). Segment spacing below. */
  chainable?: boolean;
  /** Distance between chained segments; the visual is ~3.6 wide, so this overlaps slightly. */
  chainSpacing?: number;
}

export const BUILDING_DEFS: Record<BuildingKey, BuildingDef> = {
  townCenter:  { key: 'townCenter',  name: 'Town Center',   icon: '🏠', hp: 600, footprint: 4.5, cost: {}, buildSeconds: 20 },
  library:     { key: 'library',     name: 'Library',       icon: '📚', hp: 350, footprint: 3.5, cost: { wood: 120, stone: 60 }, buildSeconds: 14 },
  barracks:    { key: 'barracks',    name: 'Barracks',      icon: '⚔️', hp: 400, footprint: 4.0, cost: { wood: 100, stone: 40 }, buildSeconds: 14 },
  farm:        { key: 'farm',        name: 'Farm',          icon: '🌾', hp: 250, footprint: 3.2, cost: { wood: 60 }, buildSeconds: 10 },
  fishingDock: { key: 'fishingDock', name: 'Fishing Dock',  icon: '🎣', hp: 220, footprint: 3.0, cost: { wood: 80 }, buildSeconds: 10 },
  warStable:   { key: 'warStable',   name: 'War Stable',    icon: '🐎', hp: 420, footprint: 4.2, cost: { wood: 120, gold: 60 }, buildSeconds: 16, requiresAge: 2 },
  temple:      { key: 'temple',      name: 'Temple',        icon: '🛕', hp: 380, footprint: 3.8, cost: { stone: 100, gold: 80 }, buildSeconds: 16 },
  wall:        { key: 'wall',        name: 'Stone Wall',    icon: '🧱', hp: 500, footprint: 2.0, cost: { stone: 20 }, buildSeconds: 4, chainable: true, chainSpacing: 3.3 },
  gate:        { key: 'gate',        name: 'Gate',          icon: '🚪', hp: 450, footprint: 2.2, cost: { stone: 40, wood: 20 }, buildSeconds: 6 },
  watchtower:  { key: 'watchtower',  name: 'Watchtower',    icon: '🗼', hp: 450, footprint: 2.0, cost: { stone: 80, wood: 40 }, buildSeconds: 12 },
  enemyTotem:  { key: 'enemyTotem',  name: 'Dark Totem',    icon: '🗿', hp: 550, footprint: 3.0, cost: {}, buildSeconds: 1 },
};

/** Defensive structures may be chained close together (wall lines). */
export const COMPACT_KEYS: BuildingKey[] = ['wall', 'gate', 'watchtower'];

/** Minimum spacing between two chained defensive pieces. */
export const COMPACT_MIN_DIST = 1.6;

export interface QueueItem {
  label: string;
  duration: number;
  remaining: number;
  onComplete: (game: Game, building: Building) => void;
}

/**
 * All placed structures: construction, damage, production queues, and a
 * little completion bounce. Farms and Fishing Docks get a linked food
 * ResourceNode (created by Game when they finish).
 */
export class Building implements Damageable {
  readonly def: BuildingDef;
  readonly team: Team;
  readonly root: BABYLON.TransformNode;
  readonly radius: number;

  hp: number;
  maxHp: number;
  alive = true;
  completed: boolean;
  progress: number;
  queue: QueueItem[] = [];
  /** Set true for one frame when construction finishes; Game consumes it. */
  justCompleted = false;
  /** For farms/docks: the wheat/fish node minions actually harvest. */
  foodNode: ResourceNode | null = null;

  private meshes: BABYLON.Mesh[] = [];
  private ring: BABYLON.Mesh;
  private dyingT = -1;
  private bounceT = -1;
  private time = Math.random() * 10;
  private towerTimer = 0;
  private swayMeshes: BABYLON.Mesh[] = [];
  private scene: BABYLON.Scene;

  constructor(
    scene: BABYLON.Scene,
    world: World,
    key: BuildingKey,
    pos: BABYLON.Vector3,
    team: Team,
    completed: boolean,
    yaw = 0
  ) {
    this.scene = scene;
    this.def = BUILDING_DEFS[key];
    this.team = team;
    this.radius = this.def.footprint;
    this.completed = completed;
    this.progress = completed ? 1 : 0;
    this.maxHp = this.def.hp;
    this.hp = completed ? this.def.hp : Math.round(this.def.hp * 0.1);

    this.root = new BABYLON.TransformNode('bld_' + key, scene);
    this.root.position.set(pos.x, world.getHeight(pos.x, pos.z), pos.z);
    this.root.rotation.y = yaw;

    this.buildVisual(key);
    for (const m of this.meshes) world.addShadowCaster(m);

    if (!completed) this.root.scaling.y = 0.15;

    this.ring = BABYLON.MeshBuilder.CreateTorus('bring', { diameter: this.def.footprint * 2.2, thickness: 0.12, tessellation: 40 }, scene);
    this.ring.parent = this.root;
    this.ring.position.y = 0.1;
    this.ring.material = pastel(scene, 'selectRing', new BABYLON.Color3(0.4, 0.95, 0.5), { glow: 0.9, disableLighting: true });
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
  }

  private add(mesh: BABYLON.Mesh, material: BABYLON.Material): BABYLON.Mesh {
    mesh.parent = this.root;
    mesh.material = material;
    mesh.metadata = { owner: this };
    this.meshes.push(mesh);
    return mesh;
  }

  private buildVisual(key: BuildingKey): void {
    const scene = this.scene;
    const wood = pastel(scene, 'bldWood', new BABYLON.Color3(0.78, 0.62, 0.42));
    const cream = pastel(scene, 'bldCream', new BABYLON.Color3(0.95, 0.9, 0.78));
    const roofRed = pastel(scene, 'roofRed', new BABYLON.Color3(0.85, 0.4, 0.35));
    const roofTeal = pastel(scene, 'roofTeal', new BABYLON.Color3(0.35, 0.68, 0.66));
    const gold = pastel(scene, 'bldGold', new BABYLON.Color3(0.95, 0.8, 0.3), { glow: 0.4, specular: 0.5 });

    if (key === 'townCenter') {
      const base = this.add(BABYLON.MeshBuilder.CreateBox('base', { width: 6.5, height: 3, depth: 6.5 }, scene), cream);
      base.position.y = 1.5;
      const roof = this.add(
        BABYLON.MeshBuilder.CreateCylinder('roof', { height: 2.6, diameterBottom: 8.2, diameterTop: 0.3, tessellation: 4 }, scene),
        roofRed
      );
      roof.position.y = 4.3;
      roof.rotation.y = Math.PI / 4;
      const door = this.add(BABYLON.MeshBuilder.CreateBox('door', { width: 1.4, height: 2, depth: 0.2 }, scene), wood);
      door.position.set(0, 1, 3.3);
      const pole = this.add(BABYLON.MeshBuilder.CreateCylinder('pole', { height: 3.4, diameter: 0.14 }, scene), wood);
      pole.position.set(2.6, 6.3, 2.6);
      const flag = this.add(BABYLON.MeshBuilder.CreateBox('flag', { width: 1.2, height: 0.7, depth: 0.05 }, scene),
        pastel(scene, 'flagBlue', new BABYLON.Color3(0.4, 0.6, 0.95), { glow: 0.3 }));
      flag.position.set(3.2, 7.5, 2.6);
      this.swayMeshes.push(flag);
    } else if (key === 'library') {
      const base = this.add(BABYLON.MeshBuilder.CreateBox('base', { width: 5, height: 3.2, depth: 5 }, scene), cream);
      base.position.y = 1.6;
      const dome = this.add(BABYLON.MeshBuilder.CreateSphere('dome', { diameter: 4.4, segments: 12, slice: 0.5 }, scene), roofTeal);
      dome.position.y = 3.2;
      const spire = this.add(BABYLON.MeshBuilder.CreateCylinder('spire', { height: 1.2, diameterBottom: 0.3, diameterTop: 0.02 }, scene), gold);
      spire.position.y = 5.8;
      const book = this.add(BABYLON.MeshBuilder.CreateBox('book', { width: 1.5, height: 1.1, depth: 0.4 }, scene),
        pastel(scene, 'bookRed', new BABYLON.Color3(0.8, 0.35, 0.35)));
      book.position.set(0, 1.7, 2.6);
      book.rotation.x = -0.25;
    } else if (key === 'barracks') {
      const base = this.add(BABYLON.MeshBuilder.CreateBox('base', { width: 6, height: 2.6, depth: 4.6 }, scene), wood);
      base.position.y = 1.3;
      const roof = this.add(
        BABYLON.MeshBuilder.CreateCylinder('roof', { height: 2.2, diameterBottom: 7.4, diameterTop: 0.2, tessellation: 3 }, scene),
        roofRed
      );
      roof.position.y = 3.7;
      roof.rotation.y = Math.PI / 6;
      const swordSign = this.add(BABYLON.MeshBuilder.CreateBox('sign', { width: 0.18, height: 2.2, depth: 0.06 }, scene),
        pastel(scene, 'signSteel', new BABYLON.Color3(0.8, 0.83, 0.9), { specular: 0.5, glow: 0.25 }));
      swordSign.position.set(0, 2.4, 2.5);
      swordSign.rotation.z = 0.5;
    } else if (key === 'farm') {
      // Tilled soil plot with wheat rows and fence posts
      const soil = this.add(BABYLON.MeshBuilder.CreateBox('soil', { width: 5.6, height: 0.3, depth: 5.6 }, scene),
        pastel(scene, 'soil', new BABYLON.Color3(0.55, 0.42, 0.3)));
      soil.position.y = 0.15;
      const wheatMat = pastel(scene, 'wheat', new BABYLON.Color3(0.92, 0.82, 0.4), { glow: 0.2 });
      for (let rx = -1; rx <= 1; rx++) {
        for (let rz = -1; rz <= 1; rz++) {
          const tuft = this.add(
            BABYLON.MeshBuilder.CreateCylinder('tuft', { height: 0.8, diameterBottom: 0.34, diameterTop: 0.06 }, scene),
            wheatMat
          );
          tuft.position.set(rx * 1.5, 0.7, rz * 1.5);
          this.swayMeshes.push(tuft);
        }
      }
      for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
        const post = this.add(BABYLON.MeshBuilder.CreateCylinder('post', { height: 0.9, diameter: 0.16 }, scene), wood);
        post.position.set(px, 0.45, pz);
      }
    } else if (key === 'fishingDock') {
      // Plank walkway + little hut + mooring poles
      const planks = this.add(BABYLON.MeshBuilder.CreateBox('planks', { width: 2.2, height: 0.25, depth: 5.5 }, scene), wood);
      planks.position.set(0, 0.5, 0.8);
      const hut = this.add(BABYLON.MeshBuilder.CreateBox('hut', { width: 2, height: 1.6, depth: 1.8 }, scene), cream);
      hut.position.set(0, 1.3, -1.2);
      const roof = this.add(
        BABYLON.MeshBuilder.CreateCylinder('hutRoof', { height: 1.1, diameterBottom: 3, diameterTop: 0.2, tessellation: 4 }, scene),
        roofTeal
      );
      roof.position.set(0, 2.6, -1.2);
      roof.rotation.y = Math.PI / 4;
      for (const z of [1.6, 3.2]) {
        const pole = this.add(BABYLON.MeshBuilder.CreateCylinder('mpole', { height: 1.4, diameter: 0.18 }, scene), wood);
        pole.position.set(1.2, 0.9, z);
      }
    } else if (key === 'warStable') {
      const barn = this.add(BABYLON.MeshBuilder.CreateBox('barn', { width: 6.4, height: 2.8, depth: 4.8 }, scene),
        pastel(scene, 'barnWood', new BABYLON.Color3(0.68, 0.45, 0.3)));
      barn.position.y = 1.4;
      const roof = this.add(
        BABYLON.MeshBuilder.CreateCylinder('barnRoof', { height: 2.4, diameterBottom: 8, diameterTop: 0.3, tessellation: 3 }, scene),
        cream
      );
      roof.position.y = 4.1;
      roof.rotation.y = Math.PI / 6;
      // Little horse statue on a post
      const post = this.add(BABYLON.MeshBuilder.CreateCylinder('sPost', { height: 1.6, diameter: 0.2 }, scene), wood);
      post.position.set(0, 0.8, 3);
      const statue = this.add(BABYLON.MeshBuilder.CreateBox('statue', { width: 0.3, height: 0.5, depth: 0.8 }, scene), gold);
      statue.position.set(0, 1.9, 3);
    } else if (key === 'temple') {
      // Stepped shikhara tower: stacked shrinking blocks + gold spire + flag
      const stoneMat = pastel(scene, 'templeStone', new BABYLON.Color3(0.9, 0.82, 0.68));
      const sizes = [4.6, 3.4, 2.3, 1.3];
      let y = 0;
      for (let i = 0; i < sizes.length; i++) {
        const h = i === 0 ? 2 : 1.1;
        const block = this.add(BABYLON.MeshBuilder.CreateBox('tier' + i, { width: sizes[i], height: h, depth: sizes[i] }, scene), stoneMat);
        block.position.y = y + h / 2;
        y += h;
      }
      const spire = this.add(BABYLON.MeshBuilder.CreateCylinder('tSpire', { height: 1.1, diameterBottom: 0.5, diameterTop: 0.02 }, scene), gold);
      spire.position.y = y + 0.55;
      const flag = this.add(BABYLON.MeshBuilder.CreateBox('tFlag', { width: 0.8, height: 0.5, depth: 0.04 }, scene),
        pastel(scene, 'flagSaffron', new BABYLON.Color3(0.98, 0.6, 0.2), { glow: 0.35 }));
      flag.position.set(0.55, y + 1.0, 0);
      this.swayMeshes.push(flag);
      const door = this.add(BABYLON.MeshBuilder.CreateBox('tDoor', { width: 1, height: 1.4, depth: 0.2 }, scene),
        pastel(scene, 'tDoorMat', new BABYLON.Color3(0.5, 0.3, 0.2)));
      door.position.set(0, 0.7, 2.35);
    } else if (key === 'wall') {
      // Stone segment with crenellations
      const stoneMat = pastel(scene, 'wallStone', new BABYLON.Color3(0.72, 0.7, 0.68));
      const seg = this.add(BABYLON.MeshBuilder.CreateBox('seg', { width: 3.6, height: 1.9, depth: 1.2 }, scene), stoneMat);
      seg.position.y = 0.95;
      for (let i = -1; i <= 1; i++) {
        const merlon = this.add(BABYLON.MeshBuilder.CreateBox('merlon', { width: 0.7, height: 0.55, depth: 1.2 }, scene), stoneMat);
        merlon.position.set(i * 1.25, 2.15, 0);
      }
    } else if (key === 'gate') {
      // Two pillars + beam, portcullis raised so friends walk under
      const stoneMat = pastel(scene, 'wallStone', new BABYLON.Color3(0.72, 0.7, 0.68));
      for (const side of [-1, 1]) {
        const pillar = this.add(BABYLON.MeshBuilder.CreateBox('pillar', { width: 1, height: 3, depth: 1.3 }, scene), stoneMat);
        pillar.position.set(side * 1.7, 1.5, 0);
      }
      const beam = this.add(BABYLON.MeshBuilder.CreateBox('beam', { width: 4.4, height: 0.7, depth: 1.3 }, scene), stoneMat);
      beam.position.y = 3.3;
      const portcullis = this.add(BABYLON.MeshBuilder.CreateBox('portcullis', { width: 2.4, height: 1.1, depth: 0.15 }, scene), wood);
      portcullis.position.y = 2.4;
    } else if (key === 'watchtower') {
      const stoneMat = pastel(scene, 'wallStone', new BABYLON.Color3(0.72, 0.7, 0.68));
      const tower = this.add(
        BABYLON.MeshBuilder.CreateCylinder('tower', { height: 4.6, diameterBottom: 2.4, diameterTop: 1.9, tessellation: 8 }, scene),
        stoneMat
      );
      tower.position.y = 2.3;
      const platform = this.add(BABYLON.MeshBuilder.CreateCylinder('platform', { height: 0.35, diameter: 2.8, tessellation: 8 }, scene), wood);
      platform.position.y = 4.75;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const merlon = this.add(BABYLON.MeshBuilder.CreateBox('tMerlon', { width: 0.5, height: 0.5, depth: 0.3 }, scene), stoneMat);
        merlon.position.set(Math.cos(a) * 1.2, 5.2, Math.sin(a) * 1.2);
        merlon.rotation.y = -a;
      }
      const flag = this.add(BABYLON.MeshBuilder.CreateBox('twFlag', { width: 0.7, height: 0.45, depth: 0.04 }, scene),
        pastel(scene, 'flagBlue', new BABYLON.Color3(0.4, 0.6, 0.95), { glow: 0.3 }));
      flag.position.set(0.4, 6, 0);
      this.swayMeshes.push(flag);
    } else {
      // Enemy totem
      const dark = pastel(scene, 'totemDark', new BABYLON.Color3(0.25, 0.2, 0.32));
      const obelisk = this.add(
        BABYLON.MeshBuilder.CreateCylinder('obelisk', { height: 5.5, diameterBottom: 2.6, diameterTop: 1.2, tessellation: 6 }, scene),
        dark
      );
      obelisk.position.y = 2.75;
      const crystal = this.add(
        BABYLON.MeshBuilder.CreateIcoSphere('crystal', { radius: 0.9, subdivisions: 1, flat: true }, scene),
        pastel(scene, 'totemCrystal', new BABYLON.Color3(0.7, 0.3, 0.9), { glow: 0.8 })
      );
      crystal.position.y = 6.2;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = this.add(
          BABYLON.MeshBuilder.CreateCylinder('spike', { height: 1.6, diameterBottom: 0.5, diameterTop: 0.02 }, scene),
          dark
        );
        spike.position.set(Math.cos(a) * 3.4, 0.8, Math.sin(a) * 3.4);
        spike.rotation.z = Math.cos(a) * 0.35;
        spike.rotation.x = -Math.sin(a) * 0.35;
      }
    }
  }

  get position(): BABYLON.Vector3 {
    return this.root.position;
  }

  getMeshes(): BABYLON.Mesh[] {
    return this.meshes;
  }

  setSelected(v: boolean): void {
    this.ring.setEnabled(v && this.alive);
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dyingT = 0;
      this.ring.setEnabled(false);
      if (this.foodNode && !this.foodNode.depleted) this.foodNode.harvest(this.foodNode.amount);
    }
  }

  addBuildEffort(dt: number): void {
    if (this.completed || !this.alive) return;
    this.progress += dt / this.def.buildSeconds;
    this.hp = Math.max(this.hp, Math.round(this.maxHp * Math.min(1, 0.1 + this.progress * 0.9)));
    this.root.scaling.y = 0.15 + 0.85 * Math.min(1, this.progress);
    if (this.progress >= 1) {
      this.completed = true;
      this.justCompleted = true;
      this.bounceT = 0;
      this.root.scaling.y = 1;
      this.hp = this.maxHp;
    }
  }

  queueItem(label: string, duration: number, onComplete: QueueItem['onComplete']): void {
    this.queue.push({ label, duration, remaining: duration, onComplete });
  }

  update(dt: number, game: Game): boolean {
    this.time += dt;

    // Flags & wheat sway gently
    for (const m of this.swayMeshes) {
      m.rotation.z = Math.sin(this.time * 2 + m.position.x) * 0.12;
    }

    // Completion bounce
    if (this.bounceT >= 0) {
      this.bounceT += dt;
      const t = Math.min(1, this.bounceT / 0.4);
      const s = 1 + Math.sin(t * Math.PI) * 0.12;
      this.root.scaling.set(s, s, s);
      if (t >= 1) {
        this.root.scaling.setAll(1);
        this.bounceT = -1;
      }
    }

    if (this.alive && this.completed && this.queue.length > 0) {
      const item = this.queue[0];
      item.remaining -= dt;
      if (item.remaining <= 0) {
        this.queue.shift();
        item.onComplete(game, this);
      }
    }

    // Watchtower: rain arrows on the nearest enemy in range
    if (this.def.key === 'watchtower' && this.alive && this.completed && this.team === 'player') {
      this.towerTimer -= dt;
      if (this.towerTimer <= 0) {
        let best: { position: BABYLON.Vector3; takeDamage(n: number): void } | null = null;
        let bestD = TOWER_RANGE;
        for (const e of game.enemies) {
          if (!e.alive) continue;
          const d = BABYLON.Vector3.Distance(this.position, e.position);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (best) {
          this.towerTimer = TOWER_COOLDOWN;
          best.takeDamage(TOWER_DAMAGE);
          FX.spark(best.position.add(new BABYLON.Vector3(0, 1.2, 0)));
          Sfx.play('arrow');
        }
      }
    }
    if (this.dyingT >= 0) {
      this.dyingT += dt;
      const t = Math.min(1, this.dyingT / 0.8);
      this.root.scaling.y = (1 - t) * this.root.scaling.y;
      this.root.scaling.x = 1 + t * 0.3;
      this.root.scaling.z = 1 + t * 0.3;
      if (t >= 1) {
        this.root.dispose();
        return true;
      }
    }
    return false;
  }
}
