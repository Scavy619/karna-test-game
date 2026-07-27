import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { Unit, Damageable, Team } from './Unit';
import { World } from '../world/World';
import { FX } from '../systems/Effects';
import { Sfx } from '../systems/Sound';
import type { Game } from '../Game';

export type WarriorVariant = 'soldier' | 'hero' | 'scout' | 'horseman' | 'chariot' | 'brute' | 'darkRider';

interface VariantDef {
  hp: number; dmg: number; range: number; cooldown: number; speed: number;
  scale: number; aggro: number; team: Team;
  mounted?: boolean; chariot?: boolean; barY?: number; ringScale?: number; radius?: number;
}

const VARIANTS: Record<WarriorVariant, VariantDef> = {
  soldier:   { hp: 90,  dmg: 12, range: 1.8, cooldown: 1.0,  speed: 5.5, scale: 1.0,  aggro: 9,  team: 'player' },
  hero:      { hp: 240, dmg: 26, range: 2.1, cooldown: 0.9,  speed: 6.0, scale: 1.18, aggro: 10, team: 'player' },
  scout:     { hp: 55,  dmg: 6,  range: 1.6, cooldown: 0.8,  speed: 9.0, scale: 0.92, aggro: 12, team: 'player' },
  horseman:  { hp: 130, dmg: 16, range: 1.9, cooldown: 0.95, speed: 8.5, scale: 1.0,  aggro: 11, team: 'player', mounted: true, barY: 2.9, ringScale: 1.35, radius: 0.8 },
  chariot:   { hp: 280, dmg: 30, range: 2.3, cooldown: 1.2,  speed: 7.5, scale: 1.0,  aggro: 11, team: 'player', mounted: true, chariot: true, barY: 3.1, ringScale: 1.7, radius: 1.1 },
  brute:     { hp: 85,  dmg: 11, range: 1.8, cooldown: 1.1,  speed: 5.0, scale: 1.05, aggro: 15, team: 'enemy' },
  darkRider: { hp: 110, dmg: 14, range: 1.9, cooldown: 1.0,  speed: 8.0, scale: 1.0,  aggro: 16, team: 'enemy', mounted: true, barY: 2.9, ringScale: 1.35, radius: 0.8 },
};

/**
 * All fighting units. Foot units are chibis; horsemen and chariots get a
 * horse body (legs assigned to the walk-cycle pivots, so they trot for
 * free). The hero is Karna-flavored: crown + golden kavacha chest plate,
 * boosted further by the Suryapuja tech and the Warrior's Oath story choice.
 */
export class Warrior extends Unit {
  readonly variant: WarriorVariant;
  attackTarget: Damageable | null = null;

  private dmg: number;
  private range: number;
  private cooldown: number;
  private aggro: number;
  private attackTimer = 0;
  private attackAnimT = -1;
  private anchor: BABYLON.Vector3 | null;
  private wheels: BABYLON.Mesh[] = [];

  constructor(
    scene: BABYLON.Scene,
    world: World,
    pos: BABYLON.Vector3,
    variant: WarriorVariant,
    hpMult = 1,
    anchor: BABYLON.Vector3 | null = null
  ) {
    const v = VARIANTS[variant];
    super(scene, world, pos, {
      hp: Math.round(v.hp * hpMult), speed: v.speed, team: v.team, scale: v.scale,
      barY: v.barY, ringScale: v.ringScale, radius: v.radius,
    });
    this.variant = variant;
    this.dmg = v.dmg;
    this.range = v.range;
    this.cooldown = v.cooldown;
    this.aggro = v.aggro;
    this.anchor = anchor ? anchor.clone() : null;

    if (v.chariot) this.buildChariot(scene);
    else if (v.mounted) this.buildMounted(scene, variant === 'darkRider');
    else this.buildFoot(scene, variant);
  }

  // ── Bodies ─────────────────────────────────────────────────────

  private buildFoot(scene: BABYLON.Scene, variant: WarriorVariant): void {
    if (variant === 'brute') {
      this.buildChibi(new BABYLON.Color3(0.5, 0.35, 0.6), 'bruteBody');
      const hornMat = pastel(scene, 'bruteHorn', new BABYLON.Color3(0.3, 0.22, 0.35));
      for (const side of [-1, 1]) {
        const horn = this.addMesh(
          BABYLON.MeshBuilder.CreateCylinder('horn', { height: 0.35, diameterBottom: 0.16, diameterTop: 0.02 }, scene),
          this.model, hornMat
        );
        horn.position.set(side * 0.22, 1.68, 0);
        horn.rotation.z = -side * 0.5;
      }
    } else if (variant === 'hero') {
      this.buildChibi(new BABYLON.Color3(0.85, 0.3, 0.3), 'heroBody');
      const crown = this.addMesh(
        BABYLON.MeshBuilder.CreateCylinder('crown', { height: 0.18, diameter: 0.4 }, scene),
        this.model, pastel(scene, 'crownGold', new BABYLON.Color3(0.95, 0.8, 0.3), { glow: 0.4, specular: 0.5 })
      );
      crown.position.y = 1.75;
      // Karna's golden kavacha (chest armor)
      const kavacha = this.addMesh(
        BABYLON.MeshBuilder.CreateBox('kavacha', { width: 0.58, height: 0.5, depth: 0.2 }, scene),
        this.model, pastel(scene, 'kavachaGold', new BABYLON.Color3(0.95, 0.8, 0.3), { glow: 0.35, specular: 0.5 })
      );
      kavacha.position.set(0, 0.78, 0.22);
    } else if (variant === 'scout') {
      this.buildChibi(new BABYLON.Color3(0.4, 0.7, 0.5), 'scoutBody');
      const cap = this.addMesh(
        BABYLON.MeshBuilder.CreateCylinder('cap', { height: 0.24, diameterBottom: 0.5, diameterTop: 0.1 }, scene),
        this.model, pastel(scene, 'scoutCap', new BABYLON.Color3(0.3, 0.55, 0.4))
      );
      cap.position.y = 1.68;
    } else {
      this.buildChibi(new BABYLON.Color3(0.75, 0.35, 0.35), 'soldierBody');
      const helm = this.addMesh(
        BABYLON.MeshBuilder.CreateSphere('helm', { diameter: 0.7, segments: 8, slice: 0.5 }, scene),
        this.model, pastel(scene, 'helmSteel', new BABYLON.Color3(0.7, 0.72, 0.78), { specular: 0.4 })
      );
      helm.position.y = 1.48;
    }
    this.addSword(scene, this.rightArm, 1);
  }

  /** Horse + rider. Horse leg pairs use the walk-cycle pivots → trot animation. */
  private buildMounted(scene: BABYLON.Scene, dark: boolean): void {
    const horseColor = dark ? new BABYLON.Color3(0.32, 0.26, 0.4) : new BABYLON.Color3(0.72, 0.55, 0.38);
    const horseMat = pastel(scene, dark ? 'darkHorse' : 'horse', horseColor);
    const maneMat = pastel(scene, dark ? 'darkMane' : 'mane', dark ? new BABYLON.Color3(0.2, 0.15, 0.28) : new BABYLON.Color3(0.4, 0.28, 0.18));

    const body = this.addMesh(BABYLON.MeshBuilder.CreateCapsule('hBody', { height: 1.7, radius: 0.38 }, scene), this.model, horseMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.95;

    const head = this.addMesh(BABYLON.MeshBuilder.CreateBox('hHead', { width: 0.3, height: 0.5, depth: 0.6 }, scene), this.model, horseMat);
    head.position.set(0, 1.5, 0.95);
    head.rotation.x = 0.5;
    for (const side of [-1, 1]) {
      const ear = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('ear', { height: 0.18, diameterBottom: 0.1, diameterTop: 0.01 }, scene), this.model, maneMat);
      ear.position.set(side * 0.1, 1.85, 0.8);
    }
    const tail = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('tail', { height: 0.6, diameterBottom: 0.12, diameterTop: 0.03 }, scene), this.model, maneMat);
    tail.position.set(0, 0.75, -0.95);
    tail.rotation.x = -0.7;

    // Leg pairs on the shared pivots (front pair + back pair alternate)
    this.leftLeg = new BABYLON.TransformNode('frontLegs', scene);
    this.leftLeg.parent = this.model;
    this.leftLeg.position.set(0, 0.62, 0.55);
    this.rightLeg = new BABYLON.TransformNode('backLegs', scene);
    this.rightLeg.parent = this.model;
    this.rightLeg.position.set(0, 0.62, -0.55);
    for (const side of [-1, 1]) {
      const fl = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('leg', { height: 0.6, diameter: 0.14 }, scene), this.leftLeg, horseMat);
      fl.position.set(side * 0.22, -0.3, 0);
      const bl = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('leg', { height: 0.6, diameter: 0.14 }, scene), this.rightLeg, horseMat);
      bl.position.set(side * 0.22, -0.3, 0);
    }

    this.buildRider(scene, dark, 1.55);
    this.addSword(scene, this.rightArm, 0.9);
  }

  /** Karna-style war chariot: platform + wheels + horse, rider standing tall. */
  private buildChariot(scene: BABYLON.Scene): void {
    const woodMat = pastel(scene, 'chariotWood', new BABYLON.Color3(0.7, 0.5, 0.3));
    const goldMat = pastel(scene, 'chariotGold', new BABYLON.Color3(0.95, 0.8, 0.3), { glow: 0.3, specular: 0.5 });
    const horseMat = pastel(scene, 'chariotHorse', new BABYLON.Color3(0.9, 0.88, 0.85));

    const platform = this.addMesh(BABYLON.MeshBuilder.CreateBox('platform', { width: 1.5, height: 0.25, depth: 1.2 }, scene), this.model, woodMat);
    platform.position.set(0, 0.6, -0.7);
    const rail = this.addMesh(BABYLON.MeshBuilder.CreateBox('rail', { width: 1.5, height: 0.55, depth: 0.1 }, scene), this.model, goldMat);
    rail.position.set(0, 0.95, -0.15);

    for (const side of [-1, 1]) {
      const wheel = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('wheel', { height: 0.12, diameter: 1.15, tessellation: 12 }, scene), this.model, goldMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.85, 0.58, -0.7);
      this.wheels.push(wheel);
    }

    // White horse up front (Karna's chariot deserves style)
    const hBody = this.addMesh(BABYLON.MeshBuilder.CreateCapsule('cHorse', { height: 1.6, radius: 0.36 }, scene), this.model, horseMat);
    hBody.rotation.x = Math.PI / 2;
    hBody.position.set(0, 0.95, 1.1);
    const hHead = this.addMesh(BABYLON.MeshBuilder.CreateBox('cHead', { width: 0.28, height: 0.48, depth: 0.55 }, scene), this.model, horseMat);
    hHead.position.set(0, 1.5, 1.95);
    hHead.rotation.x = 0.5;
    const yoke = this.addMesh(BABYLON.MeshBuilder.CreateBox('yoke', { width: 0.12, height: 0.1, depth: 1.4 }, scene), this.model, woodMat);
    yoke.position.set(0, 0.85, 0.25);

    this.leftLeg = new BABYLON.TransformNode('cFrontLegs', scene);
    this.leftLeg.parent = this.model;
    this.leftLeg.position.set(0, 0.62, 1.55);
    this.rightLeg = new BABYLON.TransformNode('cBackLegs', scene);
    this.rightLeg.parent = this.model;
    this.rightLeg.position.set(0, 0.62, 0.68);
    for (const side of [-1, 1]) {
      const fl = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('leg', { height: 0.6, diameter: 0.13 }, scene), this.leftLeg, horseMat);
      fl.position.set(side * 0.2, -0.3, 0);
      const bl = this.addMesh(BABYLON.MeshBuilder.CreateCylinder('leg', { height: 0.6, diameter: 0.13 }, scene), this.rightLeg, horseMat);
      bl.position.set(side * 0.2, -0.3, 0);
    }

    this.buildRider(scene, false, 1.35, -0.7);
    this.addSword(scene, this.rightArm, 1.1);
  }

  /** A small chibi rider; arms go on the shared arm pivots for sword swings. */
  private buildRider(scene: BABYLON.Scene, dark: boolean, baseY: number, baseZ = 0): void {
    const skin = pastel(scene, 'chibiSkin', new BABYLON.Color3(0.97, 0.85, 0.7));
    const bodyMat = dark
      ? pastel(scene, 'darkRiderBody', new BABYLON.Color3(0.42, 0.3, 0.5))
      : pastel(scene, 'riderBody', new BABYLON.Color3(0.85, 0.55, 0.3));

    const body = this.addMesh(BABYLON.MeshBuilder.CreateCapsule('rBody', { height: 0.6, radius: 0.24 }, scene), this.model, bodyMat);
    body.position.set(0, baseY + 0.35, baseZ);
    const head = this.addMesh(BABYLON.MeshBuilder.CreateSphere('rHead', { diameter: 0.46, segments: 8 }, scene), this.model, skin);
    head.position.set(0, baseY + 0.85, baseZ);

    this.leftArm = new BABYLON.TransformNode('rLArm', scene);
    this.leftArm.parent = this.model;
    this.leftArm.position.set(-0.3, baseY + 0.55, baseZ);
    const la = this.addMesh(BABYLON.MeshBuilder.CreateCapsule('rla', { height: 0.35, radius: 0.08 }, scene), this.leftArm, skin);
    la.position.y = -0.16;

    this.rightArm = new BABYLON.TransformNode('rRArm', scene);
    this.rightArm.parent = this.model;
    this.rightArm.position.set(0.3, baseY + 0.55, baseZ);
    const ra = this.addMesh(BABYLON.MeshBuilder.CreateCapsule('rra', { height: 0.35, radius: 0.08 }, scene), this.rightArm, skin);
    ra.position.y = -0.16;
  }

  private addSword(scene: BABYLON.Scene, arm: BABYLON.TransformNode, s: number): void {
    const steel = pastel(scene, 'swordSteel', new BABYLON.Color3(0.8, 0.83, 0.9), { specular: 0.6, glow: 0.25 });
    const gold = pastel(scene, 'swordGold', new BABYLON.Color3(0.9, 0.75, 0.3), { glow: 0.3 });
    const blade = this.addMesh(
      BABYLON.MeshBuilder.CreateBox('blade', { width: 0.08 * s, height: 0.75 * s, depth: 0.03 }, scene),
      arm, steel
    );
    blade.position.set(0, -0.75 * s, 0.05);
    const guard = this.addMesh(
      BABYLON.MeshBuilder.CreateBox('guard', { width: 0.24 * s, height: 0.05, depth: 0.07 }, scene),
      arm, gold
    );
    guard.position.set(0, -0.42 * s, 0.05);
  }

  // ── Behavior ───────────────────────────────────────────────────

  commandAttack(target: Damageable): void {
    this.attackTarget = target;
    this.moveTarget = null;
  }

  override commandMove(dest: BABYLON.Vector3): void {
    super.commandMove(dest);
    this.attackTarget = null;
  }

  get status(): string {
    if (this.attackTarget) return 'fighting';
    return this.moveTarget ? 'moving' : 'guarding';
  }

  protected override animateWalk(dt: number): void {
    super.animateWalk(dt);
    for (const w of this.wheels) w.rotation.x += dt * this.speed * 1.4;
  }

  update(dt: number, game: Game): boolean {
    if (this.alive) {
      this.attackTimer -= dt;

      if (!this.attackTarget && !this.moveTarget) {
        this.attackTarget = this.findNearestFoe(game, this.aggro);
      }

      // A horde stopped by a wall smashes the wall
      if (this.team === 'enemy' && this.blockedBy && this.blockedBy.alive) {
        this.attackTarget = this.blockedBy;
      }

      if (this.team === 'enemy' && this.anchor) {
        const dHome = BABYLON.Vector3.Distance(this.root.position, this.anchor);
        if (dHome > 45) {
          this.attackTarget = null;
          this.moveTarget = this.anchor.clone();
        }
      }

      if (this.attackTarget && (!this.attackTarget.alive)) this.attackTarget = null;

      if (this.attackTarget) {
        const to = this.attackTarget.position.subtract(this.root.position);
        to.y = 0;
        const dist = to.length() - this.attackTarget.radius;
        if (dist > this.range) {
          to.normalize();
          this.root.position.addInPlace(to.scale(this.speed * dt));
          this.faceToward(to);
          this.animateWalk(dt);
        } else {
          this.faceToward(to);
          this.restPose(dt);
          if (this.attackTimer <= 0) {
            this.attackTimer = this.cooldown;
            this.attackAnimT = 0;
            this.attackTarget.takeDamage(this.dmg * this.damageMultiplier(game));
            FX.spark(this.attackTarget.position.add(new BABYLON.Vector3(0, 1.2, 0)));
            Sfx.play('swordHit');
          }
        }
      } else if (!this.stepMovement(dt)) {
        this.restPose(dt);
      }

      if (this.attackAnimT >= 0) {
        this.attackAnimT += dt;
        const t = Math.min(1, this.attackAnimT / 0.35);
        this.rightArm.rotation.x = -Math.sin(t * Math.PI) * 2.1;
        if (t >= 1) {
          this.attackAnimT = -1;
          this.rightArm.rotation.x = 0;
        }
      }
    }
    return this.updateCommon(dt);
  }

  private damageMultiplier(game: Game): number {
    if (this.team !== 'player') return 1;
    let mult = game.damageMult;
    if (this.variant === 'hero') {
      if (game.research.suryapuja) mult *= 1.5;
      if (game.storyFlags.warriorOath) mult *= 1.25;
    }
    return mult;
  }

  private findNearestFoe(game: Game, maxDist: number): Damageable | null {
    let best: Damageable | null = null;
    let bestD = maxDist;
    const foes: Damageable[] =
      this.team === 'player'
        ? [...game.enemies, ...game.buildings.filter((b) => b.team === 'enemy')]
        : [...game.minions, ...game.warriors, ...game.buildings.filter((b) => b.team === 'player')];
    for (const f of foes) {
      if (!f.alive) continue;
      const d = BABYLON.Vector3.Distance(this.root.position, f.position);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }
}
