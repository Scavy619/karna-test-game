# Rise of Anga — Design & Migration Spec

Pivot of **Legacy of Anga** (working Babylon.js RTS) into a turn-based Mahabharata
grand-strategy game on a map of India, with the existing RTS retained as the in-province
real-time conquest layer.

> **Read this first if you are picking the project up on another machine.** Part 0 is the
> honest state of the code. Parts 1–5 are the design. Part 6 is an audit of whether the
> existing codebase can carry the plan. Part 7 is the build order.

---

## 0. STATE OF THE REPO

- Stack: TypeScript 5 (`strict`) → `ts-loader` → webpack 5, Babylon.js.
- Deps: `@babylonjs/core` only. **`@babylonjs/loaders` is declared but imported nowhere — remove it.**
- Scripts: `npm start` (dev server :8080), `npm run build`.
- Current game: one map (Anga), 4 resources, 9 buildable structures, 7 unit variants, 6 techs,
  2 ages, 3 story events, and an SVG map of 29 janapadas used only as level-select.
  Win condition: destroy the Dark Totem.

### Build gaps to fix early

1. **`npm run build` emits only `bundle.js` into `dist/`.** `index.html` lives in `public/`, and the
   dev server hides the split by serving `public/` statically. **`dist/` is not a runnable folder** —
   this blocks any packaging (static host, APK). Fix with `CopyWebpackPlugin`.
2. **`@babylonjs/loaders`** — unused dependency, delete it.

### File inventory

| File | What it does | Fate |
|---|---|---|
| `src/index.ts` | `new Game(); game.start()` | REPLACE — app shell |
| `src/Game.ts` (~600 ln) | Economy, techs, training, level setup, enemy spawner, win/lose, `runRenderLoop` | SPLIT → `MissionScene` |
| `src/core/Input.ts` | Keys + pointer events, `onKeyPress`, window-level `pointerup` | KEEP (add touch later) |
| `src/core/Materials.ts` | `pastel()` name-cached material factory | KEEP as-is |
| `src/camera/RTSCamera.ts` | `ArcRotateCamera`, WASD/QE/wheel, clamped | KEEP; fork for campaign map |
| `src/campaign/Regions.ts` | **29 regions** — id, name, x/y/r (720×820 viewBox), allegiance, lore | EXTEND → `Province` |
| `src/world/World.ts` (~530 ln) | Analytic `getHeight()`, carved winding Ganga, bridge, pond, hills ring, Himalayas, hamlets, `spawnLevelResources()` | KEEP + PARAMETERIZE by biome |
| `src/world/ResourceNode.ts` | Tree/mine/wheat/fish, `harvest()` | KEEP |
| `src/world/Wildlife.ts` | Deer, birds, fish, villagers (ambience) | KEEP — **make deer huntable** |
| `src/entities/Unit.ts` (~320 ln) | Chibi body, movement + terrain snap, HP bar, selection ring, `collideWithBuildings` (gates pass own team, records `blockedBy`), `applySeparation` | KEEP |
| `src/entities/Warrior.ts` (~350 ln) | 7 variants in one `VARIANTS` table, foot/mounted/chariot bodies, `findNearestFoe`, wall-bashing | KEEP + EXTEND |
| `src/entities/Minion.ts` | Worker FSM `idle→toNode→harvest→toDepot→toSite→build` | KEEP — the gather/build layer |
| `src/buildings/Building.ts` (~430 ln) | 11 `BUILDING_DEFS`, per-key visuals, construction, queues, watchtower fire, `yaw`, `chainable` | KEEP + EXTEND |
| `src/systems/Selection.ts` (~400 ln) | Click/box select, right-click commands, ghost placement, drag wall chains | KEEP |
| `src/systems/Story.ts` | 3 events `{id, icon, title, text, choices[{label, result, apply}]}` | GENERALIZE |
| `src/systems/Effects.ts` | Pooled particle bursts (`FX`) | KEEP as-is |
| `src/systems/Sound.ts` | Procedural WebAudio SFX (`Sfx`), no files | KEEP |
| `src/ui/HUD.ts` (~430 ln) | Data-driven build palette, 3-zone command bar, tooltips, hotkeys | KEEP as the MISSION HUD |
| `src/ui/CampaignMap.ts` | SVG 29 janapadas, `blobPath()`, allegiance colours | **REWRITE** (see 6.2d) |
| `public/index.html` | All CSS + DOM skeleton | EXTEND |

---

## 1. LOCKED DIRECTION

| Decision | Value |
|---|---|
| Hero | Original character, grandson of Anga's last king. Faction-neutral. Antagonists = an invented postwar warlord council |
| **Priority** | **Strategy map first.** The RTS already works; its graphics/wildlife/flora/fauna polish comes LAST |
| Army movement | **Key element.** Many detachments, sent in different directions, independently |
| **Regions** | **The existing 29 — no additions.** Borders expanded to cover all of India seamlessly |
| Campaign construction | Roads, forges, forts, granaries, ferries. **No bridges** |
| RTS focus | **Hunting · gathering · building · upgrades** to win. Chariots and magic unlocks as win-enablers |
| Capital | Champa defended; libraries + economy; its buildings **persist** into its defence mission |
| **Story** | **Structured acts, open map.** Gates are milestones and research — never "capture province X" |
| Progression spine | **Research.** Advance the trees to get ahead |
| Feel | **Tabletop.** Seamless board, legible tokens, easy maneuver |

---

## 2. THE BOARD — 29 PROVINCES COVERING ALL OF INDIA

### 2.1 Border expansion (the one algorithm that matters)

Keep every region in `Regions.ts` exactly as authored — same 29 ids, names, allegiances, lore, and
`x`/`y`. Those positions become **seed points**:

1. Simplified public-domain India coastline (low-res GeoJSON → Douglas–Peucker), **fitted into the
   existing 720×820 viewBox** so all current coordinates stay valid.
2. **Voronoi diagram** from the 29 seed points, **clipped to the coastline**.
3. 1–2 passes of **Lloyd relaxation with seeds pinned** so cells even out without drifting off the
   authored positions.
4. **Snap borders to real geography** where a cell edge falls near a real river or range — so the
   Ganga, Narmada, Vindhya crest and the Ghats become actual province borders.
5. Apply the existing `CampaignMap.blobPath()` wobble to the resulting **edges** for a hand-inked
   board-game look over accurate geometry.
6. Emit `campaign/MapData.ts`: polygons, shared-edge adjacency, edge types.

**Result: 29 seamless provinces tiling the subcontinent, derived from your own data.** No new regions,
no hand-drawing, no gaps.

### 2.2 Edge types carry the geography

With large provinces the real terrain lives on **borders**. Movement cost and legality belong to the
**edge**, not the province.

| Edge type | Effect |
|---|---|
| `plain` | Free crossing — the invasion highways |
| `river` | Costly; **fords close in monsoon** |
| `pass` | Named mountain passes; ×3 cost; **Himalayan passes closed in winter** |
| `barrier` | Vindhya–Satpura crest and Western Ghats — **impassable except at named gaps** |
| `desert` | Thar — passable but **supply attrition** |
| `forest` | Slow; ambush bonus to the defender |
| `delta` | Movement halved; **no elephants or chariots** |
| `coast` / `sea` | Naval movement only |

**Named chokepoints** (all real): Khyber Pass · Bolan Pass · Aravalli ghats (Pipli Ghat, Dewair,
Desuri) · **Narmada and Tapi corridors** through the Vindhya–Satpura barrier · **Rajmahal–Garo gap**
(the only land gate to the north-east) · **Palakkad Gap** (the only real southern breach of the Western
Ghats) · Thal Ghat and Bhor Ghat (Deccan ↔ Konkan) · the **Kurukshetra plain** into the Doab.

**The Vindhya–Satpura barrier is the board's spine.** Vindhyas run 1,200 km east–west at 300–650 m;
Satpuras 900 km, Dhupgarh 1,350 m; together they divide the Indo-Gangetic plain from the Deccan.
Crossable only at the Narmada and Tapi corridors → a free two-act geography: north, then south.

### 2.3 Physiographic reference (biome → mission terrain)

- **Gangetic alluvium** — flat, fertile, highest food, fastest movement, **no defensive bonus**
- **Ganga–Yamuna Doab** — very fertile, two river flanks, the northern prize
- **Himalayan frontier** — 1 province/turn max, seasonal passes, huge defence
- **Terai / Shivalik foothills** — forested, ambush country, Kirata archers
- **Thar desert** — fast movement, zero food, attrition
- **Aravalli** — 800 km, 400–600 m, Guru Shikhar 1,722 m, copper
- **Malwa plateau (Ujjayini)** — elevated black soil: fertile *and* defensible
- **Deccan trap plateau** — stepped basalt, dry, cavalry good, **chariots poor**
- **Western Ghats** — 1,600 km wall, avg 1,000 m, Anai Mudi 2,695 m
- **Eastern Ghats** — broken, detached, no structural unity — **porous**
- **Chota Nagpur plateau** — ~700 m, iron and the Ghatsila copper that fed Tamralipta
- **Coastal plains** — Konkan, Coromandel, Malabar: ports, naval, luxuries
- **Delta / marsh** — halved movement, no elephants, boats
- **Deep forest (Dandaka)** — slow, ambush, tribal recruitment
- **Brahmaputra valley** — isolated behind the Garo gap, impassable in monsoon

### 2.4 Strategic resources mapped onto the EXISTING lore

| Province | Existing lore | Strategic role |
|---|---|---|
| **Anga** | *"Karna's crown… the charioteer's son rules here"* | **START.** Champa river port; astride the Uttarapatha's outlet |
| **Magadha** | *"Jarasandha's iron kingdom"* | **IRON** — gates the entire military tree |
| **Kalinga** | *"Fierce elephant warriors"* | **ELEPHANTS** |
| **Pahlava** | *"Far western horsemen"* | **HORSES** |
| **Madra** | *"King Shalya drove Karna's chariot"* | Horses + chariot craft |
| **Vanga** | *"Delta kingdom of the east"* | **Tamralipta** great port; delta terrain |
| **Kasi** | *"The holy city on the Ganga"* | **FAITH** — largest Favor income |
| **Anarta** | *"Krishna's Dwarka"* | Overseas trade; Favor if held |
| **Gandhara** | *"Home of Shakuni"* | **Takshashila** research bonus; the Khyber gate |
| **Kirata** | *"Forest archers of the foothills"* | Recruitable archers; ambush terrain |
| **Kuru** | *"Hastinapura — the throne it all began over"* | **The Concord's seat** — endgame prize |
| **Avanti** | *"Ujjain of the great sacrifices"* | Malwa: fertile and defensible |
| **Nepa** | *"Mountain folk of the high passes"* | Seasonal Himalayan passes |
| **Mushika** | *"Spice coast of the west"* | **Muziris** spice; Palakkad Gap |
| **Dandaka** | *"The great southern forest"* | Tribal allies; slow movement |

The remaining fourteen (Kekaya, Sindhu, Panchala, Matsya, Kosala, Suhma, Sonita, Utkala, Vidarbha,
Telinga, Andhraka, Kishkinda, Dravida, Lanka) fill out yields, luxuries and ports.

**Iron in Magadha is the best gate on the board:** lore-accurate, adjacent to Anga, defensible, and
the whole military tree hangs off it. It gives the open map a natural early objective **without
scripting one.**

### 2.5 The Uttarapatha and the tribute caravans — THE KEYSTONE

Real route: Takshashila → Indraprastha → Kannauj → Prayaga → Varanasi → Pataliputra → **Tamralipta**
on the Bay of Bengal, reaching Bactria via the **Khyber Pass** (Bolan as the southern alternative).
The **Dakshinapatha** ran Varanasi → Prayaga → Vidisha → Ujjayini → Pratishthana.

**Its eastern terminus sits beside Anga.** The player begins astride the outlet of the greatest road
in the subcontinent.

- Roads: **×2 movement**, carry supply, +trade income.
- **The Ash Tribute physically travels the road as caravan tokens you can see and raid.** Raiding
  reclaims tribute already paid — the early-game answer for a poor province. One mechanic fuses the
  emotional premise, army maneuver, and real geography, available on turn one. **Build this early.**
- Cutting a road segment severs enemy supply beyond it.

### 2.6 Tabletop legibility

Flat fills, thick ink borders, serif city labels sized by tier, army **tokens with unit-count pips**,
terrain **icons** not textures, province **cards** on click (yields, terrain, garrison, buildings).
Click a detachment → legal destinations highlight with movement cost → click to order; multi-turn
paths queue as dotted arrows. Nothing hidden in menus.

**Populating the world:** tribute caravans on the Uttarapatha (raidable) · merchant caravans · river
boats · pilgrim columns to Varanasi and Prayaga · **refugee columns fleeing provinces where tribute
is crushing** · herds · monsoon cloud banks each year · village dots multiplying as provinces
develop · smoke over raided provinces.

---

## 3. STRATEGY LAYER

### 3.1 Army maneuver (the key mechanic)

Detachments, not one blob:

```
"Champa Vanguard"  Suryaketu  8 Inf · 4 Arch · 2 Chariot   Move 4 · Supply 9 · Morale 78
"River Column"     Vrishaka   6 Inf · 3 Boats              Move 6 (river) · Supply 5
"Hill Scouts"      —          4 Kirata Archers             Move 5 · Supply 12
```

- **Movement points** spent on edge costs; roads ×2, passes ×3, seasonal gates.
- **Split and merge freely** — a detachment is composition + commander + position.
- **Simultaneous orders, resolved on End Turn** — the tabletop cadence, and what makes sending forces
  in different directions a real decision rather than a series of individually-optimal moves.
- **Zone of Control** — a detachment projects into adjacent provinces and halts enemy movement
  entering it. Makes screening, flanking and plugging passes matter.
- **Interception** — crossing your ZoC can trigger an ambush mission where *you* are the ambusher.
- **Supply** traced from Champa along roads and friendly provinces; cut = attrition. Deep thrusts are
  genuinely risky, and cutting the enemy's road is a real strategy.

### 3.2 Campaign construction (no bridges)

| Structure | Effect |
|---|---|
| **Road** | ×2 movement, +supply range, +trade; extends the Uttarapatha network |
| **Forge (Karmashala)** | Iron → equipment upgrades; **gates advanced units** |
| **Fort / Watchtower** | Raises `fortLevel`, pre-placing walls and towers in the defence mission |
| **Granary / Well** | Supply depot extending detachment range; famine buffer |
| **Ferry / River port** | River movement and naval detachments |
| **Dharmashala** | Faith + Influence on pilgrim routes |

### 3.3 Tribute & Defiance — the emotional engine

- Every province owes **Tribute** each turn: a share of Gold, Food and Luxuries. **Base 40%** —
  deliberately punishing; the player should feel unable to build.
- **Pay** → the Concord stays passive. **Defy** (per-province toggle) → keep the income, accrue
  **Wrath** (+8/turn defiant, −5/turn paying).
- Escalation: punitive raid at 40 → a named warlord marches at 75 → coalition invasion at 120.
- **Raiding caravans** reclaims tribute already paid.
- **Liberating** a province removes it from the rolls forever (−3% global rate) and raises Concord
  Aggression — **the difficulty curve is authored by the player's own greed.**
- Civic **Tax Reform** (−10%) and the Epic capstone **Imperial Dharma Code** (abolishes the Ash
  Tribute outright) let research attack the oppression directly. This makes the civic tree the
  emotionally loaded one.

### 3.4 Turn structure — 1 turn = 1 month

1. **Income** — province yields − tribute + trade
2. **Upkeep** — supply and maintenance; shortfalls cost Morale
3. **Construction & Research** tick
4. **Orders** — build, research, recruit, **move every detachment**, diplomacy, spend Favor
5. **Simultaneous resolution** — contacts trigger missions or auto-resolve
6. **Concord & rivals act** — Wrath accrues, caravans move, events fire
7. **Season tick** — 12 turns/year, **monsoon in turns 6–8**

Seasons are strategy: monsoon floods rivers (fords close, elephants stall, naval opens), improves the
next harvest, halves movement in marsh and forest. Winter opens Himalayan passes. Summer dries fords.

### 3.5 Economy

**Primary:** Wood · Stone · **Iron** · Food · Gold
**Strategic (province-bound):** Horses · Elephants
**Abstract:** Faith → Favor · Population · Influence · Luxury Goods
**Luxuries** (Silk, Ivory, Spices, Gems, Cotton, Sandalwood, Salt) are *traded* through ports for Gold
and Influence, not consumed.

**Ports (real):** Tamralipta · Bharuch/Barygaza · Sopara · Muziris · Arikamedu · Prabhasa · Dvaraka.

### 3.6 Capital: Champa

The one province whose construction **persists**: Royal Court, **Library**, Treasury, Mint, Granary,
river port. Its campaign-built buildings **appear as real structures in its defence mission** — you
defend the city you actually built. Champa falling is a hard setback, not an instant loss.

### 3.7 Research — the progression spine

Ages: **Village → Janapada → Kingdom → Imperial Dharma → Epic** (`requiresAge` already exists on
building defs). Existing `TECHS` has the right shape — add `branch`, `age`, `requires[]`, and modifier
hooks mirroring the existing `gatherMult` / `foodMult` / `damageMult` / `hpMult` getters.

**ECONOMY** — Agriculture (+10% food) · Foraging (food from forest) · Woodcraft · Stone Cutting · Crop
Rotation (+20%, farms don't deplete) · Rice Farming (+35% wet) · Fishing Nets · Ox Ploughs ·
**Iron Smelting (unlocks Iron)** · Guild Markets · Canal Irrigation (+25% dry) · Royal Granaries
(+2 supply) · River Trade · Elephant Labor (+30% build speed) · Silk Roads · Jewelry Crafting · Spice
Trade · Salt Trade · Sacred Wells · Deep Mining · Royal Mint · Ocean Fleets ·
**Wonder: Great Granary of Champa**

**MILITARY** — Sword Forging · Wooden Shields · **Hunting Bows (Archers)** · Militia Drill · Composite
Bows (+25% range) · **Steel Spears (Spearmen — anti-cavalry/elephant)** · Heavy Shields (phalanx) ·
**Horse Breeding (Horsemen)** · Battle Drums · **Royal Chariots** · **Elephant Armor (War Elephants)** ·
Siege Towers · Veteran Training · Fortress Engineering · Commander Schools · Sacred Formations
(Crescent/Wheel/Eagle) · Armoured Cavalry · Naval Warfare · Legendary Arsenal · **Divine Chariot**

**CIVIC** — Royal Decree (+1 build slot) · Village Councils · **Tax Reform (tribute −10%)** · Justice
System · **Road Networks (+25% movement, +2 supply)** · Messenger Posts · Royal Census · **Diplomacy
(alliances)** · Embassies (vassalage) · Temple Administration · Education · Public Festivals ·
Provincial Governors · Universities · **Imperial Dharma Code (abolishes the Ash Tribute)** ·
**Wonder: Great Library of Takshashila**

**DIVINE** — Meditation · Fire Altar · Vedic Rituals · Fire Sacrifice (Food → Favor) · Sacred Groves ·
**Surya Worship (Surya path)** · Sacred Mantras (−20% blessing cost) · Pilgrimage · **Astravidya
(first-tier Astras)** · Divine Blessing · Temple Complexes · Heavenly Weapons · **Brahmavidya
(Brahmastra, requires Dharma ≥ 70)** · **Wonder: Sun Temple of Champa**

**Divine paths** (parallel, Faith-fuelled): **Surya** (fire, leadership, golden armour, solar arrow) ·
**Indra** (storm, thunder, rain) · **Shiva** (destruction, fear, war dance — Glory-aligned) ·
**Vishnu** (protection, healing, prosperity — Dharma-aligned) · minor: Agni (burn farms), Varuna
(flood rivers), Vayu (movement).

**Ship ~8 per branch first, then widen.** The full ~75 are the target, not the first build.

### 3.8 Dharma vs Glory

Two independent axes 0–100; both rise, you cannot max both.

- **Dharma** — mercy, protecting villages, honouring oaths, sparing the routed. Unlocks Krishna's
  blessings, Vishnu/Vayu paths, enemy provinces defecting, Brahmastra. Costs: slower military snowball.
- **Glory** — conquest, spectacle, executions, extracting tribute from others. Unlocks cheaper elites,
  Fear mechanics, Shiva path, terror-compliance. Costs: Favor decays, astras refuse you.

**Four endings by quadrant:** *Dharmaraja of the East* (high D, low G) · *The Sun's Heir* (high both —
hardest) · *The Ash King* (low D, high G) · *Anga Endures* (low both). **Show both deltas in the choice
UI before the player commits.**

### 3.9 Krishna

A **Divine Advisor** — never a combat unit, never recruitable. Appears in story events, as a voice
mid-mission, and at act breaks.

**Favor (Kripa)** — from Dharma acts, temples, festivals, pilgrimage. Decays if Glory badly outpaces
Dharma.

| Blessing | Effect | Favor |
|---|---|---|
| Sudarshan Vision | Reveal the whole map, 3 turns | 30 |
| Time of Dharma | All armies heal 15%/turn, 3 turns | 40 |
| Voice of Krishna | Enemy morale −25% next mission | 35 |
| Divine Guidance | Current research completes instantly | 60 |
| Unbroken Wheel | A dead hero returns at 1 HP | 100 |

**THE COMPASSION TRIGGER (the emotional payload — tune generously).** When the player loses a
province, loses a hero, or drops below a resource floor, Krishna's next event fires **early** and
grants a gift **deliberately overpowered for that moment**, framed as affection rather than reward.
**Gifts arrive when you are losing, not winning.**

### 3.10 Astras (fired inside missions)

Each needs a story unlock + Favor + turn cooldown + Dharma cost for the cruel ones.

| Astra | Effect | Favor | CD | Dharma |
|---|---|---|---|---|
| Agneyastra | Burning zone, DoT, ignites farms/siege | 40 | 5 | −5 |
| Varunastra | Floods an area; halts elephants and chariots | 40 | 5 | 0 |
| Vayavyastra | Knockback shockwave, scatters formations | 35 | 4 | 0 |
| Nagastra | Serpents root and poison a stack | 50 | 6 | −8 |
| Indrastra | Lightning storm over a radius | 60 | 7 | −5 |
| **Brahmastra** | Annihilates a huge radius; **salts the land — province yields −50% permanently** | 150 | **once per campaign** | −25 |

**Brahmastra is a story moment, not a tool.** Gate on Dharma ≥ 70, make the scar permanent and visible
on the map forever, and have Krishna beg the player not to use it. The best version of this game is
one where most players never fire it.

---

## 4. STORY — STRUCTURED ACTS, OPEN MAP

### 4.1 Premise

The Great War is over. Kurukshetra is a field of ash.

The victors did not build a golden age. The warlords who survived — men who once ate at the fire of
Anga's last crowned king, who called him brother, who owed him their lives — divided Bharatavarsha
among themselves. Their power is unmatched, so it is unchecked. They call it the **Ash Tribute**: a
levy on every surviving province, set high enough that the east starves to gild the west.

Anga pays most. Anga was loyal.

The hero is the **grandson of Anga's last true king** — a boy who grew up hearing his grandfather
called the Sun's son by the old and a charioteer's get by the new. He inherits an empty granary, a
court that fled, and a people who have learned to expect nothing from destiny. He inherits one thing
the Concord did not count: **Krishna remembers.**

> **The grandfather is never named in dialogue** — only titled ("the Sun's son", "the last crowned
> king"). Players who know the epic will read Karna into him; the game never asserts it. This keeps
> the story faction-neutral and free of canon conflict.

Proposed hero name: **Suryaketu** (sun-banner). Alternates: Vrisha, Angada of Champa. Anga's
historical capital is **Champa** — use it as the player's seat.

**Emotional spine, three beats repeated at every scale:**
**Humiliation** (the tribute arrives; you cannot pay; something is taken) → **Defiance** (you refuse,
and it costs you) → **Love** (Krishna appears, not with an army but with affection, and gives you
something the Concord cannot match).

### 4.2 The four acts — gated on milestones and research, NEVER on provinces

| Act | Opens when | Situation | Closes when |
|---|---|---|---|
| **I — The Empty Granary** | Turn 1 | The first Ash Tribute arrives and you cannot pay. Learn economy, workers, the tribute choice | You first **Defy**, or first raid a caravan |
| **II — Iron and the Road** | Act I closes | Build a power base. The Concord notices. Caravan war along the Uttarapatha | **Iron Smelting** researched **and** 4+ provinces held |
| **III — The Messenger** | Act II closes | **Krishna arrives in person** and offers peace. A genuine branch — accept (short Dharma path) or refuse (the long war) | Player answers Krishna |
| **IV — The Ash Field** | Act III closes | The Concord coalesces. Warlords march. Hastinapura at the end | Kuru taken, or the diplomatic victory resolves |

**Nothing names a required province except Kuru at the very end.** Iron is *required* but Magadha is
not *scripted* — you need iron from somewhere, and Magadha is simply the obvious source. **That is the
pattern for every gate: make the world require something, don't tell the player where to go.**

### 4.3 Events react to the player's route

Track a few flags and pick event text variants from them:

- **Direction of expansion** — north (Ganga/Doab) · east (delta/ports) · south (across the Vindhyas) ·
  west (desert/horses)
- **Tribute posture** — mostly paying (the Concord complacent, your people desperate) vs mostly
  defying (the Concord furious, your people proud)
- **Mercy record** — spared or slaughtered garrisons; drives Kritavega's redemption arc
- **Faith vs iron** — temple-heavy or forge-heavy play changes who addresses you

Same act structure, different story depending on what the player actually did. Cheap to build (variant
text keyed on flags) and it makes an open map feel authored.

### 4.4 Recurring pressure events (fire from system state, always)

The annual tribute assessment (rate rises with Aggression) · a caravan sighted on the road · famine in
a defiant province · a warlord's demand or insult · a province petitioning to defect to you at high
Dharma · Rakshasa incursions from the Dark Totem (**reuse the existing `enemyTotem` and
brute/darkRider as-is**) · a hero's personal quest · monsoon flood or failed harvest.

### 4.5 The Ash Concord (invented antagonists — killable, turnable, forgivable)

| Warlord | Bloc | Trait | Tie to the grandfather |
|---|---|---|---|
| **Ugrasena the Unpaid** | Kuru heartland | Greed — keeps raising the tribute | Held his banner at the war's end |
| **Rukmavarma** | Madra / Sindhu | Pride — duels heroes personally | Trained beside him; better swordsman, lesser man |
| **Somadatta the Cold** | Panchala / Matsya | Calculation — buys your vassals | Wrote the Ash Tribute law |
| **Bhurishrava's heir** | Gandhara / Pahlava | Zealotry — burns temples | Believes the grandfather damned them all |
| **Kritavega** | Avanti / Anarta | Honour — **redeemable at high Dharma** | Owes the grandfather his life, and knows it |

Kritavega turning is the proof that mercy is mechanically strong, not just flavour.

### 4.6 Heroes & RPG layer

Level · equipment slots · traits · skill tree · Dharma/Glory alignment · relationships · legendary
weapon · titles (*Defender of Anga*, *Lord of the Eastern Marches*) · personal quests.

Legendary commanders appear in Act IV as opponents or recruitable allies: Bhishma, Drona, Arjuna,
Bhima, Nakula, Sahadeva, Ashwatthama, Shalya, Kripa, Duryodhana, Abhimanyu. **Krishna is never
recruitable.**

**Permadeath with one mercy:** heroes can die; *Unbroken Wheel* (100 Favor) is the only escape hatch —
enough to make death land without being unrecoverable.

### 4.7 Army stacks

```
Stack "Army of Champa" | Commander Suryaketu (Lv 7)
20 Infantry · 10 Archers · 5 Horsemen · 3 Elephants · 2 Chariots
Morale 78 | Supply 12 turns | Food 340 | XP 2,150 | Formation: Crescent
```

**Morale** falls on defeat, unpaid upkeep, distance from home; below 30 a stack routs in missions and
can desert on the map. **Supply** drains outside friendly territory; at zero the stack takes attrition
(roads and granaries extend it). **Formation** sets the mission starting layout. **XP** promotes unit
tiers; survivors carry it.

---

## 5. MISSION LAYER (existing engine; polished LAST)

**Focus: hunting · gathering · building · upgrades — not pure combat.**

Shape: land your detachment → found a forward camp → **hunt wildlife for food** and gather
wood/stone/iron → build economy and walls → capture power-up shrines → complete objectives → extract.

**Target 10–15 minutes.** Costs 1–3 campaign turns. **Objective-based, not annihilation.**
**Auto-resolve for lopsided odds is essential** — 29 missions × 15 min is a lot. Treat the real-time
layer as a reward the player *chooses*, not a toll they pay 29 times.

**Hunting is a real reuse win:** `Wildlife.ts` already spawns deer that flee when units approach. Make
them huntable and food comes from the living world instead of only from farms — exactly the requested
emphasis, for very little code.

**Upgrades carry in from the campaign:** researched techs, unlocked units, forged equipment, chariots
and magic all apply at mission start. Research on the map → an easier war in the field.

**Power-up sites** (all expressible with existing `Building` / `ResourceNode` patterns):

| Site | Reward |
|---|---|
| Sacred Shrine | +1 Astra charge (**persists** to campaign) |
| Ancient Ashram | A sage's blessing for the rest of the mission |
| Relic Site | Hero equipment drop (**persists**) |
| Soma Spring | Units regenerate nearby |
| Fire Altar | Faith income during the mission |
| Naga Well | Poison weapons upgrade |
| **Cursed Totem** | Spawns monsters until destroyed; large reward — **already exists as `enemyTotem`** |

**Terrain from province biome:** elephants can't cross deep rivers · archers gain range on hills ·
chariots rule plains and die in forest and marsh · monsoon mud disables chariots · `fortLevel`
pre-places walls via **`planChain()`** from the wall-drag work.

**Mission types** (rotate; do not ship one template 29 times): conquest · siege · defence (the existing
Dark Totem wave loop) · **caravan raid** · ambush (from interception) · liberation · monster hunt ·
escort.

**Polish last:** graphics enhancement, richer in-map objects, wildlife, flora and fauna.

---

## 6. WILL THE CODE HOLD?

Audit of all 20 source files. **Short answer: the mission half holds up well; the campaign half needs
two things the codebase has none of — serializable state and scene teardown.** Neither is hard, but
both must be decided *before* code is written on top.

### 6.1 What holds up

- **The data-table pattern.** `BUILDING_DEFS`, `VARIANTS`, `TECHS`, `REGIONS` are `Record<Key, Def>`
  tables with balance numbers at file tops. Adding ~30 buildings, ~10 unit types and ~75 techs is
  adding rows and fields. Best thing about the codebase; it scales.
- **`World.getHeight()` as one source of truth** for terrain, with modular scenery builders.
  Parameterizing by biome is the change they're shaped for.
- **`Damageable` interface** shared by units and buildings — a clean seam already doing real work.
- **`pastel()` material cache** keyed by name — hundreds of meshes, a handful of materials.
- **`Story.ts` event shape** generalizes to the act system **additively**: add `conditions`,
  `dharmaDelta`, `gloryDelta`, `variants`.
- **`strict: true`** — integration errors surface at compile time. Matters enormously on a refactor
  this size.
- **Zero external assets.** Everything procedural. No art pipeline to feed, which is what makes a
  project this ambitious conceivable at all.

### 6.2 What will NOT hold

**(a) Nothing is serializable — and the campaign is a save file.** Every entity holds live Babylon
references (`Unit.root: TransformNode`, `Building.root`, `ResourceNode.root`); there is no `toJSON`
anywhere.
> **RULE: `CampaignState` must be pure data with ZERO Babylon imports.** The mission layer may hold
> Babylon objects; the campaign layer never may. Get this wrong and saves are impossible to retrofit.
> **Version the format from the first commit.**

**(b) `Game` is a god object and a de-facto singleton.** `window.game` assigned in the constructor;
every entity's `update(dt, game: Game)` takes the whole Game; `FX.init(scene)` and `Sfx.init()` are
module-level singletons; one `DefaultRenderingPipeline` in the constructor. A campaign layer cannot
coexist with this. **Fix:** a narrow `MissionContext` interface (resources, toast, nodes, buildings,
enemies, multipliers) that entities depend on instead of `Game`. Mechanical, low-risk, and it makes
the later split trivial.

**(c) There is no teardown.** `engine.runRenderLoop()` is started in `Game.start()` and never stopped;
nothing disposes the scene, pipeline, FX particle systems, or shadow generator. **Fix:**
`engine.stopRenderLoop()`, `scene.dispose()`, `FX.dispose()` / scene-scoped FX.
**Test: open and dispose two missions in one page load.**

**(d) `CampaignMap.ts` needs rewriting, not extending.** It builds its whole UI with `innerHTML`
string concatenation and re-renders wholesale — unworkable for an interactive board with army tokens,
hover states, drag-to-path and per-turn updates. Keep `blobPath()` and the allegiance palette; replace
rendering with managed SVG elements (or a canvas token layer over an SVG base). **Budget a real
rewrite of one file.**

**(e) `Regions.ts` coordinates are SVG viewBox units (720×820), not geographic.** Decide once: **fit
the coastline into the existing viewBox** (recommended — keeps all 29 authored positions valid).

**(f) Level setup is hardcoded.** `Game.setupLevel()` has literal positions (`basePos = (-55,0,-55)`,
`enemyCampPos = (60,0,60)`), a hardcoded 4-minion start, fixed enemy counts. Parameterize off
`MissionSetup` at the same time as the split.

**(g) `Game.onBuildingCompleted()` special-cases farm and dock inline.** With ~30 buildings that
switch becomes unmanageable. **Fix:** an optional `onComplete?` hook on `BuildingDef` so behaviour
lives beside the data.

**(h) O(n²) loops will bite.** `Game.start()` runs `applySeparation(allUnits)` per unit per frame;
each `Warrior.findNearestFoe()` scans all enemies plus all buildings. Fine at ~20 units, noticeable at
40–60. Fix when it hurts with a uniform spatial grid — but know it now so mission sizes are chosen
deliberately.

**(i) Bundle is already 5.22 MB.** Adding a campaign layer without code-splitting roughly doubles it.
**The campaign layer should not pull in Babylon at all.**

### 6.3 Verdict

Nothing warrants a rewrite. (a) and (b) are the load-bearing fixes and both are **additive** refactors.
(d) is one file's rewrite. Everything else is mechanical or deferrable.

> **Strongest structural fact: you can build the entire strategy layer without touching `Game.ts` at
> all, as long as missions auto-resolve at first.** The campaign becomes playable *before* the riskiest
> refactor is attempted — and if the campaign isn't fun, you learn it cheaply.

---

## 7. BUILD ORDER

**Phase 0 — Stabilize.** Runtime-verify the HUD + wall work in a browser. Add `CopyWebpackPlugin` so
`dist/` runs standalone. Drop `@babylonjs/loaders`. Commit and tag the last known-good pure-RTS build.

**Phase 1 — The board.** Map-generation script: coastline fitted to the 720×820 viewBox → Voronoi from
the 29 existing seeds → pinned Lloyd relaxation → snap edges to rivers and ranges → emit
`campaign/MapData.ts` with polygons, **shared-edge adjacency and edge types**. Extend `Region` →
`Province`. Rewrite `CampaignMap.ts` → `ui/CampaignScreen.ts` with managed SVG.
*Milestone: a legible seamless board of India; click any province, read its card.*

**Phase 2 — Maneuver.** `Detachment`; movement points and edge costs; split/merge; simultaneous orders
resolved on End Turn; Zone of Control; interception; supply along roads; season gates.
*Milestone: three detachments in three directions, one intercepted.*

**Phase 3 — Turn engine & economy.** `CampaignState` (**pure data, versioned, no Babylon imports**),
`TurnEngine`, income/upkeep, **Tribute & Defiance**, caravans on the Uttarapatha, research trees, Wrath
and Concord AI. Missions **auto-resolve**.
*Milestone: 20 turns of pay-or-defy, caravan raids and research **with no 3D at all**. If that isn't
tense on its own, the design needs fixing — cheapest possible place to find out.*

**Phase 4 — Campaign construction.** Roads, forges, forts (→ `fortLevel`), granaries, ferries.

**Phase 5 — Wire the RTS in.** Introduce `MissionContext`; split `Game` → `MissionScene`
(`MissionSetup` in, `MissionResult` out); add real teardown; parameterize `setupLevel()`; move
building-completion behaviour to per-def hooks. Biome → `World` params; `fortLevel` → `planChain()`
fort perimeters; detachment → `Warrior`s via `VARIANTS`; result → casualties, XP, relics.
*Milestone: take a province by actually playing it, then see the board update.*

**Phase 6 — Story.** Generalize `Story.ts`: conditions, act gating on milestones/research, route-flag
variants, Dharma/Glory deltas, persistence, the Krishna compassion trigger. Author Acts I–II.

**Phase 7 — Mission polish.** Hunting, wildlife, flora and fauna, graphics, richer in-map objects,
mission-type variety, astra VFX.

**Phase 8 — Optional mobile (APK).** Viable via Capacitor (static bundle, zero network deps; 5.22 MB
is fine inside an APK). **But packaging is the easy half:** there is **zero touch handling** and
**every command is right-click** (`e.button === 2`), camera is WASD/QE/wheel only, and hover tooltips
(where all costs live) don't exist on touch. Order: fix `dist/index.html` → touch input layer
(long-press or confirm-tap commands, one-finger pan, pinch zoom, two-finger rotate, tap tooltips) →
HUD mobile pass → profile render cost (2048 shadow map, bloom, 140×140 terrain, hundreds of
un-instanced meshes) → Capacitor.

### The bridge contract (write in Phase 1, use in Phase 5)

```ts
interface MissionSetup {
  provinceId: string;
  biome: Biome;                         // → World terrain params
  season: Season;                       // → monsoon flooding, mud
  type: MissionType;                    // conquest | siege | defence | caravanRaid
                                        //   | ambush | liberation | hunt | escort
  attacker: Detachment;
  defender: Detachment;
  fortLevel: 0 | 1 | 2 | 3;             // → pre-placed walls via planChain()
  persistentBuildings?: BuildingKey[];  // capital defence: the city you actually built
  objectives: MissionObjective[];
  powerUpSites: PowerUpSite[];
  unlockedUnits: UnitKey[];             // from campaign research
  unlockedUpgrades: TechKey[];
  availableAstras: AstraKey[];
  timeLimitSeconds?: number;
}

interface MissionResult {
  outcome: 'victory' | 'defeat' | 'withdraw';
  survivors: UnitCount;                 // → campaign absorbs casualties
  experienceGained: number;
  heroesLost: HeroId[];
  powerUpsClaimed: PowerUpKey[];        // astra charges, relics — persist
  relicsFound: ItemId[];
  dharmaDelta: number;                  // spared the routed? slaughtered them?
  gloryDelta: number;
  provinceCaptured: boolean;
  turnsConsumed: number;
}
```

### Target architecture

```
index.ts — app shell (screen router: campaign ⇄ mission)
  campaign/CampaignState.ts   PERSISTENT, SERIALIZABLE, NO BABYLON — the save file
  campaign/TurnEngine.ts      income → upkeep → build → orders → resolution → AI → season
  campaign/MapData.ts         GENERATED: coastline, rivers, 29 polygons, adjacency, edges
  campaign/AIKingdom.ts       Concord warlords + rival kingdoms
  ui/CampaignScreen.ts        the board (grown from CampaignMap.ts, managed SVG)
  mission/MissionScene.ts     what Game.ts becomes: ONE mission, then dispose()
```

### Reuse map — do not rebuild

`World.ts` generators · `Unit.ts` (`buildChibi`, `stepMovement`, `collideWithBuildings`,
`applySeparation`) · `Warrior.ts` `VARIANTS` + `findNearestFoe` + wall-bashing via `blockedBy` ·
`Minion.ts` FSM · **`Wildlife.ts` deer → huntable** · `Building.ts` defs, queues, watchtower fire ·
**`Game.planChain()`/`placeChain()`** for fort perimeters · `Selection.ts` · `CampaignMap.blobPath()`
and the allegiance palette · **`Regions.ts` all 29** · `enemyTotem` as the "destroy this" objective ·
`HUD.ts` tiles and the `.tileTip` tooltip pattern · `Materials.pastel()` · `Effects.FX` · `Sound.Sfx` ·
`Story.ts` choice framework.

---

## 8. UI

**Chronicle of Bharata** — an encyclopedia of every unit, building, tech, resource, hero, province and
astra, with lore *and* gameplay effect; entries auto-unlock as encountered.

**Rich hover tooltips** on any building: name + historical description · HP + construction progress ·
production or military function · garrison + queue · upkeep, maintenance, adjacency bonuses ·
available upgrades · techs required for future improvements. *(Extend the `.tileTip` pattern already
in `HUD.ts` — it renders name/cost/desc/warn/hotkey rows.)*

**Panels:** Economy overview (income / expenses / trade balance) · Province management · Diplomacy &
alliances · Research tree · Army roster & hero management · Event log & story journal · Quest tracker ·
Mini-map filters (resources, trade, armies, terrain).

---

## 9. VERIFICATION

| Phase | Check |
|---|---|
| 0 | Dev server up; every build tile, tooltip, `1`–`9` hotkey, a `Shift` wall drag; then `npm run build` and serve `dist/` **alone** |
| 1 | **Assert the 29 polygons tile the coastline with no gaps or overlaps**; adjacency graph fully connected; every named chokepoint edge has the right type |
| 2 | Three detachments, three directions, one interception; assert supply-cut attrition and that winter closes the Himalayan passes |
| 3 | 20 turns headless — tribute arithmetic, Wrath thresholds, caravan payouts, sustained defiance produces a raid then a warlord. **This suite must run with no Babylon import** |
| 5 | Open and dispose two missions in one page load with no leaks; end-to-end province capture updating `CampaignState` |

---

## 10. DESIGN PRINCIPLES TO HOLD

1. **`CampaignState` never imports Babylon.** Non-negotiable — it keeps saves, headless testing and
   the auto-resolve-first build order all possible, and it is very hard to reintroduce later.
2. **More provinces are cheap; more bespoke content is not.** Missions generate from biome + garrison
   + fortLevel. Only the Great Cities get hand-tuned maps.
3. **Make the world require something; don't tell the player where to go.**
4. **Krishna's gifts arrive when the player is losing.**
5. **All balance numbers stay in tables at file tops** (the existing convention).
6. **Ship ~8 techs per branch, then widen.**
7. **Auto-resolve must be genuinely good.** The real-time layer is a reward the player chooses, not a
   toll paid 29 times.

---

## 11. OPEN QUESTIONS

1. Hero's name — proposed **Suryaketu**; alternates Vrisha, Angada of Champa.
2. Can the campaign be *lost*, or only set back when Champa falls?
3. Does accepting Krishna's peace in Act III end the game early, or open a distinct diplomacy-victory
   branch?
4. Simultaneous resolution (recommended, tabletop) or sequential IGOUGO turns?

---

## 12. SOURCES (geography grounding)

- [Janapadas — Wikipedia](https://en.wikipedia.org/wiki/Janapadas)
- [List of the Mahabharata tribes — Wikipedia](https://en.wikipedia.org/wiki/List_of_the_Mahabharata_tribes)
- [Hills of Peninsular India — PMF IAS](https://www.pmfias.com/hills-of-peninsular-india-aravalis-vindhyas-satpuras-western-ghats-sahyadris-eastern-ghats/)
- [Vindhya Range — Wikipedia](https://en.wikipedia.org/wiki/Vindhya_Range)
- [Physical Features — Know India](https://knowindia.india.gov.in/profile/physical-features.php)
- [Chota Nagpur Plateau — Wikipedia](https://en.wikipedia.org/wiki/Chota_Nagpur_Plateau)
- [Thar Desert — Britannica](https://www.britannica.com/place/Thar-Desert)
- [Uttarapath and Dakshinapath — Swarajya](https://swarajyamag.com/culture/uttarapath-and-dakshinapath-the-great-trade-routes-of-jambudwipa)
- [Grand Trunk Road — Wikipedia](https://en.wikipedia.org/wiki/Grand_Trunk_Road)
- [Tamralipti: The Ancient Copper Port — Live History India](https://www.livehistoryindia.com/story/lost-cities/tamralipti-the-ancient-copper-port)
- [Ancient and Medieval Ports of India — StudyIQ](https://www.studyiq.com/articles/list-of-ancient-and-medieval-ports-of-india/)
