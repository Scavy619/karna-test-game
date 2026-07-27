import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';

export type ResourceType = 'wood' | 'stone' | 'gold' | 'food';
export type NodeKind = 'tree' | 'mine' | 'wheat' | 'fish';

/**
 * A harvestable map object: tree, stone/gold mine, wheat plot (from a Farm),
 * or fishing spot (from a Fishing Dock). Minions right-clicked onto one
 * gather from it until it's empty; then it shrinks away.
 */
export class ResourceNode {
  readonly type: ResourceType;
  readonly kind: NodeKind;
  readonly root: BABYLON.TransformNode;
  readonly radius: number;
  amount: number;
  depleted = false;

  private dyingT = -1;
  private meshes: BABYLON.Mesh[] = [];
  private swayPhase = Math.random() * Math.PI * 2;
  private time = 0;

  constructor(
    scene: BABYLON.Scene,
    type: ResourceType,
    position: BABYLON.Vector3,
    amount: number,
    kind?: NodeKind
  ) {
    this.type = type;
    this.kind = kind ?? (type === 'wood' ? 'tree' : type === 'food' ? 'wheat' : 'mine');
    this.amount = amount;
    this.root = new BABYLON.TransformNode('node_' + this.kind, scene);
    this.root.position.copyFrom(position);
    this.radius = this.kind === 'tree' ? 1.4 : this.kind === 'mine' ? 2.4 : 1.8;

    const add = (mesh: BABYLON.Mesh, material: BABYLON.Material) => {
      mesh.parent = this.root;
      mesh.material = material;
      mesh.metadata = { owner: this };
      this.meshes.push(mesh);
      return mesh;
    };

    if (this.kind === 'tree') {
      const trunk = add(
        BABYLON.MeshBuilder.CreateCylinder('trunk', { height: 1.6, diameter: 0.55 }, scene),
        pastel(scene, 'treeTrunk', new BABYLON.Color3(0.55, 0.4, 0.28))
      );
      trunk.position.y = 0.8;
      const hue = Math.floor(Math.random() * 3);
      const greens = [
        new BABYLON.Color3(0.45, 0.75, 0.42),
        new BABYLON.Color3(0.55, 0.8, 0.45),
        new BABYLON.Color3(0.4, 0.7, 0.5),
      ];
      const blob = add(
        BABYLON.MeshBuilder.CreateSphere('blob', { diameter: 2.6, segments: 8 }, scene),
        pastel(scene, 'treeBlob' + hue, greens[hue])
      );
      blob.position.y = 2.5;
      blob.scaling.y = 0.92;
      const blob2 = add(
        BABYLON.MeshBuilder.CreateSphere('blob2', { diameter: 1.5, segments: 8 }, scene),
        pastel(scene, 'treeBlob' + hue, greens[hue])
      );
      blob2.position.set(0.7, 1.9, 0.3);
      const s = 0.85 + Math.random() * 0.45;
      this.root.scaling.setAll(s);
      this.root.rotation.y = Math.random() * Math.PI * 2;
    } else if (this.kind === 'mine') {
      const rockMat = pastel(scene, 'mineRock', new BABYLON.Color3(0.62, 0.62, 0.68));
      for (let i = 0; i < 3; i++) {
        const rock = add(
          BABYLON.MeshBuilder.CreateIcoSphere('rock', { radius: 1.1 - i * 0.25, subdivisions: 1, flat: true }, scene),
          rockMat
        );
        rock.position.set((Math.random() - 0.5) * 1.6, 0.4 + i * 0.35, (Math.random() - 0.5) * 1.6);
        rock.scaling.y = 0.7;
        rock.rotation.y = Math.random() * Math.PI;
      }
      if (type === 'gold') {
        const goldMat = pastel(scene, 'mineGold', new BABYLON.Color3(0.95, 0.78, 0.25), { glow: 0.4, specular: 0.6 });
        for (let i = 0; i < 4; i++) {
          const nugget = add(
            BABYLON.MeshBuilder.CreateIcoSphere('nugget', { radius: 0.28, subdivisions: 1, flat: true }, scene),
            goldMat
          );
          nugget.position.set((Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 2);
        }
      }
    } else if (this.kind === 'wheat') {
      // A cluster of ripe wheat tufts
      const wheatMat = pastel(scene, 'wheat', new BABYLON.Color3(0.92, 0.82, 0.4), { glow: 0.2 });
      for (let i = 0; i < 7; i++) {
        const tuft = add(
          BABYLON.MeshBuilder.CreateCylinder('tuft', { height: 1.0, diameterBottom: 0.28, diameterTop: 0.05 }, scene),
          wheatMat
        );
        const a = (i / 7) * Math.PI * 2;
        const r = i === 0 ? 0 : 0.9;
        tuft.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
        tuft.rotation.z = (Math.random() - 0.5) * 0.2;
      }
    } else {
      // Fishing spot: ripple ring + jumping fish
      const ripple = add(
        BABYLON.MeshBuilder.CreateTorus('ripple', { diameter: 2.6, thickness: 0.08, tessellation: 28 }, scene),
        pastel(scene, 'ripple', new BABYLON.Color3(0.75, 0.9, 1), { glow: 0.5, alpha: 0.8 })
      );
      ripple.position.y = 0.1;
      const fishMat = pastel(scene, 'fish', new BABYLON.Color3(0.95, 0.6, 0.3), { glow: 0.25 });
      for (let i = 0; i < 2; i++) {
        const fish = add(
          BABYLON.MeshBuilder.CreateCylinder('fish', { height: 0.55, diameterBottom: 0.22, diameterTop: 0.02 }, scene),
          fishMat
        );
        fish.position.set(i === 0 ? 0.6 : -0.5, 0.35, i === 0 ? 0.2 : -0.4);
        fish.rotation.z = i === 0 ? 0.9 : -2.2;
      }
    }
  }

  get position(): BABYLON.Vector3 {
    return this.root.position;
  }

  getMeshes(): BABYLON.Mesh[] {
    return this.meshes;
  }

  harvest(qty: number): number {
    if (this.depleted) return 0;
    const taken = Math.min(qty, this.amount);
    this.amount -= taken;
    if (this.amount <= 0) {
      this.depleted = true;
      this.dyingT = 0;
    }
    return taken;
  }

  /** Ambient sway + shrink-out when depleted. Returns true when disposed. */
  update(dt: number): boolean {
    this.time += dt;
    if (this.dyingT < 0) {
      if (this.kind === 'tree' || this.kind === 'wheat') {
        this.root.rotation.z = Math.sin(this.time * 1.2 + this.swayPhase) * 0.025;
      }
      return false;
    }
    this.dyingT += dt;
    const t = Math.min(1, this.dyingT / 0.5);
    this.root.scaling.setAll(Math.max(0.001, (1 - t) * 0.9));
    if (t >= 1) {
      this.root.dispose();
      return true;
    }
    return false;
  }
}
