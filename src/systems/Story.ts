import * as BABYLON from '@babylonjs/core';
import { Sfx } from './Sound';
import type { Game } from '../Game';

export interface StoryChoice {
  label: string;
  result: string; // toast shown after choosing
  apply: (game: Game) => void;
}

export interface StoryEventDef {
  id: string;
  icon: string;
  title: string;
  text: string;
  choices: StoryChoice[];
}

/**
 * Story events pop up at milestones and offer a choice of bonuses —
 * the seed of the full Mahabharata campaign narrative. Level 1 follows
 * Karna of Anga: the charioteer's son who rises to king.
 *
 * To add an event: append to EVENTS with a trigger check in update(),
 * or call trigger(id) from anywhere (e.g. a building completing).
 */
const EVENTS: StoryEventDef[] = [
  {
    id: 'sutaSon',
    icon: '🏹',
    title: 'The Charioteer\'s Son',
    text: 'They call you suta-putra — the charioteer\'s boy — and turn you from the gurukul gates. But the sun blazes in your blood, and Anga awaits a king. How will you answer them?',
    choices: [
      {
        label: '⚔️ Swear the Warrior\'s Oath',
        result: 'Your hero\'s strikes burn brighter (+25% hero damage)',
        apply: (g) => { g.storyFlags.warriorOath = true; },
      },
      {
        label: '🌾 Honor your roots',
        result: 'The people of Anga rally to you (+150 food, +50 gold)',
        apply: (g) => { g.addResource('food', 150); g.addResource('gold', 50); },
      },
    ],
  },
  {
    id: 'goldenArmor',
    icon: '✨',
    title: 'The Golden Kavacha',
    text: 'You were born wearing golden armor and earrings — gifts of Surya himself. A wandering brahmin eyes them hungrily. Legends say generosity is your greatest weapon… and your doom.',
    choices: [
      {
        label: '🛡️ Keep the armor',
        result: 'The kavacha shields you (Hero +150 max HP, fully healed)',
        apply: (g) => {
          const hero = g.hero;
          if (hero) { hero.maxHp += 150; hero.hp = hero.maxHp; }
        },
      },
      {
        label: '🎁 Give freely, as Karna would',
        result: 'Your fame as Daanveer spreads (+120 gold, +80 wood)',
        apply: (g) => { g.addResource('gold', 120); g.addResource('wood', 80); },
      },
    ],
  },
  {
    id: 'omensOfWar',
    icon: '🌩️',
    title: 'Omens of War',
    text: 'Crows circle the Dark Totem. Your scouts whisper that its brutes grow bolder each day. The elders of Anga ask: do we sharpen swords, or raise walls?',
    choices: [
      {
        label: '🗡️ Strike first',
        result: 'Two veteran soldiers join your cause!',
        apply: (g) => {
          const base = g.townCenter.position;
          g.spawnSoldier(base.add(new BABYLON.Vector3(3, 0, 8)));
          g.spawnSoldier(base.add(new BABYLON.Vector3(-3, 0, 8)));
        },
      },
      {
        label: '🧱 Fortify the town',
        result: 'Town Center reinforced (+250 max HP, repaired)',
        apply: (g) => {
          g.townCenter.maxHp += 250;
          g.townCenter.hp = g.townCenter.maxHp;
        },
      },
    ],
  },
];

export class StorySystem {
  private game: Game;
  private shown = new Set<string>();
  private active: StoryEventDef | null = null;
  private clock = 0;
  private firstBuildingDone = false;

  constructor(game: Game) {
    this.game = game;
  }

  /** Called by Game when any player building finishes construction. */
  onBuildingCompleted(): void {
    this.firstBuildingDone = true;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.active) return;

    if (this.clock > 10 && !this.shown.has('sutaSon')) this.trigger('sutaSon');
    else if (this.firstBuildingDone && !this.shown.has('goldenArmor')) this.trigger('goldenArmor');
    else if (this.clock > 170 && !this.shown.has('omensOfWar')) this.trigger('omensOfWar');
  }

  trigger(id: string): void {
    if (this.active || this.shown.has(id)) return;
    const def = EVENTS.find((e) => e.id === id);
    if (!def) return;
    this.active = def;
    this.shown.add(id);
    Sfx.play('story');
    this.game.hud.showStory(def, (choiceIndex) => this.choose(choiceIndex));
  }

  private choose(index: number): void {
    if (!this.active) return;
    const choice = this.active.choices[index];
    this.active = null;
    this.game.hud.hideStory();
    choice.apply(this.game);
    this.game.toast(`📜 ${choice.result}`);
    Sfx.play('research');
  }
}
