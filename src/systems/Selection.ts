import * as BABYLON from '@babylonjs/core';
import { Input } from '../core/Input';
import { Unit } from '../entities/Unit';
import { Minion } from '../entities/Minion';
import { Warrior } from '../entities/Warrior';
import { Building, BuildingKey, BUILDING_DEFS } from '../buildings/Building';
import { ResourceNode } from '../world/ResourceNode';
import { pastel } from '../core/Materials';
import { costLabel } from '../ui/HUD';
import type { Game, ChainSegment } from '../Game';

export type Selectable = Unit | Building;

/**
 * RTS mouse handling:
 * - Left click: select a unit/building. Left drag: box-select units.
 * - Right click: context command — move / gather / build / attack.
 * - Building placement: ghost follows the mouse; left click places.
 * - Walls (chainable buildings): press and drag to lay a whole line of
 *   segments at once — hold Shift to snap the line to 45° angles.
 */
export class SelectionSystem {
  selected: Selectable[] = [];

  private game: Game;
  private scene: BABYLON.Scene;
  private input: Input;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private boxDiv: HTMLElement;

  private placingKey: BuildingKey | null = null;
  private ghost: BABYLON.TransformNode | null = null;
  private ghostRing: BABYLON.Mesh | null = null;
  private ghostValid = false;

  /** Chain (wall) placement state. */
  private chainMode = false;
  private chainStart: BABYLON.Vector3 | null = null;
  private chainPlan: ChainSegment[] = [];
  private chainGhosts: BABYLON.Mesh[] = [];

  constructor(scene: BABYLON.Scene, input: Input, game: Game) {
    this.scene = scene;
    this.game = game;
    this.input = input;
    this.boxDiv = document.getElementById('selectbox')!;

    input.onLeftDown((x, y) => this.onLeftDown(x, y));
    input.onLeftUp((x, y) => this.onLeftUp(x, y));
    input.onRightDown((x, y) => this.onRightDown(x, y));
    input.onPointerMove((x, y) => this.onMove(x, y));
    input.onCancel(() => {
      this.cancelPlacement();
      this.select([]);
    });
  }

  // ── Building placement ─────────────────────────────────────────

  beginPlacement(key: BuildingKey): void {
    this.cancelPlacement();
    this.placingKey = key;
    const def = BUILDING_DEFS[key];
    this.chainMode = !!def.chainable;

    if (this.chainMode) {
      // No single ghost — the chain preview covers the one-segment case too
      const start = this.pickGround(this.input.pointerX, this.input.pointerY);
      if (start) this.updateChainPreview(start);
      else {
        this.game.hud.showPlacement(`${def.icon} ${def.name}`,
          'Press and drag across the ground to raise a wall line');
      }
      return;
    }

    // Ghost: a translucent footprint ring + marker box
    this.ghost = new BABYLON.TransformNode('ghost', this.scene);
    const marker = BABYLON.MeshBuilder.CreateBox('ghostBox', { width: def.footprint * 1.4, height: 2, depth: def.footprint * 1.4 }, this.scene);
    marker.parent = this.ghost;
    marker.position.y = 1;
    marker.material = pastel(this.scene, 'ghostBox', new BABYLON.Color3(0.9, 0.95, 1), { alpha: 0.35, glow: 0.5 });
    marker.isPickable = false;
    this.ghostRing = BABYLON.MeshBuilder.CreateTorus('ghostRing', { diameter: def.footprint * 2.2, thickness: 0.15, tessellation: 40 }, this.scene);
    this.ghostRing.parent = this.ghost;
    this.ghostRing.position.y = 0.1;
    this.ghostRing.isPickable = false;
    this.game.hud.showPlacement(`${def.icon} ${def.name}`,
      `${costLabel(def.cost)} · left-click to build · Esc cancels`);
  }

  cancelPlacement(): void {
    this.placingKey = null;
    if (this.ghost) {
      this.ghost.dispose();
      this.ghost = null;
      this.ghostRing = null;
    }
    for (const g of this.chainGhosts) g.dispose();
    this.chainGhosts = [];
    this.chainMode = false;
    this.chainStart = null;
    this.chainPlan = [];
    this.game.hud.hidePlacement();
  }

  get isPlacing(): boolean {
    return this.placingKey !== null;
  }

  // ── Wall lines ─────────────────────────────────────────────────

  /** Shift locks the line to 45° steps, for square forts. */
  private snapEnd(start: BABYLON.Vector3, end: BABYLON.Vector3): BABYLON.Vector3 {
    if (!this.input.isDown('shift')) return end;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return end;
    const quarter = Math.PI / 4;
    const angle = Math.round(Math.atan2(dz, dx) / quarter) * quarter;
    return new BABYLON.Vector3(start.x + Math.cos(angle) * len, end.y, start.z + Math.sin(angle) * len);
  }

  /** Rebuilds the translucent preview of the whole line and its cost readout. */
  private updateChainPreview(end: BABYLON.Vector3): void {
    const key = this.placingKey!;
    const def = BUILDING_DEFS[key];
    const start = this.chainStart ?? end;
    const plan = this.game.planChain(key, start, this.snapEnd(start, end));
    this.chainPlan = plan;

    const budget = this.game.affordableCount(def.cost);
    let paid = 0;
    while (this.chainGhosts.length < plan.length) this.chainGhosts.push(this.makeChainGhost());

    for (let i = 0; i < this.chainGhosts.length; i++) {
      const ghost = this.chainGhosts[i];
      if (i >= plan.length) { ghost.setEnabled(false); continue; }
      const seg = plan[i];
      const affordable = seg.valid && paid < budget;
      if (seg.valid) paid++;
      ghost.setEnabled(true);
      ghost.position.set(seg.pos.x, seg.pos.y + 1.05, seg.pos.z);
      ghost.rotation.y = seg.yaw;
      ghost.material = affordable ? this.chainMatOk() : this.chainMatBad();
    }

    const buildable = plan.filter((s) => s.valid).length;
    const willBuild = Math.min(buildable, budget);
    const blocked = plan.length - buildable;

    if (willBuild === 0) {
      this.game.hud.showPlacement(
        `${def.icon} ${def.name} — cannot build`,
        budget === 0
          ? `needs ${costLabel(def.cost)} per segment`
          : `⛔ ${blocked} segment${blocked > 1 ? 's' : ''} blocked · move to open ground`,
        true
      );
      return;
    }

    const total = {
      wood: (def.cost.wood ?? 0) * willBuild || undefined,
      stone: (def.cost.stone ?? 0) * willBuild || undefined,
      gold: (def.cost.gold ?? 0) * willBuild || undefined,
      food: (def.cost.food ?? 0) * willBuild || undefined,
    };
    const hints = [costLabel(total)];
    if (blocked > 0) hints.push(`⛔ ${blocked} blocked`);
    if (buildable > budget) hints.push('capped by resources');
    hints.push(this.chainStart ? 'release to build · Shift snaps straight' : 'drag to extend the line');
    this.game.hud.showPlacement(`${def.icon} ${def.name} × ${willBuild}`, hints.join(' · '));
  }

  private makeChainGhost(): BABYLON.Mesh {
    const mesh = BABYLON.MeshBuilder.CreateBox('chainGhost', { width: 3.6, height: 2.1, depth: 1.2 }, this.scene);
    mesh.isPickable = false;
    mesh.material = this.chainMatOk();
    return mesh;
  }

  private chainMatOk(): BABYLON.Material {
    return pastel(this.scene, 'chainOk', new BABYLON.Color3(0.45, 0.95, 0.55), { alpha: 0.4, glow: 0.7, disableLighting: true });
  }

  private chainMatBad(): BABYLON.Material {
    return pastel(this.scene, 'chainBad', new BABYLON.Color3(0.95, 0.35, 0.3), { alpha: 0.4, glow: 0.7, disableLighting: true });
  }

  // ── Pointer handlers ───────────────────────────────────────────

  private onLeftDown(x: number, y: number): void {
    if (this.placingKey) {
      // Walls: anchor the line here and lay it out on release
      if (this.chainMode) {
        const start = this.pickGround(x, y);
        if (!start) { this.game.toast('Cannot build there ❌'); return; }
        this.chainStart = start;
        this.updateChainPreview(start);
        return;
      }
      if (this.ghostValid && this.ghost) {
        this.game.placeBuilding(this.placingKey, this.ghost.position.clone());
        this.cancelPlacement();
      } else {
        this.game.toast('Cannot build there ❌');
      }
      return;
    }
    this.dragStart = { x, y };
    this.dragging = false;
  }

  private onMove(x: number, y: number): void {
    if (this.placingKey && this.chainMode) {
      const p = this.pickGround(x, y);
      if (p) this.updateChainPreview(p);
      return;
    }
    if (this.placingKey && this.ghost) {
      const pick = this.pickGround(x, y);
      if (pick) {
        this.ghost.position.copyFrom(pick);
        this.ghostValid = this.game.isPlacementValid(this.placingKey, pick);
        const color = this.ghostValid ? new BABYLON.Color3(0.4, 0.95, 0.5) : new BABYLON.Color3(0.95, 0.35, 0.3);
        this.ghostRing!.material = pastel(this.scene, this.ghostValid ? 'ghostOk' : 'ghostBad', color, { glow: 0.9, disableLighting: true });
      }
      return;
    }
    if (this.dragStart) {
      const dx = Math.abs(x - this.dragStart.x);
      const dy = Math.abs(y - this.dragStart.y);
      if (dx + dy > 8) this.dragging = true;
      if (this.dragging) {
        const left = Math.min(x, this.dragStart.x);
        const top = Math.min(y, this.dragStart.y);
        this.boxDiv.style.display = 'block';
        this.boxDiv.style.left = left + 'px';
        this.boxDiv.style.top = top + 'px';
        this.boxDiv.style.width = dx + 'px';
        this.boxDiv.style.height = dy + 'px';
      }
    }
  }

  private onLeftUp(x: number, y: number): void {
    // Releasing a wall drag commits the whole line
    if (this.placingKey && this.chainMode) {
      if (!this.chainStart) return;
      const key = this.placingKey;
      const end = this.pickGround(x, y);
      const plan = end
        ? this.game.planChain(key, this.chainStart, this.snapEnd(this.chainStart, end))
        : this.chainPlan;
      this.cancelPlacement();
      this.game.placeChain(key, plan);
      return;
    }
    if (!this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;
    this.boxDiv.style.display = 'none';

    if (this.dragging) {
      this.dragging = false;
      this.boxSelect(start.x, start.y, x, y);
      return;
    }

    // Single click select
    const pick = this.scene.pick(x, y, (m) => m.isPickable && m.isEnabled());
    const owner = pick?.pickedMesh?.metadata?.owner;
    if (owner instanceof Unit || owner instanceof Building) {
      this.select([owner]);
    } else {
      this.select([]);
    }
  }

  private onRightDown(x: number, y: number): void {
    if (this.placingKey) {
      this.cancelPlacement();
      return;
    }
    if (this.selected.length === 0) return;

    const pick = this.scene.pick(x, y, (m) => m.isPickable && m.isEnabled());
    const owner = pick?.pickedMesh?.metadata?.owner;

    const myMinions = this.selected.filter((s): s is Minion => s instanceof Minion && s.alive);
    const myWarriors = this.selected.filter((s): s is Warrior => s instanceof Warrior && s.team === 'player' && s.alive);

    if (owner instanceof ResourceNode && !owner.depleted) {
      myMinions.forEach((m) => m.commandGather(owner));
      myWarriors.forEach((w, i) => w.commandMove(owner.position.add(this.offset(i + 1))));
      if (myMinions.length) this.game.toast(`⛏️ Gathering ${owner.type}`);
      return;
    }

    if (owner instanceof Building) {
      if (owner.team === 'player' && !owner.completed) {
        myMinions.forEach((m) => m.commandBuild(owner));
        if (myMinions.length) this.game.toast(`🔨 Building ${owner.def.name}`);
        return;
      }
      // Right-clicking a finished Farm/Dock sends minions to work it
      if (owner.team === 'player' && owner.completed && owner.foodNode && !owner.foodNode.depleted) {
        myMinions.forEach((m) => m.commandGather(owner.foodNode!));
        if (myMinions.length) this.game.toast(`🌾 Working the ${owner.def.name}`);
        return;
      }
      if (owner.team === 'enemy') {
        myWarriors.forEach((w) => w.commandAttack(owner));
        if (myWarriors.length) this.game.toast('⚔️ Attack!');
        return;
      }
    }

    if ((owner instanceof Unit) && owner.team === 'enemy') {
      myWarriors.forEach((w) => w.commandAttack(owner));
      myMinions.forEach((m, i) => m.commandMove(this.selectedCentroid().add(this.offset(i))));
      if (myWarriors.length) this.game.toast('⚔️ Attack!');
      return;
    }

    // Ground: formation move
    if (pick?.pickedPoint) {
      const units = [...myMinions, ...myWarriors];
      units.forEach((u, i) => u.commandMove(pick.pickedPoint!.add(this.offset(i))));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  select(list: Selectable[]): void {
    for (const s of this.selected) s.setSelected(false);
    this.selected = list.filter((s) => s.alive);
    for (const s of this.selected) s.setSelected(true);
    this.game.hud.showSelection(this.selected);
  }

  /** Drop dead things from the selection (called each frame). */
  prune(): void {
    const before = this.selected.length;
    this.selected = this.selected.filter((s) => s.alive);
    if (this.selected.length !== before) this.game.hud.showSelection(this.selected);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number): void {
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    const engine = this.scene.getEngine();
    const viewport = new BABYLON.Viewport(0, 0, 1, 1).toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const picked: Selectable[] = [];
    const candidates: Unit[] = [...this.game.minions, ...this.game.warriors];
    for (const u of candidates) {
      if (!u.alive) continue;
      const p = BABYLON.Vector3.Project(
        u.position,
        BABYLON.Matrix.Identity(),
        this.scene.getTransformMatrix(),
        viewport
      );
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) picked.push(u);
    }
    this.select(picked);
  }

  private pickGround(x: number, y: number): BABYLON.Vector3 | null {
    const pick = this.scene.pick(x, y, (m) => !!m.metadata?.ground);
    return pick?.pickedPoint ?? null;
  }

  private offset(i: number): BABYLON.Vector3 {
    if (i === 0) return BABYLON.Vector3.Zero();
    const ring = Math.ceil(i / 6);
    const angle = (i % 6) / 6 * Math.PI * 2 + ring;
    return new BABYLON.Vector3(Math.cos(angle) * 1.5 * ring, 0, Math.sin(angle) * 1.5 * ring);
  }

  private selectedCentroid(): BABYLON.Vector3 {
    const c = BABYLON.Vector3.Zero();
    for (const s of this.selected) c.addInPlace(s.position);
    return c.scale(1 / Math.max(1, this.selected.length));
  }
}
