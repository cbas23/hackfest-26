## Project Configuration

- **Language**: TypeScript
- **Package Manager**: bun
- **Add-ons**: prettier, eslint, tailwindcss, ai-tools
- **UI**: Svelte 5 (runes) + SvelteKit 3, Tailwind 4, shadcn-svelte (bits-ui), three.js, lucide icons

## ⚠️ ALL THE TABS EXCEPT MAIN MAP AND CONTROL CENTER ARE FOR SCRATCH WORK

**The real pages are the Main Map (`/`, `src/routes/+page.svelte`) and the Control center
(`/control`), which edits the map's live events. Nothing else is real unless the user states otherwise.**

- `/tunnel-gen` (Tunnel generator, reachable by URL only) is **scratch work**
  for prototyping features and logic.
- Product work goes into the Main Map (`src/lib/components/home/*`, `#lib/hollow`, `#lib/map`).
  If a feature from a scratch page is wanted, move it into the Main Map. Don't build it up on the
  scratch page.
- Don't spend effort polishing, refactoring or fixing scratch pages unless asked. Don't break the
  shared libraries they import (`#lib/hollow`, `#lib/map`, `#lib/tunnels`) without a reason.
- Don't add new top-level pages or tabs unless the user asks for them.

## Project overview

The Hollow is a fictional underground city with seven levels, L1 The Crown (top) to L7 The Furnace
(bottom), joined by six shafts. The Main Map is a civic dashboard: a sidebar (home address and
data-layer cards) next to an interactive 3D map with facilities, power, water and air graded in
five steps per block, blocked tunnels, lung-sickness hotspots and notifications for the viewer's home. Nothing on
the map takes actions yet. **All data is fictional and simulated.** Keep it labelled that way.

Two kinds of data:

- **The map** (tunnels, rooms, facilities, residents) is built in the browser from `HOLLOW_SEED`.
  It never changes and stays deterministic.
- **State** lives in **Convex** (`convex/`). It changes over time, is shared by every viewer, and
  is edited from the Control center (`/control`, public for now). It is plain state, not events:
  there is no history, resolving or reopening.
  - **Points** (`kind: power | water | air`, level, tile `x`/`y`, `radius` = reach,
    optional `strength` and `note`): sources that push the blocks they reach towards bad, fading
    out to their reach. **Power and water spread along the tunnels** (walking distance to a
    block's door); **air spreads over an area** (straight-line, like the sickness hotspots).
    Each block also gets a level-wide base and seeded noise. Scores run 0 (good) to 1 (bad) in
    five steps (`CONDITION_STEPS`). The kinds are independent of each other.
  - **Blocked tunnels**: 2–5 tile stretches that can't be passed.
  - **Sickness settings**: one document of dials for the seeded lung-sickness hotspots.

## Architecture

Layers, bottom to top:

1. `#lib/tunnels/generate.ts`: seeded procedural tunnel/room generator → `TunnelMap`.
2. `#lib/map/*`: content-agnostic three.js renderer (layers, per-room styles, overlays, HTML
   markers, camera, picking, frame hook). Meshes are built in a Web Worker (`mesher.ts`,
   `mesh.worker.ts`). It must stay free of Hollow-specific concepts.
3. `#lib/hollow/*`: the world and its domain logic.
   - `data.ts`: levels, facilities, shafts, `FLOOR_CONFIG`, `HOLLOW_SEED = 2087`
   - `world.ts`: `createHollow(seed)` loads pre-baked `floors.json` (format in `bake.ts`).
     `perFloor(fn)` memoises per-floor derived data (use it instead of ad-hoc caches);
     `floorBounds` / `builtBounds` give a floor's extent.
   - `state.ts`: plain types for the shared state (no Convex imports), mirrored by
     `convex/model.ts`, plus `POINT_KINDS` / `POINT_INFO` (labels and colours per kind).
   - `simulation.ts`: the entry point for simulated data. `getHollow()` is the one shared city
     (don't call `createHollow` in pages); `currentState()` / `setState()` hold the current
     state (`#lib/live` keeps it in sync with Convex; pages that never connect get the starter
     scenario); `simulateFloor(floor)` gives a floor's places, `conditions` / `score(kind)`
     (power, water, air per block, 0 good to 1 bad), sickness and blocked tiles, cached per state
     object (replace lists, never mutate them); `pointTotals`, `sicknessTotals`,
     `blockedTotals` sum over floors; `snapshot()` dumps everything as plain data. Seeds and
     tuning are in `simConfig.ts` (`SIM`, `streamSeed`).
   - The models: `nav.ts` (places, `placeColor`, routes), `conditions.ts` (points → graded
     scores per kind; `tunnelWalk`, `conditionStep`, `CONDITION_STEPS`; tuning in
     `SIM.conditions`), `sickness.ts` (hotspots from the shared `SicknessSettings`), `notices.ts`
     (notifications for a home block from its conditions and sickness), `scenario.ts` (the
     starter scenario and tunnel-run helpers); plus `status.ts` (severity colours for
     notices) and `format.ts` (number/depth formats for the UI)
   - `mapStyle.ts` / `theme.ts`: palettes. All colours, including the shaft/facility/status
     colours in `data.ts` and `status.ts`, are CSS variables in `src/routes/layout.css`
     (`--map-*`, `--shaft-*`, `--facility-*`, `--status-*`; point kinds are
     `--map-<kind>-1` … `-5`), so change them in CSS, not in TS.
     The 3D map resolves any CSS colour with `cssHex` / `cssColor`.
   - `hollowMap.ts`: `createHollowMap` wraps `#lib/map` with level changes, the stacked
     all-levels view, outlines, pins and data lenses. Its parts live in `scene/`
     (`transitions`, `stackPick`, `shaftColumns`, `outline`). Optional visuals are add-ons
     that attach on first use: `routeOverlay` (the Main Map's directions), `radarOverlay`,
     `levelTintOverlay` (`scene/route.ts` etc., built on `hollowMap.hooks`).
   - `#lib/random.ts`: the shared seeded PRNG and hashes. Changing it changes every city.
   - `#lib/live/state.svelte.ts`: the browser's link to Convex. `connectLive()` subscribes to
     each table separately and calls `setState`; read `live.version` in `$derived` / `$effect`
     to recompute on changes; `mutate()` writes back (the Control center only).
4. Main Map UI, in `src/lib/components/home/`:
   - `app-sidebar.svelte` (home address, directions + data-layer cards: power, water, air,
     sickness, tunnels), `home-card.svelte` (home address + directions in one card) / `directions.svelte.ts` (route search
     between two places across levels; the map draws it with `routeOverlay`), `map-view.svelte` (3D map host and controls), `map-keys.ts` (keyboard control),
     `place-card.svelte` (selection details), `home-notices.svelte` (live notifications for the
     saved home: new, worse, better and cleared), `state-legend.svelte`, `sickness-scale.svelte`,
     `place-icon.svelte`
   - `home-state.svelte.ts`: shared rune state. `home` (level, overview, open section),
     `registerMapNav` / `mapNav` (the sidebar drives the map), `SECTION_LENS` (an open sidebar
     card → map lens). New data layers: add the id to `LayerId`, a card (with a `content`
     snippet) to `LAYERS` in the sidebar, and a lens to `SECTION_LENS` / `mapStyle.ts`.
5. Control center, in `src/lib/components/control/`: `floor-canvas.svelte` (2D level map; clicks
   place power, water and air points or block tunnels; hovering a tunnel kind lights up the
   tunnels it would reach), `point-panel.svelte` (one per kind: reach, strength, delete), `tunnel-panel.svelte`, `sickness-panel.svelte`, `state-row.svelte`, and
   `control-state.svelte.ts` (tool state and the mutations).
6. Convex, in `convex/`: `schema.ts` (`points`, `blockedTunnels` and the `sickness` settings
   document), `model.ts` (validators and checks), `points.ts` / `blockedTunnels.ts` (`list`,
   `add`, `update`, `remove`), `sickness.ts` (`get`, `set`) and `scenario.ts` (`load`,
   `clearMap`).
7. App shell: `src/routes/+layout.svelte` (`SiteNav`, a title-only header with no links; the Map is the default page and `/control` is reachable by URL only, + full-height content). The map routes use
   `ssr = false`.

Scratch-only modules: `#lib/intel` (fictional reports, vocabulary, history; not used by a page
yet).

## Conventions

- Import lib code as `#lib/...` and Convex code as `#convex/...` (e.g.
  `#convex/_generated/api.js`), with `.js` extensions (see `package.json` `imports`).
- Run `bun run dev:convex` next to `bun run dev`. It runs the Convex deployment, pushes
  `convex/` and regenerates `convex/_generated/`. Its URL is `PUBLIC_CONVEX_URL` in `.env.local`
  (declared in `src/env.ts`). Without it, the map runs offline on the starter scenario.
- New point kinds (another graded service): add it to `pointKind` in `convex/model.ts`, to
  `PointKind` / `POINT_INFO` (with its spread) in `state.ts`, `CONDITION_STEPS` and
  `SIM.conditions`, five `--map-<kind>-N` colours (and `Token`), a `LayerId` + sidebar card,
  and a notice in `notices.ts`. The Control center picks it up from
  `POINT_KINDS`. Other kinds of state get their own table, a type in `state.ts`, a
  subscription in `#lib/live`, a model and a Control center panel.
- Use shadcn-svelte components from `#lib/components/ui`. Add new ones with the shadcn-svelte CLI
  (see the `shadcn-svelte` skill) instead of hand-rolling them.
- After changing the generator, `FLOOR_CONFIG`, the levels or the seed, run `bun run bake:hollow`.
- After changing `#lib/intel` or facility names, run `bun scripts/validate-intel.ts`.
- Before finishing, run `bun run check` and `bun run lint`.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
