import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { Unit } from './Unit';
import { World } from '../world/World';
import { ResourceNode, ResourceType } from '../world/ResourceNode';
import { Building } from '../buildings/Building';
import { FX } from '../systems/Effects';
import { Sfx } from '../systems/Sound';
import type { Game } from '../Game';

const CARRY_CAP = 12;
const GATHER_RATE = 6; // per second, before research bonuses
const REACH = 1.2;

type MinionState = 'idle' | 'toNode' | 'harvest' | 'toDepot' | 'toSite' | 'build';

/**
 * The worker unit: gathers wood/stone/gold and constructs buildings.
 * Classic AoE villager loop: walk to node → harvest → carry to Town
 * Center → repeat. Right-click assigns work; everything else is automatic.
 */
export class Minion extends Unit {
  private state: MinionState = 'idle';
  private node: ResourceNode | null = null;
  private site: Building | null = null;
  private carry = 0;
  private carryType: ResourceType | null = null;
  private workPhase = 0;
  private workFxTimer = 0;
  private bundle: BABYLON.Mesh;

  constructor(scene: BABYLON.Scene, world: World, pos: BABYLON.Vector3) {
    super(scene, world, pos, { hp: 45, speed: 5, team: 'player' });
    this.buildChibi(new BABYLON.Color3(0.45, 0.62, 0.9), 'minionBody');

    // Cute straw hat
    const hatMat = pastel(scene, 'strawHat', new BABYLON.Color3(0.93, 0.8, 0.5));
    const brim = this.addMesh(
      BABYLON.MeshBuilder.CreateCylinder('brim', { height: 0.05, diameter: 0.8 }, scene),
      this.model, hatMat
    );
    brim.position.y = 1.62;
    const cone = this.addMesh(
      BABYLON.MeshBuilder.CreateCylinder('hatTop', { height: 0.3, diameterBottom: 0.45, diameterTop: 0.05 }, scene),
      this.model, hatMat
    );
    cone.position.y = 1.78;

    // Resource bundle shown on the back while carrying
    this.bundle = BABYLON.MeshBuilder.CreateSphere('bundle', { diameter: 0.4, segments: 6 }, scene);
    this.bundle.parent = this.model;
    this.bundle.position.set(0, 0.85, -0.38);
    this.bundle.isPickable = false;
    this.bundle.setEnabled(false);
  }

  commandGather(node: ResourceNode): void {
    this.node = node;
    this.site = null;
    this.state = 'toNode';
    this.moveTarget = node.position.clone();
  }

  commandBuild(site: Building): void {
    this.site = site;
    this.node = null;
    this.state = 'toSite';
    this.moveTarget = site.position.clone();
  }

  override commandMove(dest: BABYLON.Vector3): void {
    super.commandMove(dest);
    this.state = 'idle';
    this.node = null;
    this.site = null;
  }

  /** True when doing nothing — the auto-assigner picks these up. */
  get isIdle(): boolean {
    return this.alive && this.state === 'idle' && !this.moveTarget;
  }

  get status(): string {
    switch (this.state) {
      case 'harvest': case 'toNode': return `gathering ${this.node?.type ?? ''}`;
      case 'toDepot': return `carrying ${this.carryType}`;
      case 'build': case 'toSite': return 'building';
      default: return this.moveTarget ? 'moving' : 'idle';
    }
  }

  update(dt: number, game: Game): boolean {
    if (this.alive) {
      switch (this.state) {
        case 'idle':
          if (!this.stepMovement(dt)) this.restPose(dt);
          break;

        case 'toNode': {
          if (!this.node || this.node.depleted) { this.findNextNode(game); break; }
          const d = this.distTo(this.node.position);
          if (d < this.node.radius + REACH) {
            this.moveTarget = null;
            this.state = 'harvest';
          } else {
            this.moveTarget = this.node.position.clone();
            this.stepMovement(dt);
          }
          break;
        }

        case 'harvest': {
          if (!this.node || this.node.depleted) { this.findNextNode(game); break; }
          this.faceToward(this.node.position.subtract(this.root.position));
          this.animateWork(dt);
          this.playWorkFx(dt, this.node);
          const foodBonus = this.node.type === 'food' ? game.foodMult : 1;
          const taken = this.node.harvest(GATHER_RATE * game.gatherMult * foodBonus * dt);
          this.carry += taken;
          this.carryType = this.node.type;
          if (this.carry >= CARRY_CAP || this.node.depleted) {
            this.showBundle(true);
            this.state = 'toDepot';
          }
          break;
        }

        case 'toDepot': {
          const depot = game.nearestDepot(this.root.position);
          if (!depot) { this.state = 'idle'; break; }
          const d = this.distTo(depot.position);
          if (d < depot.def.footprint + REACH + 0.5) {
            if (this.carryType) {
              game.addResource(this.carryType, Math.round(this.carry));
              FX.gold(depot.position.add(new BABYLON.Vector3(0, 3.5, 0)));
              Sfx.play('deposit');
            }
            this.carry = 0;
            this.showBundle(false);
            this.moveTarget = null;
            this.state = this.node && !this.node.depleted ? 'toNode' : 'idle';
            if (this.state === 'idle') this.findNextNode(game);
          } else {
            this.moveTarget = depot.position.clone();
            this.stepMovement(dt);
          }
          break;
        }

        case 'toSite': {
          if (!this.site || !this.site.alive || this.site.completed) { this.state = 'idle'; this.site = null; break; }
          const d = this.distTo(this.site.position);
          if (d < this.site.def.footprint + REACH + 0.5) {
            this.moveTarget = null;
            this.state = 'build';
          } else {
            this.moveTarget = this.site.position.clone();
            this.stepMovement(dt);
          }
          break;
        }

        case 'build': {
          if (!this.site || !this.site.alive) { this.state = 'idle'; this.site = null; break; }
          if (this.site.completed) {
            game.toast(`${this.site.def.name} completed! 🎉`);
            this.state = 'idle';
            this.site = null;
            break;
          }
          this.faceToward(this.site.position.subtract(this.root.position));
          this.animateWork(dt);
          this.workFxTimer -= dt;
          if (this.workFxTimer <= 0) {
            this.workFxTimer = 0.55;
            Sfx.play('build');
            FX.poof(this.site.position.add(new BABYLON.Vector3(0, 1.5, 0)));
          }
          this.site.addBuildEffort(dt);
          break;
        }
      }
    }
    return this.updateCommon(dt);
  }

  /** After a node empties, look for another of the same type nearby. */
  private findNextNode(game: Game): void {
    const type = this.node?.type;
    this.node = null;
    this.moveTarget = null;
    if (!type) { this.state = 'idle'; return; }
    let best: ResourceNode | null = null;
    let bestD = 30;
    for (const n of game.nodes) {
      if (n.type !== type || n.depleted) continue;
      const d = this.distTo(n.position);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) this.commandGather(best);
    else this.state = 'idle';
  }

  private animateWork(dt: number): void {
    this.workPhase += dt * 9;
    this.rightArm.rotation.x = -0.6 - Math.sin(this.workPhase) * 0.9;
    this.model.rotation.x = Math.max(0, Math.sin(this.workPhase)) * 0.08;
  }

  private showBundle(v: boolean): void {
    this.bundle.setEnabled(v);
    if (v && this.carryType) {
      const colors: Record<string, BABYLON.Color3> = {
        wood: new BABYLON.Color3(0.55, 0.4, 0.25),
        stone: new BABYLON.Color3(0.6, 0.6, 0.65),
        gold: new BABYLON.Color3(0.95, 0.78, 0.25),
        food: new BABYLON.Color3(0.92, 0.84, 0.4),
      };
      this.bundle.material = pastel(this.scene, 'bundle_' + this.carryType, colors[this.carryType]);
    }
  }

  /** Chop/pick/rustle/splash sounds + matching particle chips while working. */
  private playWorkFx(dt: number, node: ResourceNode): void {
    this.workFxTimer -= dt;
    if (this.workFxTimer > 0) return;
    this.workFxTimer = 0.55;
    const fxPos = node.position.add(new BABYLON.Vector3(0, 1.2, 0));
    switch (node.kind) {
      case 'tree': Sfx.play('chop'); FX.wood(fxPos); break;
      case 'mine': Sfx.play('pick'); node.type === 'gold' ? FX.gold(fxPos) : FX.stone(fxPos); break;
      case 'wheat': Sfx.play('rustle'); FX.food(fxPos); break;
      case 'fish': Sfx.play('splash'); FX.splash(fxPos); break;
    }
  }

  private distTo(p: BABYLON.Vector3): number {
    const dx = p.x - this.root.position.x;
    const dz = p.z - this.root.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
