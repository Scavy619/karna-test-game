import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { World, POND_CENTER, HAMLETS } from './World';
import { FX } from '../systems/Effects';
import type { Game } from '../Game';

/**
 * Ambient life: deer that graze and flee, bird flocks crossing the sky,
 * fish leaping in the pond, and villagers pottering around their hamlets.
 * Pure decoration — nothing here is selectable or fights.
 */

interface Deer {
  root: BABYLON.TransformNode;
  legs: BABYLON.TransformNode[];
  head: BABYLON.Mesh;
  state: 'graze' | 'walk' | 'flee';
  target: BABYLON.Vector3;
  timer: number;
  phase: number;
}

interface Flock {
  root: BABYLON.TransformNode;
  birds: BABYLON.Mesh[];
  dir: BABYLON.Vector3;
  speed: number;
}

interface JumpingFish {
  mesh: BABYLON.Mesh;
  state: 'wait' | 'jump';
  timer: number;
  from: BABYLON.Vector3;
  dir: BABYLON.Vector3;
}

interface Villager {
  root: BABYLON.TransformNode;
  legs: BABYLON.TransformNode[];
  anchor: BABYLON.Vector3;
  target: BABYLON.Vector3;
  timer: number;
  phase: number;
}

export class Wildlife {
  private scene: BABYLON.Scene;
  private world: World;
  private deer: Deer[] = [];
  private flocks: Flock[] = [];
  private fish: JumpingFish[] = [];
  private villagers: Villager[] = [];
  private fleeCheckTimer = 0;
  private time = 0;

  constructor(scene: BABYLON.Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.spawnDeer(8);
    this.spawnFlocks(3);
    this.spawnFish(2);
    this.spawnVillagers();
  }

  // ── Builders ───────────────────────────────────────────────────

  private spawnDeer(count: number): void {
    const bodyMat = pastel(this.scene, 'deerBody', new BABYLON.Color3(0.75, 0.58, 0.4));
    const darkMat = pastel(this.scene, 'deerDark', new BABYLON.Color3(0.5, 0.38, 0.26));

    for (let i = 0; i < count; i++) {
      const root = new BABYLON.TransformNode('deer' + i, this.scene);
      let x = 0, z = 0;
      do {
        x = (Math.random() - 0.5) * 170;
        z = (Math.random() - 0.5) * 170;
      } while (Math.hypot(x - POND_CENTER.x, z - POND_CENTER.z) < 16 || this.world.distToRiver(x, z) < 8);
      root.position.set(x, this.world.getHeight(x, z), z);

      const body = BABYLON.MeshBuilder.CreateCapsule('dBody', { height: 1.0, radius: 0.26 }, this.scene);
      body.parent = root; body.material = bodyMat; body.isPickable = false;
      body.rotation.x = Math.PI / 2; body.position.y = 0.72;

      const head = BABYLON.MeshBuilder.CreateBox('dHead', { width: 0.22, height: 0.34, depth: 0.4 }, this.scene);
      head.parent = root; head.material = bodyMat; head.isPickable = false;
      head.position.set(0, 1.1, 0.62);
      for (const side of [-1, 1]) {
        const ear = BABYLON.MeshBuilder.CreateCylinder('dEar', { height: 0.16, diameterBottom: 0.08, diameterTop: 0.01 }, this.scene);
        ear.parent = root; ear.material = darkMat; ear.isPickable = false;
        ear.position.set(side * 0.1, 1.32, 0.55);
      }
      const tail = BABYLON.MeshBuilder.CreateSphere('dTail', { diameter: 0.16, segments: 6 }, this.scene);
      tail.parent = root; tail.material = pastel(this.scene, 'deerTail', new BABYLON.Color3(0.95, 0.93, 0.88));
      tail.isPickable = false; tail.position.set(0, 0.8, -0.55);

      const legs: BABYLON.TransformNode[] = [];
      for (const [lx, lz] of [[-0.16, 0.35], [0.16, 0.35], [-0.16, -0.35], [0.16, -0.35]]) {
        const pivot = new BABYLON.TransformNode('dLegP', this.scene);
        pivot.parent = root; pivot.position.set(lx, 0.55, lz);
        const leg = BABYLON.MeshBuilder.CreateCylinder('dLeg', { height: 0.5, diameter: 0.09 }, this.scene);
        leg.parent = pivot; leg.material = darkMat; leg.isPickable = false; leg.position.y = -0.25;
        legs.push(pivot);
      }

      this.deer.push({
        root, legs, head,
        state: 'graze',
        target: root.position.clone(),
        timer: 1 + Math.random() * 3,
        phase: Math.random() * 10,
      });
    }
  }

  private spawnFlocks(count: number): void {
    const birdMat = pastel(this.scene, 'bird', new BABYLON.Color3(0.35, 0.32, 0.38), { glow: 0.15 });
    for (let f = 0; f < count; f++) {
      const root = new BABYLON.TransformNode('flock' + f, this.scene);
      root.position.set((Math.random() - 0.5) * 240, 26 + Math.random() * 12, (Math.random() - 0.5) * 240);
      const angle = Math.random() * Math.PI * 2;
      const dir = new BABYLON.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const birds: BABYLON.Mesh[] = [];
      for (let b = 0; b < 5; b++) {
        const bird = BABYLON.MeshBuilder.CreateCylinder('bird', { height: 0.5, diameterBottom: 0.28, diameterTop: 0.01, tessellation: 4 }, this.scene);
        bird.parent = root; bird.material = birdMat; bird.isPickable = false;
        // V formation behind the leader
        const row = Math.ceil(b / 2);
        const side = b % 2 === 0 ? 1 : -1;
        bird.position.set(side * row * 1.1, -row * 0.15, -row * 1.2);
        bird.rotation.x = Math.PI / 2;
        birds.push(bird);
      }
      root.rotation.y = Math.atan2(dir.x, dir.z);
      this.flocks.push({ root, birds, dir, speed: 6 + Math.random() * 3 });
    }
  }

  private spawnFish(count: number): void {
    const fishMat = pastel(this.scene, 'jumpFish', new BABYLON.Color3(0.9, 0.6, 0.35), { glow: 0.2 });
    for (let i = 0; i < count; i++) {
      const mesh = BABYLON.MeshBuilder.CreateCylinder('jFish', { height: 0.5, diameterBottom: 0.2, diameterTop: 0.02, tessellation: 6 }, this.scene);
      mesh.material = fishMat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.fish.push({
        mesh, state: 'wait', timer: 2 + Math.random() * 4,
        from: new BABYLON.Vector3(0, 0, 0), dir: new BABYLON.Vector3(0, 0, 1),
      });
    }
  }

  private spawnVillagers(): void {
    const colors = [
      new BABYLON.Color3(0.4, 0.65, 0.65),
      new BABYLON.Color3(0.7, 0.5, 0.75),
      new BABYLON.Color3(0.85, 0.7, 0.35),
      new BABYLON.Color3(0.6, 0.72, 0.45),
    ];
    let ci = 0;
    for (const hamlet of HAMLETS) {
      for (let i = 0; i < 2; i++) {
        const root = new BABYLON.TransformNode('villager', this.scene);
        const x = hamlet.x + (Math.random() - 0.5) * 6;
        const z = hamlet.z + (Math.random() - 0.5) * 6;
        root.position.set(x, this.world.getHeight(x, z), z);

        const bodyMat = pastel(this.scene, 'villagerBody' + ci, colors[ci % colors.length]);
        ci++;
        const skin = pastel(this.scene, 'chibiSkin', new BABYLON.Color3(0.97, 0.85, 0.7));
        const body = BABYLON.MeshBuilder.CreateCapsule('vBody', { height: 0.65, radius: 0.26 }, this.scene);
        body.parent = root; body.material = bodyMat; body.isPickable = false; body.position.y = 0.55;
        const head = BABYLON.MeshBuilder.CreateSphere('vHead', { diameter: 0.5, segments: 8 }, this.scene);
        head.parent = root; head.material = skin; head.isPickable = false; head.position.y = 1.12;

        const legs: BABYLON.TransformNode[] = [];
        for (const side of [-1, 1]) {
          const pivot = new BABYLON.TransformNode('vLegP', this.scene);
          pivot.parent = root; pivot.position.set(side * 0.12, 0.28, 0);
          const leg = BABYLON.MeshBuilder.CreateCapsule('vLeg', { height: 0.26, radius: 0.09 }, this.scene);
          leg.parent = pivot; leg.material = bodyMat; leg.isPickable = false; leg.position.y = -0.12;
          legs.push(pivot);
        }

        this.villagers.push({
          root, legs,
          anchor: new BABYLON.Vector3(hamlet.x, 0, hamlet.z),
          target: root.position.clone(),
          timer: Math.random() * 4,
          phase: Math.random() * 10,
        });
      }
    }
  }

  // ── Per-frame behavior ─────────────────────────────────────────

  update(dt: number, game: Game): void {
    this.time += dt;
    this.updateDeer(dt, game);
    this.updateFlocks(dt);
    this.updateFish(dt);
    this.updateVillagers(dt);
  }

  private updateDeer(dt: number, game: Game): void {
    this.fleeCheckTimer -= dt;
    const doFleeCheck = this.fleeCheckTimer <= 0;
    if (doFleeCheck) this.fleeCheckTimer = 0.35;
    const units = doFleeCheck ? [...game.minions, ...game.warriors, ...game.enemies] : [];

    for (const d of this.deer) {
      // Startle when anyone comes close
      if (doFleeCheck && d.state !== 'flee') {
        for (const u of units) {
          if (!u.alive) continue;
          const dist = BABYLON.Vector3.Distance(d.root.position, u.position);
          if (dist < 6) {
            const away = d.root.position.subtract(u.position);
            away.y = 0;
            away.normalize();
            d.target = d.root.position.add(away.scale(14));
            d.state = 'flee';
            d.timer = 2;
            break;
          }
        }
      }

      d.timer -= dt;
      if (d.state === 'graze') {
        d.head.position.y = 0.75 + Math.abs(Math.sin(this.time * 0.8 + d.phase)) * 0.3;
        if (d.timer <= 0) {
          const a = Math.random() * Math.PI * 2;
          d.target = d.root.position.add(new BABYLON.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 10));
          d.target.x = Math.max(-110, Math.min(110, d.target.x));
          d.target.z = Math.max(-110, Math.min(110, d.target.z));
          d.state = 'walk';
        }
        continue;
      }

      const speed = d.state === 'flee' ? 8 : 2;
      const to = d.target.subtract(d.root.position);
      to.y = 0;
      if (to.length() < 0.6 || (d.state === 'flee' && d.timer <= 0)) {
        d.state = 'graze';
        d.timer = 2 + Math.random() * 4;
        d.legs.forEach((l) => (l.rotation.x = 0));
        continue;
      }
      to.normalize();
      d.root.position.addInPlace(to.scale(speed * dt));
      d.root.position.y = this.world.getHeight(d.root.position.x, d.root.position.z);
      d.root.rotation.y = Math.atan2(to.x, to.z);
      d.phase += dt * (d.state === 'flee' ? 16 : 7);
      d.legs.forEach((l, i) => (l.rotation.x = Math.sin(d.phase + (i % 2) * Math.PI) * 0.7));
      d.head.position.y = 1.1;
    }
  }

  private updateFlocks(dt: number): void {
    for (const f of this.flocks) {
      f.root.position.addInPlace(f.dir.scale(f.speed * dt));
      f.birds.forEach((b, i) => {
        b.scaling.x = 0.6 + Math.abs(Math.sin(this.time * 9 + i)) * 0.7; // wing flap
      });
      if (Math.abs(f.root.position.x) > 150 || Math.abs(f.root.position.z) > 150) {
        const angle = Math.random() * Math.PI * 2;
        f.dir = new BABYLON.Vector3(Math.cos(angle), 0, Math.sin(angle));
        f.root.position.set(-f.dir.x * 145, 26 + Math.random() * 12, -f.dir.z * 145);
        f.root.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      }
    }
  }

  private updateFish(dt: number): void {
    for (const f of this.fish) {
      f.timer -= dt;
      if (f.state === 'wait') {
        if (f.timer <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 8;
          f.from.set(POND_CENTER.x + Math.cos(a) * r, 0.2, POND_CENTER.z + Math.sin(a) * r);
          const dirA = Math.random() * Math.PI * 2;
          f.dir.set(Math.cos(dirA), 0, Math.sin(dirA));
          f.state = 'jump';
          f.timer = 0.8;
          f.mesh.setEnabled(true);
        }
        continue;
      }
      const t = 1 - f.timer / 0.8;
      if (f.timer <= 0) {
        f.state = 'wait';
        f.timer = 3 + Math.random() * 5;
        f.mesh.setEnabled(false);
        FX.splash(f.mesh.position);
        continue;
      }
      const arc = Math.sin(t * Math.PI) * 1.6;
      f.mesh.position.set(
        f.from.x + f.dir.x * t * 2.2,
        f.from.y + arc,
        f.from.z + f.dir.z * t * 2.2
      );
      f.mesh.rotation.x = Math.PI / 2 - t * Math.PI; // nose up then dive
      f.mesh.rotation.y = Math.atan2(f.dir.x, f.dir.z);
    }
  }

  private updateVillagers(dt: number): void {
    for (const v of this.villagers) {
      v.timer -= dt;
      const to = v.target.subtract(v.root.position);
      to.y = 0;
      if (to.length() < 0.4) {
        if (v.timer <= 0) {
          const a = Math.random() * Math.PI * 2;
          v.target.set(
            v.anchor.x + Math.cos(a) * (2 + Math.random() * 7),
            0,
            v.anchor.z + Math.sin(a) * (2 + Math.random() * 7)
          );
          v.timer = 2 + Math.random() * 5;
        }
        v.legs.forEach((l) => (l.rotation.x *= 0.9));
        continue;
      }
      to.normalize();
      v.root.position.addInPlace(to.scale(1.3 * dt));
      v.root.position.y = this.world.getHeight(v.root.position.x, v.root.position.z);
      v.root.rotation.y = Math.atan2(to.x, to.z);
      v.phase += dt * 8;
      v.legs.forEach((l, i) => (l.rotation.x = Math.sin(v.phase + i * Math.PI) * 0.6));
    }
  }
}
