# The Hollow

A hackathon project (Hackfest '26) set in **the Hollow**: a fictional underground city seven levels
deep beneath the dead cities above. Air, light and water are metered down from the top, and things
get worse the deeper you go. The app is a civic dashboard for it: a live 3D map of every level, its
facilities, simulated sensor readings, infrastructure impact, and lung-sickness hotspots.

> All data in this project (reports, history, sensors, sickness, residents) is
> **fictional and simulated**. Nothing is measured.

## ⚠️ The only real page is the Main Map (`/`)

**All the tabs except for Map are for scratch work. The real page is the Main Map, and it stays the
only real page unless stated otherwise.**

| Tab              | Route         | Status                                                                     |
| ---------------- | ------------- | -------------------------------------------------------------------------- |
| Map              | `/`           | **The real product.** Sidebar plus 3D map                                  |
| Directions       | `/hollow`     | Scratch: an earlier map prototype with route finding and impact assessment |
| Tunnel generator | `/tunnel-gen` | Scratch, hidden from the nav: a 2D playground for the tunnel generator     |

Scratch pages are there to prototype features and try out logic. Features that prove useful get
moved into the Main Map. Don't polish the scratch pages for their own sake.

## Stack

- **SvelteKit 3 / Svelte 5** (runes), TypeScript, Vite 8
- **Bun** as the package manager and script runner
- **Tailwind CSS 4** + **shadcn-svelte** (bits-ui) components in `src/lib/components/ui`
- **three.js** for the 3D map
- Prettier + ESLint

## Getting started

```sh
bun install
bun run dev            # start the dev server
bun run check          # svelte-check / type check
bun run lint           # prettier + eslint
bun run format         # prettier --write
bun run build          # production build (adapter-auto)
```

Other scripts:

```sh
bun run bake:hollow            # regenerate src/lib/hollow/floors.json after changing the generator, levels or seed
bun scripts/validate-intel.ts  # check the fictional intel dataset against the map data
```

## Architecture

```
src/
├── routes/
│   ├── +layout.svelte          App shell: SiteNav across the top, page below (full viewport height)
│   ├── layout.css              Tailwind + shadcn theme tokens, plus the --map-* colours the 3D map reads
│   ├── +page.svelte            MAIN MAP (real page): AppSidebar + MapView, client-only (ssr = false)
│   ├── hollow/                 scratch: Directions prototype
│   └── tunnel-gen/             scratch: 2D generator playground (not in the nav)
├── lib/
│   ├── components/
│   │   ├── site-nav.svelte     Top navigation tabs
│   │   ├── home/               Main Map UI
│   │   │   ├── app-sidebar.svelte    Level picker (L1 to L7 + "all levels") and data-layer cards
│   │   │   ├── map-view.svelte       Hosts the 3D map, controls, pins, hover/selection
│   │   │   ├── place-card.svelte     Details for the selected place (sensors, impact, sickness)
│   │   │   ├── home-state.svelte.ts  Shared rune state between the sidebar and the map (level, overview, open lens)
│   │   │   └── sickness-scale.svelte, place-icon.svelte
│   │   └── ui/                 shadcn-svelte components (generated; add more with the shadcn CLI)
│   ├── map/                    Content-agnostic three.js renderer for tunnel maps
│   ├── tunnels/generate.ts     Seeded procedural tunnel/room generator (TunnelMap)
│   ├── hollow/                 The Hollow's world, data and map dressing
│   └── intel/                  Fictional report dataset, shared vocabulary and history (not wired into a page yet)
scripts/                        bake-hollow.ts, validate-intel.ts
```

### Layers, bottom to top

1. **`#lib/tunnels`: generation.** `generateTunnelMap(options)` produces a seeded grid of tiles
   (streets, rooms, gates/shafts, doors). Deterministic for a given seed.
2. **`#lib/map`: rendering.** A generic 3D renderer that knows nothing about the Hollow:
   `createMap(el)`, `addLayer(id, tunnelMap, { style })`, overlays (paths, areas), HTML markers,
   camera moves, picking (`map.on('click' | 'hover', …)`) and a frame hook. Meshes are built in a
   Web Worker (`mesher.ts` / `mesh.worker.ts`) with a main-thread fallback.
3. **`#lib/hollow`: the world.**
   - `data.ts`: the seven levels (L1 The Crown, L2 Lampline, L3 The Warrens, L4 Lowmarch, L5 The
     Sump, L6 Blackline, L7 The Furnace) with depth, population, air, light and heat; named
     facilities; the six shafts that link the levels; `HOLLOW_SEED = 2087`.
   - `world.ts`: `createHollow(seed)` builds the floors from the pre-baked `floors.json`
     (`bake.ts` holds the compact format), plus power, residents and facility placement.
   - `nav.ts`: places on a floor and route finding across floors and shafts.
   - `sensors.ts`: simulated facility readings, with status from fixed thresholds (Detect).
   - `impact.ts`: which neighborhoods and residents lose service when a facility fails (Assess).
   - `sickness.ts`: deterministic lung-sickness hotspots per habitation block.
   - `mapStyle.ts`, `theme.ts`: block heights and palettes; the map's colours come from CSS
     variables in `layout.css`, so the 3D map matches the UI theme.
   - `hollowMap.ts`: `createHollowMap` wraps `#lib/map` with Hollow features: level changes,
     the all-levels stacked view with animated transitions, routes, impact tint, outlines,
     pins and data lenses.
4. **UI.** The Main Map (`/`) puts `AppSidebar` next to `MapView`. They talk through
   `home-state.svelte.ts`: the sidebar drives navigation via the registered `mapNav`, and opening
   a data-layer card (for example "Lung sickness") turns on its lens (`SECTION_LENS`) on the map.

### Scratch-only modules

- `#lib/intel`: a fictional set of reports from 10 to 14 November 2087, sixteen weeks of history,
  and a shared vocabulary of concept codes. It is validated against the map data but no page
  uses it yet.

Pieces from these modules can move into the Main Map when they're needed there.

## Conventions

- Import from `src/lib` through `#lib/...` (package.json `imports`), with `.js` extensions on TS files.
- Everything simulated is seeded and deterministic: the same seed always gives the same map,
  readings and sickness.
- After changing the generator, `FLOOR_CONFIG`, the levels or the seed, run `bun run bake:hollow`.
