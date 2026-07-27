/**
 * The janapadas (kingdoms) of Bharatavarsha in the Mahabharata age.
 * Positions are rough map coordinates (720×820 viewBox) matching real
 * Indian geography; allegiance follows the "Who did your kingdom support"
 * reference map. Level 1 = Anga (Karna's seat, sworn to the Kauravas).
 *
 * To make a region playable later: set playable: true and wire a level
 * in Game.setupLevel() keyed by region id.
 */

export type Allegiance = 'kaurava' | 'pandava' | 'both' | 'neither';

export interface Region {
  id: string;
  name: string;
  x: number;      // map position (720×820 viewBox)
  y: number;
  r: number;      // blob radius
  allegiance: Allegiance;
  playable: boolean;
  lore: string;
}

export const ALLEGIANCE_COLORS: Record<Allegiance, string> = {
  kaurava: '#e2694e',
  pandava: '#6db36b',
  both: '#e8d16a',
  neither: '#7db3d9',
};

export const ALLEGIANCE_LABELS: Record<Allegiance, string> = {
  kaurava: 'Kauravas',
  pandava: 'Pandavas',
  both: 'Both',
  neither: 'Neither',
};

export const REGIONS: Region[] = [
  // ── The north-west ──
  { id: 'gandhara', name: 'Gandhara', x: 165, y: 150, r: 42, allegiance: 'kaurava', playable: false, lore: 'Home of Shakuni, master of dice.' },
  { id: 'kekaya',   name: 'Kekaya',   x: 222, y: 215, r: 38, allegiance: 'both',    playable: false, lore: 'Its princes fought on both sides.' },
  { id: 'madra',    name: 'Madra',    x: 275, y: 185, r: 36, allegiance: 'kaurava', playable: false, lore: 'King Shalya drove Karna\'s chariot.' },
  { id: 'sindhu',   name: 'Sindhu',   x: 150, y: 300, r: 40, allegiance: 'kaurava', playable: false, lore: 'Jayadratha\'s river kingdom.' },
  { id: 'pahlava',  name: 'Pahlava',  x: 80,  y: 200, r: 46, allegiance: 'kaurava', playable: false, lore: 'Far western horsemen.' },

  // ── The Gangetic heartland ──
  { id: 'kuru',     name: 'Kuru',     x: 320, y: 235, r: 44, allegiance: 'kaurava', playable: false, lore: 'Hastinapura — the throne it all began over.' },
  { id: 'panchala', name: 'Panchala', x: 372, y: 285, r: 40, allegiance: 'pandava', playable: false, lore: 'Draupadi\'s homeland, sworn to the Pandavas.' },
  { id: 'matsya',   name: 'Matsya',   x: 305, y: 330, r: 36, allegiance: 'pandava', playable: false, lore: 'Where the Pandavas hid in year thirteen.' },
  { id: 'kosala',   name: 'Kosala',   x: 425, y: 310, r: 34, allegiance: 'pandava', playable: false, lore: 'Ancient Ayodhya\'s realm.' },
  { id: 'kasi',     name: 'Kasi',     x: 435, y: 365, r: 32, allegiance: 'both',    playable: false, lore: 'The holy city on the Ganga.' },
  { id: 'magadha',  name: 'Magadha',  x: 487, y: 380, r: 34, allegiance: 'both',    playable: false, lore: 'Jarasandha\'s iron kingdom.' },
  { id: 'nepa',     name: 'Nepa',     x: 435, y: 250, r: 30, allegiance: 'neither', playable: false, lore: 'Mountain folk of the high passes.' },
  { id: 'kirata',   name: 'Kirata',   x: 500, y: 265, r: 32, allegiance: 'neither', playable: false, lore: 'Forest archers of the foothills.' },

  // ── The east (our story begins here) ──
  { id: 'anga',     name: 'ANGA',     x: 545, y: 385, r: 40, allegiance: 'kaurava', playable: true,  lore: 'Karna\'s crown — gifted by Duryodhana. The charioteer\'s son rules here.' },
  { id: 'vanga',    name: 'Vanga',    x: 590, y: 435, r: 34, allegiance: 'kaurava', playable: false, lore: 'Delta kingdom of the east.' },
  { id: 'suhma',    name: 'Suhma',    x: 605, y: 390, r: 28, allegiance: 'kaurava', playable: false, lore: 'Coastal neighbour of Anga.' },
  { id: 'sonita',   name: 'Sonita',   x: 655, y: 310, r: 34, allegiance: 'kaurava', playable: false, lore: 'Far eastern marches.' },
  { id: 'utkala',   name: 'Utkala',   x: 520, y: 470, r: 30, allegiance: 'kaurava', playable: false, lore: 'Gateway to the southern coast.' },
  { id: 'kalinga',  name: 'Kalinga',  x: 500, y: 530, r: 36, allegiance: 'kaurava', playable: false, lore: 'Fierce elephant warriors.' },

  // ── Centre & south ──
  { id: 'avanti',    name: 'Avanti',    x: 280, y: 430, r: 38, allegiance: 'pandava', playable: false, lore: 'Ujjain of the great sacrifices.' },
  { id: 'anarta',    name: 'Anarta',    x: 160, y: 420, r: 40, allegiance: 'both',    playable: false, lore: 'Krishna\'s Dwarka: he to one side, his army to the other.' },
  { id: 'vidarbha',  name: 'Vidarbha',  x: 350, y: 490, r: 38, allegiance: 'neither', playable: false, lore: 'Rukmini\'s homeland, aloof from the war.' },
  { id: 'dandaka',   name: 'Dandaka',   x: 300, y: 560, r: 36, allegiance: 'both',    playable: false, lore: 'The great southern forest.' },
  { id: 'telinga',   name: 'Telinga',   x: 400, y: 570, r: 36, allegiance: 'kaurava', playable: false, lore: 'Southern spear-lords.' },
  { id: 'andhraka',  name: 'Andhraka',  x: 390, y: 625, r: 32, allegiance: 'pandava', playable: false, lore: 'Coastal clans of the south-east.' },
  { id: 'kishkinda', name: 'Kishkinda', x: 330, y: 645, r: 32, allegiance: 'pandava', playable: false, lore: 'Land of the ancient vanara kings.' },
  { id: 'dravida',   name: 'Dravida',   x: 355, y: 705, r: 34, allegiance: 'pandava', playable: false, lore: 'Temple kingdoms of the far south.' },
  { id: 'mushika',   name: 'Mushika',   x: 300, y: 730, r: 28, allegiance: 'neither', playable: false, lore: 'Spice coast of the west.' },
  { id: 'lanka',     name: 'Lanka',     x: 370, y: 800, r: 24, allegiance: 'neither', playable: false, lore: 'The island across the strait.' },
];
