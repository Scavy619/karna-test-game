import { Building } from '../buildings/Building';
import { BUILDING_DEFS, BuildingKey } from '../buildings/Building';
import { Minion } from '../entities/Minion';
import { Warrior } from '../entities/Warrior';
import { Sfx } from '../systems/Sound';
import type { StoryEventDef } from '../systems/Story';
import type { Selectable } from '../systems/Selection';
import type { Game, TechKey } from '../Game';

/**
 * DOM game UI: resource bar, build menu, selection panel, story modal,
 * toasts, and end screens. All buttons call straight into Game methods.
 */
export class HUD {
  private game!: Game;
  private el = (id: string) => document.getElementById(id)!;
  private refreshTimer = 0;
  private currentSelection: Selectable[] = [];
  private storyChooseCb: ((i: number) => void) | null = null;

  bind(game: Game): void {
    this.game = game;
    const buildBtns: [string, BuildingKey][] = [
      ['buildLibrary', 'library'], ['buildBarracks', 'barracks'],
      ['buildFarm', 'farm'], ['buildDock', 'fishingDock'],
      ['buildTemple', 'temple'], ['buildStable', 'warStable'],
      ['buildWall', 'wall'], ['buildGate', 'gate'], ['buildTower', 'watchtower'],
    ];
    for (const [id, key] of buildBtns) {
      this.el(id).addEventListener('click', () => { Sfx.play('click'); game.requestPlacement(key); });
    }
  }

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

    const canBuild = (key: BuildingKey) => {
      const def = BUILDING_DEFS[key];
      return this.game.canAfford(def.cost) && this.game.age >= (def.requiresAge ?? 1);
    };
    this.setDisabled('buildLibrary', !canBuild('library'));
    this.setDisabled('buildBarracks', !canBuild('barracks'));
    this.setDisabled('buildFarm', !canBuild('farm'));
    this.setDisabled('buildDock', !canBuild('fishingDock'));
    this.setDisabled('buildTemple', !canBuild('temple'));
    this.setDisabled('buildStable', !canBuild('warStable'));
    this.setDisabled('buildWall', !canBuild('wall'));
    this.setDisabled('buildGate', !canBuild('gate'));
    this.setDisabled('buildTower', !canBuild('watchtower'));
    this.el('stableLock').style.display = this.game.age >= 2 ? 'none' : 'inline';

    if (this.currentSelection.length > 0) this.renderSelection();
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

  // ── Selection panel ────────────────────────────────────────────

  showSelection(sel: Selectable[]): void {
    this.currentSelection = sel;
    this.renderSelection();
  }

  private renderSelection(): void {
    const panel = this.el('selectionPanel');
    const sel = this.currentSelection.filter((s) => s.alive);
    if (sel.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    if (sel.length === 1 && sel[0] instanceof Building) {
      this.renderBuilding(sel[0] as Building);
      return;
    }

    const minions = sel.filter((s) => s instanceof Minion) as Minion[];
    const warriors = sel.filter((s) => s instanceof Warrior) as Warrior[];
    const hero = warriors.find((w) => w.variant === 'hero');
    const parts: string[] = [];
    if (hero) parts.push('👑 Karna');
    const count = (v: string, icon: string, name: string) => {
      const n = warriors.filter((w) => w.variant === v).length;
      if (n) parts.push(`${icon} ${n} ${name}${n > 1 ? 's' : ''}`);
    };
    count('soldier', '🗡️', 'Soldier');
    count('scout', '🏃', 'Scout');
    count('horseman', '🐎', 'Horseman');
    count('chariot', '🛞', 'Chariot');
    if (minions.length) parts.push(`👶 ${minions.length} Minion${minions.length > 1 ? 's' : ''}`);

    let detail = '';
    if (sel.length === 1) {
      const u = sel[0] as Minion | Warrior;
      const status = u instanceof Minion ? u.status : (u as Warrior).status;
      detail = `<div class="hint">HP ${Math.ceil(u.hp)}/${u.maxHp} — ${status}</div>`;
    } else {
      detail = '<div class="hint">Right-click: move · gather · attack</div>';
    }
    panel.innerHTML = `<div class="selTitle">${parts.join(' · ')}</div>${detail}`;
  }

  private renderBuilding(b: Building): void {
    const panel = this.el('selectionPanel');
    let html = `<div class="selTitle">${b.def.icon} ${b.def.name}</div>`;
    html += `<div class="hint">HP ${Math.ceil(b.hp)}/${b.maxHp}</div>`;

    if (!b.completed) {
      html += `<div class="hint">🔨 Construction ${Math.floor(b.progress * 100)}% — right-click with minions to help</div>`;
      panel.innerHTML = html;
      return;
    }

    if (b.queue.length > 0) {
      const item = b.queue[0];
      const pct = Math.floor((1 - item.remaining / item.duration) * 100);
      html += `<div class="hint">⏳ ${item.label} — ${pct}%${b.queue.length > 1 ? ` (+${b.queue.length - 1} queued)` : ''}</div>`;
    }

    if (b.def.key === 'townCenter') {
      html += this.actionBtn('trainMinion', '👶 Train Minion', '40🪙 20🌾');
      html += this.actionBtn('trainScout', '🏃 Train Scout', '30🪙 10🌾');
      if (this.game.age === 1) {
        html += this.actionBtn('ageUp', '👑 Upgrade to Kingdom Age', '200🌲 100🪨 150🪙', 'Unlocks War Stable: horsemen & chariots');
      }
    } else if (b.def.key === 'barracks') {
      html += this.actionBtn('trainSoldier', '🗡️ Train Soldier', '60🪙 20🌲 20🌾');
    } else if (b.def.key === 'warStable') {
      html += this.actionBtn('trainHorseman', '🐎 Train Horseman', '80🪙 40🌾');
      html += this.actionBtn('trainChariot', '🛞 Build War Chariot', '150🪙 80🌲 60🌾', 'Karna\'s pride — slow but mighty');
    } else if (b.def.key === 'wall' || b.def.key === 'gate') {
      html += `<div class="hint">🛡️ Blocks enemy hordes${b.def.key === 'gate' ? ' — your units pass freely' : ''}. Chain segments to build a line!</div>`;
    } else if (b.def.key === 'watchtower') {
      html += '<div class="hint">🏹 Shoots arrows at enemies within range. Place along your walls!</div>';
    } else if (b.def.key === 'farm' || b.def.key === 'fishingDock') {
      const left = b.foodNode && !b.foodNode.depleted ? Math.floor(b.foodNode.amount) : 0;
      html += `<div class="hint">🌾 Food remaining: ${left} — right-click with minions to work it</div>`;
    } else if (b.def.key === 'library' || b.def.key === 'temple') {
      const label = b.def.key === 'library' ? '📖 Military & economy research:' : '🕉️ Cultural research:';
      html += `<div class="hint">${label}</div>`;
      for (const key of this.game.techKeys(b.def.key)) {
        const tech = this.game.techs[key];
        if (this.game.research[key]) {
          html += `<div class="techDone">✅ ${tech.icon} ${tech.name}</div>`;
        } else {
          html += this.actionBtn('research_' + key, `${tech.icon} ${tech.name}`, tech.costLabel, tech.desc);
        }
      }
    }
    panel.innerHTML = html;

    panel.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        Sfx.play('click');
        const action = (btn as HTMLElement).dataset.action!;
        if (action === 'trainMinion') this.game.trainMinion(b);
        else if (action === 'trainScout') this.game.trainScout(b);
        else if (action === 'trainSoldier') this.game.trainSoldier(b);
        else if (action === 'trainHorseman') this.game.trainHorseman(b);
        else if (action === 'trainChariot') this.game.trainChariot(b);
        else if (action === 'ageUp') this.game.upgradeAge(b);
        else if (action.startsWith('research_')) this.game.startResearch(b, action.slice(9) as TechKey);
      });
    });
  }

  private actionBtn(action: string, label: string, cost: string, desc = ''): string {
    const tip = desc ? `<span class="desc">${desc}</span>` : '';
    return `<button class="hudBtn" data-action="${action}">${label} <span class="cost">${cost}</span>${tip}</button>`;
  }

  private setDisabled(id: string, disabled: boolean): void {
    (this.el(id) as HTMLButtonElement).disabled = disabled;
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
