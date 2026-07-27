import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { World } from '../world/World';
import { FX } from '../systems/Effects';
import { Sfx } from '../systems/Sound';
import type { Building } from '../buildings/Building';
import type { Game } from '../Game';

export type Team = 'player' | 'enemy';

/** Anything that can be attacked: units and buildings both implement this. */
export interface Damageable {
  readonly position: BABYLON.Vector3;
  readonly radius: number;
  alive: boolean;
  takeDamage(amount: number): void;
}

export interface UnitOpts {
  hp: number;
  speed: number;
  team: Team;
  scale?: number;
  barY?: number;      // HP bar height (taller for mounted units)
  ringScale?: number; // selection ring size (bigger for chariots)
  radius?: number;    // collision/separation radius
}

/**
 * Base class for all walking characters (minions, warriors, enemies).
 * Handles: chibi body construction, movement + terrain following,
 * HP bar, selection ring, separation from crowd, and death animation.
 */
export abstract class Unit implements Damageable {
  readonly root: BABYLON.TransformNode;
  readonly model: BABYLON.TransformNode;
  readonly team: Team;
  readonly radius: number;

  hp: number;
  maxHp: number;
  speed: number;
  alive = true;
  moveTarget: BABYLON.Vector3 | null = null;
  /** The enemy-team building that physically blocked us this frame (walls!). */
  blockedBy: Building | null = null;

  protected scene: BABYLON.Scene;
  protected world: World;
  protected meshes: BABYLON.Mesh[] = [];
  protected leftArm!: BABYLON.TransformNode;
  protected rightArm!: BABYLON.TransformNode;
  protected leftLeg!: BABYLON.TransformNode;
  protected rightLeg!: BABYLON.TransformNode;

  protected yaw = 0;
  protected walkPhase = 0;
  private dyingT = -1;
  private pulseT = 0;
  private baseRingScale = 1;

  private ring: BABYLON.Mesh;
  private hpBarBg: BABYLON.Mesh;
  private hpBarFg: BABYLON.Mesh;

  constructor(scene: BABYLON.Scene, world: World, pos: BABYLON.Vector3, opts: UnitOpts) {
    this.scene = scene;
    this.world = world;
    this.team = opts.team;
    this.hp = this.maxHp = opts.hp;
    this.speed = opts.speed;
    this.radius = opts.radius ?? 0.55;

    this.root = new BABYLON.TransformNode('unit', scene);
    this.root.position.set(pos.x, world.getHeight(pos.x, pos.z), pos.z);
    this.model = new BABYLON.TransformNode('unitModel', scene);
    this.model.parent = this.root;
    if (opts.scale) this.model.scaling.setAll(opts.scale);

    // Selection ring (hidden until selected)
    this.ring = BABYLON.MeshBuilder.CreateTorus('ring', { diameter: 1.8, thickness: 0.09, tessellation: 28 }, scene);
    this.ring.parent = this.root;
    this.ring.position.y = 0.12;
    this.ring.material = pastel(scene, 'selectRing', new BABYLON.Color3(0.4, 0.95, 0.5), { glow: 0.9, disableLighting: true });
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    this.baseRingScale = opts.ringScale ?? 1;
    this.ring.scaling.setAll(this.baseRingScale);

    // HP bar (billboard, shows when hurt or selected)
    const barMatBg = pastel(scene, 'hpBg', new BABYLON.Color3(0.15, 0.12, 0.12), { glow: 0.6, disableLighting: true });
    const barMatFg = pastel(
      scene,
      opts.team === 'player' ? 'hpFgGreen' : 'hpFgRed',
      opts.team === 'player' ? new BABYLON.Color3(0.35, 0.9, 0.4) : new BABYLON.Color3(0.95, 0.35, 0.3),
      { glow: 0.9, disableLighting: true }
    );
    this.hpBarBg = BABYLON.MeshBuilder.CreatePlane('hpBg', { width: 1.3, height: 0.16 }, scene);
    this.hpBarBg.parent = this.root;
    this.hpBarBg.position.y = opts.barY ?? 2.35;
    this.hpBarBg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.hpBarBg.material = barMatBg;
    this.hpBarBg.isPickable = false;
    this.hpBarFg = BABYLON.MeshBuilder.CreatePlane('hpFg', { width: 1.24, height: 0.1 }, scene);
    this.hpBarFg.parent = this.hpBarBg;
    this.hpBarFg.position.z = -0.01;
    this.hpBarFg.material = barMatFg;
    this.hpBarFg.isPickable = false;
    this.hpBarBg.setEnabled(false);
  }

  /** Builds the cute chibi body. Call from subclass constructors. */
  protected buildChibi(bodyColor: BABYLON.Color3, bodyMatName: string): void {
    const scene = this.scene;
    const skin = pastel(scene, 'chibiSkin', new BABYLON.Color3(0.97, 0.85, 0.7));
    const bodyMat = pastel(scene, bodyMatName, bodyColor);

    const body = this.addMesh(
      BABYLON.MeshBuilder.CreateCapsule('body', { height: 0.8, radius: 0.32 }, scene),
      this.model, bodyMat
    );
    body.position.y = 0.65;

    const head = this.addMesh(
      BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.66, segments: 10 }, scene),
      this.model, skin
    );
    head.position.y = 1.38;

    this.leftArm = new BABYLON.TransformNode('lArm', scene);
    this.leftArm.parent = this.model;
    this.leftArm.position.set(-0.4, 1.0, 0);
    const la = this.addMesh(
      BABYLON.MeshBuilder.CreateCapsule('la', { height: 0.45, radius: 0.1 }, scene),
      this.leftArm, skin
    );
    la.position.y = -0.22;

    this.rightArm = new BABYLON.TransformNode('rArm', scene);
    this.rightArm.parent = this.model;
    this.rightArm.position.set(0.4, 1.0, 0);
    const ra = this.addMesh(
      BABYLON.MeshBuilder.CreateCapsule('ra', { height: 0.45, radius: 0.1 }, scene),
      this.rightArm, skin
    );
    ra.position.y = -0.22;

    this.leftLeg = new BABYLON.TransformNode('lLeg', scene);
    this.leftLeg.parent = this.model;
    this.leftLeg.position.set(-0.14, 0.34, 0);
    const ll = this.addMesh(
      BABYLON.MeshBuilder.CreateCapsule('ll', { height: 0.32, radius: 0.11 }, scene),
      this.leftLeg, bodyMat
    );
    ll.position.y = -0.15;

    this.rightLeg = new BABYLON.TransformNode('rLeg', scene);
    this.rightLeg.parent = this.model;
    this.rightLeg.position.set(0.14, 0.34, 0);
    const rl = this.addMesh(
      BABYLON.MeshBuilder.CreateCapsule('rl', { height: 0.32, radius: 0.11 }, scene),
      this.rightLeg, bodyMat
    );
    rl.position.y = -0.15;
  }

  protected addMesh(mesh: BABYLON.Mesh, parent: BABYLON.Node, material: BABYLON.Material): BABYLON.Mesh {
    mesh.parent = parent;
    mesh.material = material;
    mesh.metadata = { owner: this };
    this.meshes.push(mesh);
    return mesh;
  }

  getMeshes(): BABYLON.Mesh[] {
    return this.meshes;
  }

  get position(): BABYLON.Vector3 {
    return this.root.position;
  }

  setSelected(v: boolean): void {
    this.ring.setEnabled(v && this.alive);
    this.refreshHpBar();
  }

  get isSelected(): boolean {
    return this.ring.isEnabled();
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.refreshHpBar();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dyingT = 0;
      this.ring.setEnabled(false);
      this.hpBarBg.setEnabled(false);
      FX.death(this.position.add(new BABYLON.Vector3(0, 1, 0)));
      Sfx.play('death');
    }
  }

  private refreshHpBar(): void {
    const p = Math.max(0, this.hp / this.maxHp);
    this.hpBarFg.scaling.x = p;
    this.hpBarFg.position.x = -(1 - p) * 1.24 / 2;
    this.hpBarBg.setEnabled(this.alive && (p < 1 || this.isSelected));
  }

  commandMove(dest: BABYLON.Vector3): void {
    this.moveTarget = dest.clone();
  }

  /** Move toward moveTarget. Returns true when arrived (and clears it). */
  protected stepMovement(dt: number): boolean {
    if (!this.moveTarget) return false;
    const to = this.moveTarget.subtract(this.root.position);
    to.y = 0;
    const dist = to.length();
    if (dist < 0.5) {
      this.moveTarget = null;
      return true;
    }
    to.normalize();
    this.root.position.addInPlace(to.scale(Math.min(this.speed * dt, dist)));
    this.faceToward(to);
    this.animateWalk(dt);
    return false;
  }

  protected faceToward(dir: BABYLON.Vector3): void {
    const targetYaw = Math.atan2(dir.x, dir.z);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * 0.25;
    this.root.rotation.y = this.yaw;
  }

  protected animateWalk(dt: number): void {
    this.walkPhase += dt * 11;
    const s = Math.sin(this.walkPhase);
    this.leftLeg.rotation.x = s * 0.8;
    this.rightLeg.rotation.x = -s * 0.8;
    this.model.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.05;
  }

  protected restPose(dt: number): void {
    const e = Math.min(1, dt * 8);
    this.leftLeg.rotation.x += (0 - this.leftLeg.rotation.x) * e;
    this.rightLeg.rotation.x += (0 - this.rightLeg.rotation.x) * e;
    this.model.position.y += (0 - this.model.position.y) * e;
  }

  /**
   * Buildings are solid: push units out of their footprint. Gates let their
   * own team walk through. Records blockedBy so enemies can bash walls.
   */
  collideWithBuildings(buildings: Building[]): void {
    this.blockedBy = null;
    if (!this.alive) return;
    for (const b of buildings) {
      if (!b.alive) continue;
      if (b.def.key === 'gate' && b.team === this.team) continue;
      const dx = this.root.position.x - b.position.x;
      const dz = this.root.position.z - b.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = b.radius * 0.85 + this.radius;
      if (dist > 0.001 && dist < minDist) {
        const push = (minDist - dist) / dist;
        this.root.position.x += dx * push;
        this.root.position.z += dz * push;
        if (b.team !== this.team) this.blockedBy = b;
      }
    }
  }

  /** Gentle push so crowds don't stack into one spot. */
  applySeparation(others: Unit[], dt: number): void {
    if (!this.alive) return;
    for (const other of others) {
      if (other === this || !other.alive) continue;
      const d = this.root.position.subtract(other.root.position);
      d.y = 0;
      const dist = d.length();
      const minDist = this.radius + other.radius + 0.1;
      if (dist > 0.001 && dist < minDist) {
        d.normalize();
        this.root.position.addInPlace(d.scale((minDist - dist) * Math.min(1, dt * 6)));
      }
    }
  }

  /** Snap to terrain + death animation. Returns true when fully gone (dispose me). */
  protected updateCommon(dt: number): boolean {
    this.root.position.y = this.world.getHeight(this.root.position.x, this.root.position.z);
    // Selected rings breathe gently
    this.pulseT += dt;
    if (this.ring.isEnabled()) {
      this.ring.scaling.setAll(this.baseRingScale * (1 + Math.sin(this.pulseT * 5) * 0.06));
    }
    if (this.dyingT >= 0) {
      this.dyingT += dt;
      const t = Math.min(1, this.dyingT / 0.6);
      this.model.rotation.x = -t * Math.PI / 2;
      this.model.scaling.scaleInPlace(1 - 0.5 * dt);
      if (t >= 1) {
        this.root.dispose();
        return true;
      }
    }
    return false;
  }

  abstract update(dt: number, game: Game): boolean;
}
