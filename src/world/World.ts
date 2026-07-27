import * as BABYLON from '@babylonjs/core';
import { pastel } from '../core/Materials';
import { ResourceNode } from './ResourceNode';

/**
 * The cute pastel island: nearly-flat terrain (easy building placement),
 * soft warm lighting, decorative hills ring, clouds, pond, and the
 * level-1 resource layout (forests + mines).
 *
 * Level design lives in spawnLevelResources() — edit that to make new maps.
 */

const MAP_LIMIT = 100;

/** Pond location — Fishing Docks can be placed on its shore. */
export const POND_CENTER = { x: 10, z: -10 };
export const POND_RADIUS = 12;

/** Village hamlets (decorative) — Wildlife spawns wandering villagers here. */
export const HAMLETS = [
  { x: -20, z: 25 },
  { x: 38, z: -38 },
];

/** The Ganga flows west→east across the north of Anga. */
const RIVER_BASE_Z = 62;
const RIVER_HALF_WIDTH = 7;    // where the carved valley meets flat land
const RIVER_DEPTH = 1.6;       // how deep the bed is cut at the centre
const RIVER_FILL = 0.52;       // fraction of the channel filled with water
const RIVER_WATER_HALF = 4.5;  // visible water half-width (inside the bed)

export class World {
  readonly scene: BABYLON.Scene;
  readonly shadowGenerator: BABYLON.ShadowGenerator;

  private clouds: BABYLON.TransformNode[] = [];
  private water: BABYLON.Mesh | null = null;
  private waterMat: BABYLON.StandardMaterial | null = null;
  private time = 0;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;

    // Soft cream sky + gentle distance haze — the "toy diorama" look
    scene.clearColor = new BABYLON.Color4(0.78, 0.89, 0.98, 1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = new BABYLON.Color3(0.85, 0.92, 1.0);
    scene.fogStart = 130;
    scene.fogEnd = 300;

    const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
    ambient.intensity = 0.45;
    ambient.groundColor = new BABYLON.Color3(0.3, 0.35, 0.28);

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.4, -0.85, -0.3), scene);
    sun.position = new BABYLON.Vector3(120, 220, 90);
    sun.intensity = 0.85;
    sun.diffuse = new BABYLON.Color3(1.0, 0.96, 0.86); // warm sunlight
    sun.autoCalcShadowZBounds = true;

    this.shadowGenerator = new BABYLON.ShadowGenerator(2048, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 24;
    this.shadowGenerator.setDarkness(0.55);

    this.buildTerrain();
    this.buildPond();
    this.buildRiver();
    this.buildBridge();
    this.buildHillsRing();
    this.buildHimalayas();
    this.buildHamlets();
    this.buildFlowersAndBushes();
    this.buildClouds();
    this.buildSparkles();
    this.buildGroundPatches();
  }

  // ── The Ganga: analytic centreline, carved bed, water surface ──

  /** Where the river's centre lies at a given x (it winds gently). */
  riverCenterZ(x: number): number {
    return RIVER_BASE_Z + Math.sin(x * 0.02) * 8;
  }

  /** Perpendicular distance from the river's centreline. */
  distToRiver(x: number, z: number): number {
    return Math.abs(z - this.riverCenterZ(x));
  }

  /** The level the riverbed is cut down to — flat across the channel. */
  private riverBedY(x: number): number {
    return this.baseHeight(x, this.riverCenterZ(x)) - RIVER_DEPTH;
  }

  /** The flat water surface height at a given x — a river is level across. */
  waterSurfaceY(x: number): number {
    return this.riverBedY(x) + RIVER_DEPTH * (1 - RIVER_FILL);
  }

  isDockSpot(x: number, z: number): boolean {
    const pondDist = Math.hypot(x - POND_CENTER.x, z - POND_CENTER.z);
    if (pondDist >= 10 && pondDist <= 16) return true;
    const riverDist = this.distToRiver(x, z);
    return riverDist >= 5 && riverDist <= 10;
  }

  overlapsWater(x: number, z: number): boolean {
    const pondDist = Math.hypot(x - POND_CENTER.x, z - POND_CENTER.z);
    return pondDist < 14 || this.distToRiver(x, z) < RIVER_HALF_WIDTH;
  }

  nearestWaterCenter(x: number, z: number): { x: number; z: number } {
    const pondDist = Math.hypot(x - POND_CENTER.x, z - POND_CENTER.z);
    const riverDist = this.distToRiver(x, z);
    return riverDist < pondDist
      ? { x, z: this.riverCenterZ(x) }
      : { x: POND_CENTER.x, z: POND_CENTER.z };
  }

  /** The rolling land, before the river cuts through it. */
  private baseHeight(x: number, z: number): number {
    return (
      0.4 * Math.sin(x * 0.05) +
      0.4 * Math.cos(z * 0.045) +
      0.2 * Math.sin((x + z) * 0.08)
    );
  }

  /**
   * Ground height — the single source of truth. Gentle bumps everywhere,
   * plus the Ganga's carved valley so the water sits in a real channel.
   */
  getHeight(x: number, z: number): number {
    const base = this.baseHeight(x, z);
    const t = this.distToRiver(x, z) / RIVER_HALF_WIDTH;
    if (t >= 1) return base;
    // Blend from the flat bed at the centre out to untouched land at the rim
    const bed = this.riverBedY(x);
    const w = t * t;
    return bed + (base - bed) * w;
  }

  addShadowCaster(mesh: BABYLON.AbstractMesh): void {
    this.shadowGenerator.addShadowCaster(mesh);
  }

  update(dt: number): void {
    this.time += dt;
    for (const cloud of this.clouds) {
      cloud.position.x += dt * 1.2;
      if (cloud.position.x > 160) cloud.position.x = -160;
    }
    if (this.water) {
      this.water.position.y = this.water.metadata.baseY + Math.sin(this.time * 0.9) * 0.04;
    }
    // Gentle shimmer on all water surfaces
    if (this.waterMat) {
      const shimmer = 0.92 + Math.sin(this.time * 1.6) * 0.07;
      this.waterMat.emissiveColor.set(0.45 * shimmer, 0.7 * shimmer, 0.9 * shimmer);
    }
  }

  /** Level 1 resource layout: forests, stone mines, gold mines. */
  spawnLevelResources(): ResourceNode[] {
    const nodes: ResourceNode[] = [];
    const tree = (x: number, z: number) => {
      if (this.overlapsWater(x, z)) return;
      nodes.push(new ResourceNode(this.scene, 'wood', new BABYLON.Vector3(x, this.getHeight(x, z), z), 90));
    };
    const mine = (type: 'stone' | 'gold', x: number, z: number) => {
      if (this.overlapsWater(x, z)) return;
      nodes.push(new ResourceNode(this.scene, type, new BABYLON.Vector3(x, this.getHeight(x, z), z), type === 'stone' ? 450 : 400));
    };

    const forest = (cx: number, cz: number, count: number, spread: number) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * spread;
        tree(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      }
    };

    // Near the player base (bottom-left)
    forest(-75, -30, 11, 9);
    forest(-30, -78, 11, 9);
    mine('stone', -25, -42);
    mine('gold', -46, -18);

    // Mid-map expansion resources
    forest(-65, 25, 9, 8);
    forest(22, 32, 13, 10);
    mine('gold', 32, -48);
    mine('stone', 48, 8);

    // Near the enemy camp (top-right) — reward for conquering
    forest(75, 30, 8, 7);
    mine('gold', 48, 80);

    for (const n of nodes) {
      for (const m of n.getMeshes()) this.addShadowCaster(m);
    }
    return nodes;
  }

  // ── Scenery ────────────────────────────────────────────────────

  private buildTerrain(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      'terrain',
      { width: 260, height: 260, subdivisions: 140 },
      this.scene
    );
    const positions = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = ground.getIndices();
    if (positions && indices) {
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] = this.getHeight(positions[i], positions[i + 2]);
      }
      const normals: number[] = [];
      BABYLON.VertexData.ComputeNormals(positions, indices, normals);
      // setVerticesData (not updateVerticesData): CreateGround's buffers are
      // non-updatable, so an update call never reaches the GPU and the mesh
      // would render as a flat plane while the CPU copy looked correct.
      ground.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions, true);
      ground.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, true);
      ground.refreshBoundingInfo();
    }
    ground.receiveShadows = true;
    ground.material = pastel(this.scene, 'grass', new BABYLON.Color3(0.55, 0.78, 0.45), { glow: 0.12 });
    ground.metadata = { ground: true };
  }

  private buildGroundPatches(): void {
    // Subtle darker/lighter grass patches for a hand-painted feel
    const shades = [
      new BABYLON.Color3(0.5, 0.74, 0.4),
      new BABYLON.Color3(0.6, 0.82, 0.48),
    ];
    for (let i = 0; i < 14; i++) {
      const x = (Math.random() - 0.5) * 190;
      const z = (Math.random() - 0.5) * 190;
      const radius = 5 + Math.random() * 6;
      // Flat discs float on sloped ground — keep them clear of the water
      if (this.distToRiver(x, z) < radius + 10) continue;
      if (Math.hypot(x - POND_CENTER.x, z - POND_CENTER.z) < radius + 15) continue;
      const disc = BABYLON.MeshBuilder.CreateDisc('patch', { radius, tessellation: 24 }, this.scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(x, this.getHeight(x, z) + 0.04, z);
      disc.material = pastel(this.scene, 'patch' + (i % 2), shades[i % 2], { glow: 0.12 });
      disc.isPickable = false;
    }
  }

  private buildPond(): void {
    const px = POND_CENTER.x, pz = POND_CENTER.z;
    const sand = BABYLON.MeshBuilder.CreateDisc('sand', { radius: 13.5, tessellation: 40 }, this.scene);
    sand.rotation.x = Math.PI / 2;
    sand.position.set(px, this.getHeight(px, pz) + 0.05, pz);
    sand.material = pastel(this.scene, 'sand', new BABYLON.Color3(0.9, 0.83, 0.6));
    sand.isPickable = false;

    const water = BABYLON.MeshBuilder.CreateDisc('pond', { radius: 12, tessellation: 40 }, this.scene);
    water.rotation.x = Math.PI / 2;
    const baseY = this.getHeight(px, pz) + 0.12;
    water.position.set(px, baseY, pz);
    // Flat-shaded cartoon water: consistent blue regardless of sun angle
    this.waterMat = pastel(this.scene, 'water', new BABYLON.Color3(0.45, 0.7, 0.9), { alpha: 0.88, glow: 0.95, disableLighting: true });
    water.material = this.waterMat;
    water.isPickable = false;
    water.metadata = { baseY };
    this.water = water;
  }

  /**
   * The Ganga. The bed is already carved into the terrain by getHeight, so
   * the water is a flat ribbon per cross-section — level across its width,
   * exactly as real water sits. Sampled finely so it hugs the valley.
   */
  private buildRiver(): void {
    // Sandy bed + shores: several paths across the channel so the surface
    // conforms to the carved valley instead of flattening over it.
    const bedPaths: BABYLON.Vector3[][] = [];
    const shoreHalf = RIVER_WATER_HALF + 2.2;
    const lanes = 9;
    for (let lane = 0; lane <= lanes; lane++) {
      const offset = -shoreHalf + (lane / lanes) * shoreHalf * 2;
      const path: BABYLON.Vector3[] = [];
      for (let x = -136; x <= 136; x += 4) {
        const z = this.riverCenterZ(x) + offset;
        path.push(new BABYLON.Vector3(x, this.getHeight(x, z) + 0.05, z));
      }
      bedPaths.push(path);
    }
    const sandMat = pastel(this.scene, 'sand', new BABYLON.Color3(0.9, 0.83, 0.6));
    const bankMesh = BABYLON.MeshBuilder.CreateRibbon(
      'riverBank',
      { pathArray: bedPaths, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
      this.scene
    );
    bankMesh.material = sandMat;
    bankMesh.isPickable = false;

    // The water itself: flat across each cross-section
    const left: BABYLON.Vector3[] = [];
    const right: BABYLON.Vector3[] = [];
    for (let x = -136; x <= 136; x += 4) {
      const zc = this.riverCenterZ(x);
      const wy = this.waterSurfaceY(x);
      left.push(new BABYLON.Vector3(x, wy, zc - RIVER_WATER_HALF));
      right.push(new BABYLON.Vector3(x, wy, zc + RIVER_WATER_HALF));
    }

    const river = BABYLON.MeshBuilder.CreateRibbon(
      'river',
      { pathArray: [left, right], sideOrientation: BABYLON.Mesh.DOUBLESIDE },
      this.scene
    );
    river.material = this.waterMat!;
    river.isPickable = false;
  }

  /** A wooden crossing over the Ganga, decked level with the banks. */
  private buildBridge(): void {
    const x = 0;
    const zc = this.riverCenterZ(x);
    // Deck sits at bank level so it meets the ground on both shores
    const deckY = this.baseHeight(x, zc) + 0.5;
    const wood = pastel(this.scene, 'bldWood', new BABYLON.Color3(0.78, 0.62, 0.42));

    const planks = BABYLON.MeshBuilder.CreateBox('bridge', { width: 4, height: 0.3, depth: 17 }, this.scene);
    planks.position.set(x, deckY, zc);
    planks.material = wood;
    planks.isPickable = false;

    // Pilings driven from the deck down into the riverbed
    for (const px of [-1.7, 1.7]) {
      for (const pz of [-4.2, 0, 4.2]) {
        const bedY = this.getHeight(x + px, zc + pz);
        const h = Math.max(0.5, deckY - bedY);
        const post = BABYLON.MeshBuilder.CreateCylinder('bPost', { height: h, diameter: 0.3 }, this.scene);
        post.position.set(x + px, bedY + h / 2, zc + pz);
        post.material = wood;
        post.isPickable = false;
      }
    }
    // Handrails
    for (const side of [-1.85, 1.85]) {
      const rail = BABYLON.MeshBuilder.CreateBox('bRail', { width: 0.14, height: 0.14, depth: 16.5 }, this.scene);
      rail.position.set(x + side, deckY + 0.85, zc);
      rail.material = wood;
      rail.isPickable = false;
      for (const pz of [-7.5, -2.5, 2.5, 7.5]) {
        const balus = BABYLON.MeshBuilder.CreateBox('bBalus', { width: 0.13, height: 0.85, depth: 0.13 }, this.scene);
        balus.position.set(x + side, deckY + 0.45, zc + pz);
        balus.material = wood;
        balus.isPickable = false;
      }
    }
  }

  /** Snow-capped Himalayan wall along the northern horizon. */
  private buildHimalayas(): void {
    const rockMat = pastel(this.scene, 'himalayaRock', new BABYLON.Color3(0.55, 0.56, 0.64));
    const snowMat = pastel(this.scene, 'himalayaSnow', new BABYLON.Color3(0.95, 0.96, 1), { glow: 0.25 });
    for (let i = 0; i < 9; i++) {
      const x = -120 + i * 30 + (Math.random() - 0.5) * 10;
      const z = 128 + Math.random() * 18;
      const h = 30 + Math.random() * 18;
      const peak = BABYLON.MeshBuilder.CreateCylinder('himalaya' + i, { height: h, diameterTop: 0, diameterBottom: h * 1.1, tessellation: 7 }, this.scene);
      peak.position.set(x, h / 2 - 3, z);
      peak.rotation.y = Math.random() * Math.PI;
      peak.material = rockMat;
      peak.isPickable = false;
      const capH = h * 0.35;
      const cap = BABYLON.MeshBuilder.CreateCylinder('himCap' + i, { height: capH, diameterTop: 0, diameterBottom: h * 1.1 * 0.38, tessellation: 7 }, this.scene);
      cap.position.set(x, h - 3 - capH / 2 + 0.3, z);
      cap.rotation.y = peak.rotation.y;
      cap.material = snowMat;
      cap.isPickable = false;
    }
  }

  /** Little villages that make Anga feel inhabited. */
  private buildHamlets(): void {
    const hutMat = pastel(this.scene, 'hutWall', new BABYLON.Color3(0.93, 0.87, 0.72));
    const thatchMat = pastel(this.scene, 'thatch', new BABYLON.Color3(0.85, 0.72, 0.45));
    for (const hamlet of HAMLETS) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const hx = hamlet.x + Math.cos(a) * 4.5;
        const hz = hamlet.z + Math.sin(a) * 4.5;
        const y = this.getHeight(hx, hz);
        const hut = BABYLON.MeshBuilder.CreateBox('hut', { width: 2.4, height: 1.7, depth: 2.4 }, this.scene);
        hut.position.set(hx, y + 0.85, hz);
        hut.rotation.y = Math.random() * Math.PI;
        hut.material = hutMat;
        hut.isPickable = false;
        const roof = BABYLON.MeshBuilder.CreateCylinder('hutRoof', { height: 1.3, diameterBottom: 3.4, diameterTop: 0.1, tessellation: 6 }, this.scene);
        roof.position.set(hx, y + 2.3, hz);
        roof.rotation.y = hut.rotation.y;
        roof.material = thatchMat;
        roof.isPickable = false;
      }
      const patch = BABYLON.MeshBuilder.CreateDisc('hamletPatch', { radius: 8, tessellation: 28 }, this.scene);
      patch.rotation.x = Math.PI / 2;
      patch.position.set(hamlet.x, this.getHeight(hamlet.x, hamlet.z) + 0.05, hamlet.z);
      patch.material = pastel(this.scene, 'dirtPatch', new BABYLON.Color3(0.82, 0.72, 0.52));
      patch.isPickable = false;
    }
  }

  /** Scattered flowers, bushes and pebbles — a denser, livelier meadow. */
  private buildFlowersAndBushes(): void {
    const stemMat = pastel(this.scene, 'stem', new BABYLON.Color3(0.3, 0.55, 0.3));
    const petalMats = [
      pastel(this.scene, 'petalR', new BABYLON.Color3(0.9, 0.35, 0.4), { glow: 0.25 }),
      pastel(this.scene, 'petalY', new BABYLON.Color3(0.95, 0.85, 0.35), { glow: 0.25 }),
      pastel(this.scene, 'petalW', new BABYLON.Color3(0.95, 0.95, 0.95), { glow: 0.25 }),
      pastel(this.scene, 'petalP', new BABYLON.Color3(0.78, 0.5, 0.9), { glow: 0.25 }),
    ];
    for (let i = 0; i < 70; i++) {
      const x = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      if (this.overlapsWater(x, z)) continue;
      const h = this.getHeight(x, z);
      const stem = BABYLON.MeshBuilder.CreateCylinder('stem', { height: 0.35, diameter: 0.05 }, this.scene);
      stem.position.set(x, h + 0.17, z);
      stem.material = stemMat;
      stem.isPickable = false;
      const head = BABYLON.MeshBuilder.CreateSphere('flower', { diameter: 0.2, segments: 5 }, this.scene);
      head.position.set(x, h + 0.4, z);
      head.material = petalMats[i % petalMats.length];
      head.isPickable = false;
    }
    const bushMat = pastel(this.scene, 'bush', new BABYLON.Color3(0.42, 0.66, 0.4));
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      if (this.overlapsWater(x, z)) continue;
      const bush = BABYLON.MeshBuilder.CreateSphere('bush', { diameter: 1 + Math.random() * 1.2, segments: 6 }, this.scene);
      bush.position.set(x, this.getHeight(x, z) + 0.35, z);
      bush.scaling.y = 0.65;
      bush.material = bushMat;
      bush.isPickable = false;
    }
    const pebbleMat = pastel(this.scene, 'pebble', new BABYLON.Color3(0.6, 0.6, 0.62));
    for (let i = 0; i < 14; i++) {
      const x = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      if (this.overlapsWater(x, z)) continue;
      const pebble = BABYLON.MeshBuilder.CreateIcoSphere('pebble', { radius: 0.35 + Math.random() * 0.5, subdivisions: 1, flat: true }, this.scene);
      pebble.position.set(x, this.getHeight(x, z) + 0.15, z);
      pebble.scaling.y = 0.6;
      pebble.material = pebbleMat;
      pebble.isPickable = false;
    }
  }

  private buildHillsRing(): void {
    // A ring of soft pastel hills that frames the play area like a diorama
    const colors = [
      new BABYLON.Color3(0.55, 0.75, 0.5),
      new BABYLON.Color3(0.65, 0.8, 0.55),
      new BABYLON.Color3(0.75, 0.82, 0.65),
    ];
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const radius = 128 + Math.random() * 22;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = 8 + Math.random() * 16;
      const hill = BABYLON.MeshBuilder.CreateSphere('hill' + i, { diameter: h * 2.4, segments: 10 }, this.scene);
      hill.position.set(x, -h * 0.55, z);
      hill.scaling.y = 0.9;
      hill.material = pastel(this.scene, 'hill' + (i % 3), colors[i % 3], { glow: 0.14 });
      hill.isPickable = false;
    }
  }

  private buildClouds(): void {
    const mat = pastel(this.scene, 'cloud', new BABYLON.Color3(1, 1, 1), { alpha: 0.9, glow: 0.85, disableLighting: true });
    for (let c = 0; c < 6; c++) {
      const root = new BABYLON.TransformNode('cloud' + c, this.scene);
      root.position.set((Math.random() - 0.5) * 280, 42 + Math.random() * 14, (Math.random() - 0.5) * 280);
      const puffs = 3 + Math.floor(Math.random() * 2);
      for (let p = 0; p < puffs; p++) {
        const d = 6 + Math.random() * 5;
        const puff = BABYLON.MeshBuilder.CreateSphere('puff', { diameter: d, segments: 8 }, this.scene);
        puff.parent = root;
        puff.position.set((p - puffs / 2) * d * 0.55, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3);
        puff.scaling.y = 0.5;
        puff.material = mat;
        puff.isPickable = false;
      }
      this.clouds.push(root);
    }
  }

  private buildSparkles(): void {
    const tex = new BABYLON.DynamicTexture('sparkTex', { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,235,1)');
    gradient.addColorStop(0.4, 'rgba(255,250,220,0.5)');
    gradient.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;

    const ps = new BABYLON.ParticleSystem('sparkles', 160, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new BABYLON.Vector3(0, 4, 0);
    ps.minEmitBox = new BABYLON.Vector3(-90, -2, -90);
    ps.maxEmitBox = new BABYLON.Vector3(90, 8, 90);
    ps.color1 = new BABYLON.Color4(1, 1, 0.9, 0.7);
    ps.color2 = new BABYLON.Color4(1, 0.95, 0.8, 0.5);
    ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    ps.minSize = 0.12;
    ps.maxSize = 0.3;
    ps.minLifeTime = 5;
    ps.maxLifeTime = 10;
    ps.emitRate = 16;
    ps.direction1 = new BABYLON.Vector3(-0.2, 0.05, -0.2);
    ps.direction2 = new BABYLON.Vector3(0.2, 0.2, 0.2);
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.4;
    ps.updateSpeed = 0.01;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.start();
  }
}
