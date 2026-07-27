import { REGIONS, Region, ALLEGIANCE_COLORS, ALLEGIANCE_LABELS } from '../campaign/Regions';
import { Sfx } from '../systems/Sound';

/**
 * The Bharatavarsha campaign map: an SVG overlay dividing the subcontinent
 * into janapadas, colored by Mahabharata allegiance. Anga pulses gold and
 * starts Level 1; other regions are teasers for future levels.
 */
export class CampaignMap {
  private el: HTMLElement;
  private began = false;

  constructor(private onBegin: () => void) {
    this.el = document.getElementById('campaignMap')!;
    this.render();
  }

  show(): void {
    this.el.style.display = 'flex';
    Sfx.play('story');
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Deterministic wobbly blob path — gives the hand-drawn look. */
  private blobPath(cx: number, cy: number, r: number, seed: number): string {
    const rand = (i: number) => {
      const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const points = 8;
    const coords: [number, number][] = [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const radius = r * (0.78 + rand(i) * 0.4);
      coords.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.85]);
    }
    let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
    for (let i = 0; i < points; i++) {
      const curr = coords[i];
      const next = coords[(i + 1) % points];
      const mx = (curr[0] + next[0]) / 2;
      const my = (curr[1] + next[1]) / 2;
      d += ` Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    return d + ' Z';
  }

  private render(): void {
    const blobs = REGIONS.map((region, i) => {
      const color = ALLEGIANCE_COLORS[region.allegiance];
      const cls = region.playable ? 'regionBlob angaPulse' : 'regionBlob';
      const fontSize = region.playable ? 17 : Math.max(10, region.r * 0.32);
      const label = region.playable ? `👑 ${region.name}` : region.name;
      return `
        <g class="regionGroup" data-id="${region.id}">
          <path class="${cls}" d="${this.blobPath(region.x, region.y, region.r, i + 1)}"
            fill="${color}" stroke="${region.playable ? '#ffd700' : 'rgba(60,40,20,0.35)'}"
            stroke-width="${region.playable ? 4 : 1.5}"></path>
          <text x="${region.x}" y="${region.y + 4}" text-anchor="middle"
            font-size="${fontSize}" font-weight="700" fill="#3b2c1e"
            style="pointer-events:none">${label}</text>
        </g>`;
    }).join('');

    // Simplified subcontinent silhouette behind the janapadas
    const india = `M 300 30 L 380 55 L 460 120 L 560 200 L 700 260 L 690 330 L 620 350
      L 640 430 L 560 520 L 500 620 L 420 730 L 360 815 L 310 760 L 270 660 L 200 540
      L 120 450 L 60 390 L 95 330 L 150 320 L 130 240 L 190 170 L 240 90 Z`;

    const legend = (Object.keys(ALLEGIANCE_COLORS) as (keyof typeof ALLEGIANCE_COLORS)[])
      .map((a) => `<span class="legendChip"><span class="legendDot" style="background:${ALLEGIANCE_COLORS[a]}"></span>${ALLEGIANCE_LABELS[a]}</span>`)
      .join('');

    this.el.innerHTML = `
      <div id="mapCard">
        <div id="mapTitle">🗺️ Bharatavarsha — Age of the Mahabharata</div>
        <div id="mapLegend">${legend}</div>
        <div id="mapScroll">
          <svg viewBox="0 0 720 840" id="mapSvg">
            <path d="${india}" fill="#cfe3b8" stroke="#9bb586" stroke-width="4" stroke-linejoin="round"></path>
            ${blobs}
          </svg>
        </div>
        <div id="mapInfo">Anga awaits its king. Choose your realm, Commander.</div>
        <div id="mapButtons">
          <button id="mapBegin" class="hudBtn storyBtn">⚔️ Begin: Anga — Land of Karna</button>
          <button id="mapClose" class="hudBtn storyBtn" style="display:none">✕ Return to Anga</button>
        </div>
      </div>`;

    this.el.querySelectorAll('.regionGroup').forEach((group) => {
      group.addEventListener('click', () => {
        const id = (group as HTMLElement).dataset.id!;
        const region = REGIONS.find((r) => r.id === id)!;
        this.onRegionClick(region);
      });
    });
    this.el.querySelector('#mapBegin')!.addEventListener('click', () => this.begin());
    this.el.querySelector('#mapClose')!.addEventListener('click', () => { Sfx.play('click'); this.hide(); });
  }

  private onRegionClick(region: Region): void {
    Sfx.play('click');
    const info = this.el.querySelector('#mapInfo')!;
    if (region.playable) {
      info.textContent = `👑 ${region.name} — ${region.lore}`;
      if (!this.began) this.begin();
      else this.hide();
      return;
    }
    const side = ALLEGIANCE_LABELS[region.allegiance];
    info.textContent = `🔒 ${region.name} (${side}) — ${region.lore} Conquer Anga first!`;
  }

  private begin(): void {
    this.began = true;
    (this.el.querySelector('#mapBegin') as HTMLElement).style.display = 'none';
    (this.el.querySelector('#mapClose') as HTMLElement).style.display = 'block';
    Sfx.play('ageUp');
    this.hide();
    this.onBegin();
  }
}
