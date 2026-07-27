import { Building } from '../buildings/Building';
import { BUILDING_DEFS, BuildingKey, Cost } from '../buildings/Building';
import { Minion } from '../entities/Minion';
import { Warrior } from '../entities/Warrior';
import { Sfx } from '../systems/Sound';
import type { StoryEventDef } from '../systems/Story';
import type { Selectable } from '../systems/Selection';
import type { Game, TechKey } from '../Game';

const RES_ICON = { wood: '🌲', stone: '🪨', gold: '🪙', food: '🌾' } as const;

/** Build palette, grouped the way strategy games do it: economy → military → defense. */
const BUILD_GROUPS: { label: string; keys: BuildingKey[] }[] = [
  { label: 'Economy',  keys: ['farm', 'fishingDock', 'library'] },
  { label: 'Military', keys: ['barracks', 'temple', 'warStable'] },
  { label: 'Defense',  keys: ['wall', 'gate', 'watchtower'] },
];

const BUILD_NOTES: Record<string, string> = {
  farm: 'Grows wheat your minions harvest for food.',
  fishingDock: 'Must be placed on a pond or river shore.',
  library: 'Researches military & economy upgrades.',
  barracks: 'Trains soldiers for the war against the totem.',
  temple: 'Cultural research and the Sun-god’s blessing.',
  warStable: 'Trains horsemen and Karna’s war chariots.',
  wall: 'Drag to raise a whole wall line — ring your town into a fort.',
  gate: 'Your units pass freely; enemy hordes do not.',
  watchtower: 'Rains arrows on enemies in range. Place along your walls.',
};

const UNIT_INFO: Record<string, { icon: string; name: string }> = {
  hero: { icon: '👑', name: 'Karna' },
  soldier: { icon: '🗡️', name: 'Soldier' },
  scout: { icon: '🏃', name: 'Scout' },
  horseman: { icon: '🐎', name: 'Horseman' },
  chariot: { icon: '🛞', name: 'War Chariot' },
};

const ORDERS_HINT =
  '<div class="ordersEmpty">Select a unit or building to see its orders.<br>' +
  '<kbd>Right-click</kbd> ground to move · a resource to gather · an enemy to attack.</div>';

export function costLabel(cost: Cost): string {
  const parts: string[] = [];
  for (const k of ['wood', 'stone', 'gold', 'food'] as const) {
    const v = cost[k];
    if (v) parts.push(`${v}${RES_ICON[k]}`);
  }
  return parts.length ? parts.join(' ') : 'free';
}

/**
 * DOM game UI: a top resource banner and a bottom command bar split into
 * Selection · Orders · Build, plus story modal, toasts and end screens.
 * Build tiles are generated from BUILDING_DEFS so costs never drift.
 */
export class HUD {
  private game!: Game;
  private el = (id: string) => document.getElementById(id)!;
  private refreshTimer = 0;
  private currentSelection: Selectable[] = [];
  private storyChooseCb: ((i: number) => void) | null = null;

  /** key → tile, for the affordability pass in tick(). */
  private buildTiles = new Map<BuildingKey, HTMLButtonElement>();
  /** hotkey digit → build key. */
  private hotkeys = new Map<string, BuildingKey>();
  private actionBuilding: Building | null = null;
  private lastSelHtml = '';
  private lastActHtml = '';

  bind(game: Game): void {
    this.game = game;
    this.buildPalette();

    this.el('helpBtn').addEventListener('click', () => {
      const card = this.el('helpCard');
      card.style.display = card.style.display === 'none' ? 'block' : 'none';
    });
    this.el('helpClose').addEventListener('click', () => {
      this.el('helpCard').style.display = 'none';
    });

    this.renderSelection();
  }

  // ── Build palette ──────────────────────────────────────────────

  private buildPalette(): void {
    const host = this.el('buildGroups');
    let hotkey = 1;
    host.innerHTML = '';

    for (const group of BUILD_GROUPS) {
      const col = document.createElement('div');
      col.className = 'buildGroup';
      const label = document.createElement('div');
      label.className = 'groupLabel';
      label.textContent = group.label;
      const tiles = document.createElement('div');
      tiles.className = 'groupTiles';

      for (const key of group.keys) {
        const def = BUILDING_DEFS[key];
        const hk = String(hotkey++);
        this.hotkeys.set(hk, key);

        const btn = document.createElement('button');
        btn.className = 'tile';
        btn.dataset.build = key;
        const locked = def.requiresAge && def.requiresAge > 1;
        btn.innerHTML =
          `<span class="tileIcon">${def.icon}</span>` +
          `<span class="tileKey">${hk}</span>` +
          (locked ? '<span class="tileLock">🔒</span>' : '') +
          '<span class="tileTip">' +
            `<span class="tipName">${def.icon} ${def.name}</span>` +
            `<span class="tipCost">${costLabel(def.cost)}</span>` +
            `<span class="tipDesc">${BUILD_NOTES[key] ?? ''}</span>` +
            (locked ? '<span class="tipWarn">🔒 Requires the Kingdom Age</span>' : '') +
            `<span class="tipKey">Hotkey <kbd>${hk}</kbd></span>` +
          '</span>';
        btn.addEventListener('click', () => {
          Sfx.play('click');
          this.game.requestPlacement(key);
        });
        this.buildTiles.set(key, btn);
        tiles.appendChild(btn);
      }

      col.appendChild(label);
      col.appendChild(tiles);
      host.appendChild(col);
    }
  }

  /** Digit hotkeys 1–9 fire the matching build tile. */
  pressHotkey(key: string): boolean {
    const buildKey = this.hotkeys.get(key);
    if (!buildKey) return false;
    const tile = this.buildTiles.get(buildKey);
    if (!tile || tile.disabled) return false;
    Sfx.play('click');
    this.game.requestPlacement(buildKey);
    return true;
  }

  // ── Per-frame refresh ──────────────────────────────────────────

  tick(dt: number): void {
    this.refreshTimer -= dt;
    if (this.refreshTimer > 0) return;
    this.refreshTimer = 0.2;

    const r = this.game.resources;
    this.el('resWood').textContent = String(Math.floor(r.wood));
    this.el('resStone').textContent = String(Math.floor(r.stone));
    this.el('resGold').textContent = String(Math.floor(r.gold));
    this.el('resFood').textContent = String(Math.floor(r.food));
    this.el('countMinions').textContent = String(this.game.minions.filter((m) => m.alive).length);
    this.el('countArmy').textContent = String(this.game.warriors.filter((w) => w.alive).length);
    this.el('ageLabel').textContent = this.game.age === 1 ? '🏛️ Village Age' : '👑 Kingdom Age';

    for (const [key, tile] of this.buildTiles) {
      const def = BUILDING_DEFS[key];
      const ageOk = this.game.age >= (def.requiresAge ?? 1);
      tile.disabled = !ageOk || !this.game.canAfford(def.cost);
      const lock = tile.querySelector('.tileLock') as HTMLElement | null;
      if (lock) lock.style.display = ageOk ? 'none' : 'block';
      const warn = tile.querySelector('.tipWarn') as HTMLElement | null;
      if (warn) warn.style.display = ageOk ? 'none' : 'block';
    }

    this.renderSelection();
  }

  toast(msg: string): void {
    const container = this.el('messages');
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    container.appendChild(div);
    while (container.children.length > 3) container.removeChild(container.firstChild!);
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 600);
    }, 3200);
  }

  // ── Placement banner ───────────────────────────────────────────

  showPlacement(main: string, hint: string, bad = false): void {
    const el = this.el('placeBanner');
    el.innerHTML = `<span class="pbMain">${main}</span><span class="pbHint">${hint}</span>`;
    el.classList.add('on');
    el.classList.toggle('bad', bad);
  }

  hidePlacement(): void {
    this.el('placeBanner').classList.remove('on');
  }

  // ── Story modal ────────────────────────────────────────────────

  showStory(def: StoryEventDef, onChoose: (i: number) => void): void {
    this.storyChooseCb = onChoose;
    this.el('storyIcon').textContent = def.icon;
    this.el('storyTitle').textContent = def.title;
    this.el('storyText').textContent = def.text;
    const box = this.el('storyChoices');
    box.innerHTML = '';
    def.choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'hudBtn storyBtn';
      btn.textContent = c.label;
      btn.addEventListener('click', () => { Sfx.play('click'); this.storyChooseCb?.(i); });
      box.appendChild(btn);
    });
    this.el('storyModal').style.display = 'flex';
  }

  hideStory(): void {
    this.el('storyModal').style.display = 'none';
    this.storyChooseCb = null;
  }

  // ── Selection & orders ─────────────────────────────────────────

  showSelection(sel: Selectable[]): void {
    this.currentSelection = sel;
    this.renderSelection();
  }

  /** Writes both zones, but only touches the DOM when the markup changed. */
  private paint(selHtml: string, actHtml: string): void {
    if (selHtml !== this.lastSelHtml) {
      this.lastSelHtml = selHtml;
      this.el('selBody').innerHTML = selHtml;
    }
    if (actHtml !== this.lastActHtml) {
      this.lastActHtml = actHtml;
      const grid = this.el('actionGrid');
      grid.innerHTML = actHtml;
      grid.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => this.runAction((btn as HTMLElement).dataset.action!));
      });
    }
  }

  private runAction(action: string): void {
    const b = this.actionBuilding;
    if (!b || !b.alive) return;
    Sfx.play('click');
    if (action === 'trainMinion') this.game.trainMinion(b);
    else if (action === 'trainScout') this.game.trainScout(b);
    else if (action === 'trainSoldier') this.game.trainSoldier(b);
    else if (action === 'trainHorseman') this.game.trainHorseman(b);
    else if (action === 'trainChariot') this.game.trainChariot(b);
    else if (action === 'ageUp') this.game.upgradeAge(b);
    else if (action.startsWith('research_')) this.game.startResearch(b, action.slice(9) as TechKey);
  }

  private renderSelection(): void {
    const sel = this.currentSelection.filter((s) => s.alive);
    if (sel.length === 0) {
      this.actionBuilding = null;
      this.paint(
        '<div class="selEmpty">Nothing selected.<br>Click a unit or building — drag a box to select an army.</div>',
        ORDERS_HINT
      );
      return;
    }

    if (sel.length === 1 && sel[0] instanceof Building) {
      this.renderBuilding(sel[0] as Building);
      return;
    }

    this.actionBuilding = null;
    const minions = sel.filter((s) => s instanceof Minion) as Minion[];
    const warriors = sel.filter((s) => s instanceof Warrior) as Warrior[];

    const chips: string[] = [];
    for (const variant of ['hero', 'soldier', 'scout', 'horseman', 'chariot']) {
      const n = warriors.filter((w) => w.variant === variant).length;
      if (!n) continue;
      const info = UNIT_INFO[variant];
      chips.push(`<span class="compChip">${info.icon} ${variant === 'hero' ? info.name : `${n} ${info.name}${n > 1 ? 's' : ''}`}</span>`);
    }
    if (minions.length) {
      chips.push(`<span class="compChip">👶 ${minions.length} Minion${minions.length > 1 ? 's' : ''}</span>`);
    }

    let selHtml: string;
    if (sel.length === 1) {
      const u = sel[0] as Minion | Warrior;
      const info = u instanceof Minion
        ? { icon: '👶', name: 'Minion' }
        : UNIT_INFO[(u as Warrior).variant] ?? { icon: '🗡️', name: 'Warrior' };
      selHtml =
        '<div class="selHead">' +
          `<div class="portrait">${info.icon}</div>` +
          '<div class="selMeta">' +
            `<div class="selName">${info.name}</div>` +
            `<div class="selSub">${u.status}</div>` +
            this.hpBar(u.hp, u.maxHp) +
          '</div>' +
        '</div>';
    } else {
      const totalHp = sel.reduce((n, s) => n + s.hp, 0);
      const totalMax = sel.reduce((n, s) => n + s.maxHp, 0);
      const lead = warriors.find((w) => w.variant === 'hero') ? '👑' : (warriors.length ? '⚔️' : '👶');
      selHtml =
        '<div class="selHead">' +
          `<div class="portrait">${lead}</div>` +
          '<div class="selMeta">' +
            `<div class="selName">${sel.length} selected</div>` +
            `<div class="selSub">${warriors.length} fighting · ${minions.length} working</div>` +
            this.hpBar(totalHp, totalMax) +
          '</div>' +
        '</div>' +
        `<div class="compRow">${chips.join('')}</div>`;
    }

    const orders = warriors.length > 0
      ? '<div class="ordersEmpty"><kbd>Right-click</kbd> an enemy or the Dark Totem to attack.<br><kbd>Right-click</kbd> ground to march in formation.</div>'
      : '<div class="ordersEmpty"><kbd>Right-click</kbd> trees, stone, gold or a farm to gather.<br><kbd>Right-click</kbd> a construction site to help build it.</div>';
    this.paint(selHtml, orders);
  }

  private hpBar(hp: number, maxHp: number): string {
    const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const low = pct < 35 ? ' low' : '';
    return `<div class="bar hp${low}"><span style="width:${pct.toFixed(1)}%"></span></div>` +
      `<div class="barLabel"><span>HP</span><span>${Math.ceil(hp)} / ${maxHp}</span></div>`;
  }

  private renderBuilding(b: Building): void {
    this.actionBuilding = b;

    let sel =
      '<div class="selHead">' +
        `<div class="portrait">${b.def.icon}</div>` +
        '<div class="selMeta">' +
          `<div class="selName">${b.def.name}</div>` +
          `<div class="selSub">${b.completed ? (b.team === 'enemy' ? 'Enemy structure' : 'Operational') : 'Under construction'}</div>` +
          this.hpBar(b.hp, b.maxHp) +
        '</div>' +
      '</div>';

    if (!b.completed) {
      const pct = Math.floor(b.progress * 100);
      sel += `<div class="bar build"><span style="width:${pct}%"></span></div>` +
        `<div class="barLabel"><span>🔨 Construction</span><span>${pct}%</span></div>` +
        '<div class="selNote">Right-click the site with minions to speed it up.</div>';
      this.paint(sel, '<div class="ordersEmpty">No orders until construction finishes.</div>');
      return;
    }

    if (b.queue.length > 0) {
      const item = b.queue[0];
      const pct = Math.floor((1 - item.remaining / item.duration) * 100);
      sel += `<div class="bar queue"><span style="width:${pct}%"></span></div>` +
        `<div class="barLabel"><span>⏳ ${item.label}</span><span>${pct}%${b.queue.length > 1 ? ` (+${b.queue.length - 1})` : ''}</span></div>`;
    }

    const note = BUILD_NOTES[b.def.key];
    if (b.def.key === 'farm' || b.def.key === 'fishingDock') {
      const left = b.foodNode && !b.foodNode.depleted ? Math.floor(b.foodNode.amount) : 0;
      sel += `<div class="selNote">🌾 Food remaining: <b>${left}</b> — right-click with minions to work it.</div>`;
    } else if (note && b.team === 'player') {
      sel += `<div class="selNote">${note}</div>`;
    }

    // Orders
    let act = '';
    if (b.def.key === 'townCenter') {
      act += this.actionTile('trainMinion', '👶', 'Train Minion', { gold: 40, food: 20 }, 'Gathers resources and builds.');
      act += this.actionTile('trainScout', '🏃', 'Train Scout', { gold: 30, food: 10 }, 'Fast, cheap, sees far.');
      if (this.game.age === 1) {
        act += this.actionTile('ageUp', '👑', 'Kingdom Age', { wood: 200, stone: 100, gold: 150 }, 'Unlocks the War Stable: horsemen & chariots.');
      }
    } else if (b.def.key === 'barracks') {
      act += this.actionTile('trainSoldier', '🗡️', 'Train Soldier', { gold: 60, wood: 20, food: 20 }, 'Sturdy melee infantry.');
    } else if (b.def.key === 'warStable') {
      act += this.actionTile('trainHorseman', '🐎', 'Train Horseman', { gold: 80, food: 40 }, 'Fast cavalry that flanks the enemy.');
      act += this.actionTile('trainChariot', '🛞', 'War Chariot', { gold: 150, wood: 80, food: 60 }, 'Karna’s pride — slow but mighty.');
    } else if (b.def.key === 'library' || b.def.key === 'temple') {
      for (const key of this.game.techKeys(b.def.key)) {
        const tech = this.game.techs[key];
        if (this.game.research[key]) {
          act += `<div class="techDone">✅ ${tech.icon} ${tech.name}</div>`;
        } else {
          act += this.actionTile('research_' + key, tech.icon, tech.name, tech.cost, tech.desc);
        }
      }
    }
    if (!act) {
      act = b.team === 'enemy'
        ? '<div class="ordersEmpty">Enemy structure — select warriors and right-click it to attack.</div>'
        : '<div class="ordersEmpty">This structure has no orders.</div>';
    }

    this.paint(sel, act);
  }

  private actionTile(action: string, icon: string, name: string, cost: Cost, desc: string): string {
    const label = costLabel(cost);
    const affordable = this.game.canAfford(cost);
    return `<button class="tile wide" data-action="${action}"${affordable ? '' : ' disabled'}>` +
      `<span class="tileIcon">${icon}</span>` +
      '<span class="tileText">' +
        `<span class="tileName">${name}</span>` +
        `<span class="tileCost">${label}</span>` +
      '</span>' +
      '<span class="tileTip">' +
        `<span class="tipName">${icon} ${name}</span>` +
        `<span class="tipCost">${label}</span>` +
        `<span class="tipDesc">${desc}</span>` +
        (affordable ? '' : '<span class="tipWarn">Not enough resources</span>') +
      '</span>' +
    '</button>';
  }

  showVictory(): void {
    Sfx.play('victory');
    this.el('victory').style.display = 'flex';
  }

  showDefeat(): void {
    Sfx.play('defeat');
    this.el('defeat').style.display = 'flex';
  }
}
