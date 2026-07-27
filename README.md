# ⚔️ Legacy of Anga

A cute top-down base-building strategy game (Age-of-Empires-style) built with
[Babylon.js](https://www.babylonjs.com/) and TypeScript. Pastel *Station to
Station* look: soft warm lighting, chibi units, toy-diorama world.

## Running it

```bash
npm install
npm start        # dev server at http://localhost:8080
```

## How to play (Level 1)

**Goal: destroy the Dark Totem in the north-east.** It spawns brutes over
time, so build your economy and army before it overwhelms you.

| Input | Action |
|---|---|
| Left click / drag | Select units and buildings |
| Right click | Command: move · gather · build · attack |
| W A S D / Arrows | Pan camera |
| Q / E | Rotate camera |
| Mouse wheel | Zoom |
| Esc | Cancel placement / clear selection |

**The loop:** minions gather 🌲 wood, 🪨 stone, 🪙 gold, 🌾 food (build
Farms anywhere, Fishing Docks on the pond shore) → research at the
📚 Library (military/economy) and 🛕 Temple (culture: Suryapuja, Festival,
Silk Route) → upgrade to the 👑 Kingdom Age at the Town Center → train
soldiers, scouts, and at the 🐎 War Stable: horsemen and Karna's war
chariots → conquer the enemy camp. Story events pop up with choices that
grant different bonuses. Don't solo-charge with the hero: the brutes and
dark riders will eat him (verified experimentally, twice).

**Defense:** 🧱 Stone Walls physically block units (chain segments into
lines — the placement rules allow near-touching), 🚪 Gates let your own
units through but stop enemies, and 🗼 Watchtowers shoot arrows at
anything hostile in range. Enemies blocked by a wall will bash it down, so
back your walls with towers. Idle minions auto-assign themselves: they help
nearby construction first, then gather the nearest resource.

## The campaign map

On launch you get **Bharatavarsha**, the subcontinent divided into
janapadas and coloured by who each kingdom backed in the war
(🔴 Kauravas · 🟢 Pandavas · 🟡 Both · 🔵 Neither), following the
historical-allegiance reference map. **Anga** pulses gold — Karna's seat in
the east, on the Ganga. Click any other region for its lore; they unlock as
future levels. Reopen the map anytime with the 🗺️ button in the top bar.

Region data (positions, allegiance, lore, `playable`) lives in
[`src/campaign/Regions.ts`](src/campaign/Regions.ts) — add levels there.

## The land of Anga

Geography follows eastern India: the **Ganga** winds west→east across the
north with sandy banks and a wooden bridge, the **Himalayas** rise
snow-capped on the northern horizon, and pastel hills ring the horizon.
Fishing Docks work on either the river shore or the pond.

It's a lived-in world: **deer** graze and bolt when your units get close,
**bird flocks** cross the sky in V formation, **fish** leap from the pond,
and **villagers** potter around thatched-hut hamlets.

## Architecture

```
src/
  Game.ts                  economy, research, training, level setup, win/lose
  core/Input.ts            keys + pointer events (no game logic)
  core/Materials.ts        cached pastel material factory
  camera/RTSCamera.ts      top-down pan/rotate/zoom camera
  campaign/Regions.ts      janapada map data (positions, allegiance, lore)
  world/World.ts           terrain, river, lighting, scenery + LEVEL DESIGN
  world/ResourceNode.ts    trees, mines, wheat, fishing spots
  world/Wildlife.ts        deer, birds, fish, villagers (pure ambience)
  entities/Unit.ts         base: chibi body, movement, HP bar, collision, death
  entities/Minion.ts       gather/build state machine
  entities/Warrior.ts      foot / mounted / chariot combat units
  buildings/Building.ts    all structures + BUILDING_DEFS + queues
  systems/Selection.ts     click/box select, right-click commands, placement
  systems/Story.ts         choice events (the campaign narrative seed)
  systems/Effects.ts       pooled particle bursts (hits, chips, confetti)
  systems/Sound.ts         procedural WebAudio SFX (no audio files)
  ui/CampaignMap.ts        the Bharatavarsha region-select overlay
  ui/HUD.ts                DOM overlay: resources, panels, story modal
```

### Terrain gotcha worth remembering

`MeshBuilder.CreateGround` allocates **non-updatable** vertex buffers, so
`updateVerticesData()` silently never reaches the GPU — the CPU copy looks
displaced (so picking and unit heights are right) while the mesh *renders
as a flat plane*. Use `setVerticesData(kind, data, true)` plus
`refreshBoundingInfo()` instead. This masked the hills and hid the river
entirely until it was found.

Rendering uses a `DefaultRenderingPipeline`: FXAA, gentle bloom (gold
glints), mild contrast boost and a soft vignette.

Key seams for expansion:

- **New level**: edit `World.spawnLevelResources()` and `Game.setupLevel()`.
- **New building**: add an entry to `BUILDING_DEFS` + a visual branch in
  `Building.buildVisual()` + a button in the HUD.
- **New unit**: subclass `Unit` (see Minion/Warrior), spawn it in `Game`.
- **New tech**: add to `TECHS` in `Game.ts` and a modifier getter.
- **Balance**: all numbers live at the top of their files (costs, HP,
  damage, spawn timers).
- Debug from the browser console via `window.game` (e.g.
  `game.resources.gold = 9999`).
