## Project Configuration

- **Language**: TypeScript
- **Package Manager**: bun
- **Add-ons**: prettier, eslint, tailwindcss, ai-tools
- **UI**: Svelte 5 (runes) + SvelteKit 3, Tailwind 4, shadcn-svelte (bits-ui), three.js, lucide icons

## ⚠️ ALL THE TABS EXCEPT FOR MAIN MAP ARE FOR SCRATCH WORK

**The real page is the Main Map (`/`, `src/routes/+page.svelte`). It is the ONLY real page unless
the user states otherwise.**

- `/hollow` (Directions), `/hotline` (Hotline), `/tunnel-gen` (Tunnel generator) and
  `/api/hotline/*` are **scratch work** for prototyping features and logic.
- Product work goes into the Main Map (`src/lib/components/home/*`, `#lib/hollow`, `#lib/map`).
  If a feature from a scratch page is wanted, move it into the Main Map. Don't build it up on the
  scratch page.
- Don't spend effort polishing, refactoring or fixing scratch pages unless asked. Don't break the
  shared libraries they import (`#lib/hollow`, `#lib/map`, `#lib/tunnels`) without a reason.
- Don't add new top-level pages or tabs unless the user asks for them.

## Project overview

The Hollow is a fictional underground city with seven levels, L1 The Crown (top) to L7 The Furnace
(bottom), joined by six shafts. The Main Map is a civic dashboard: a sidebar (level picker and
data-layer cards) next to an interactive 3D map with facilities, simulated sensor status, impact
assessment and lung-sickness hotspots. **All data is fictional and simulated.** Keep it labelled
that way and keep it deterministic (seeded).

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
   - `simulation.ts`: the entry point for simulated data. `getHollow()` is the one shared city
     (don't call `createHollow` in pages), `simulateFloor(floor)` gives a floor's places,
     sickness, sensor status and impact, and `snapshot()` dumps everything as plain data.
     Seeds and tuning are in `simConfig.ts` (`SIM`, `streamSeed`): each simulation draws from
     its own stream of the city seed. Sensor readings pinned to the lore go on the facility in
     `data.ts` (`readings`). When a change should keep the data as it is, check that
     `snapshot()` doesn't change.
   - The models: `nav.ts` (places, `placeColor`, routes), `sensors.ts` (Detect), `impact.ts`
     (Assess), `sickness.ts`; plus `format.ts` (number/depth formats for the UI)
   - `mapStyle.ts` / `theme.ts`: palettes. All colours, including the shaft/facility/status
     colours in `data.ts` and `sensors.ts`, are CSS variables in `src/routes/layout.css`
     (`--map-*`, `--shaft-*`, `--facility-*`, `--status-*`), so change them in CSS, not in TS.
     The 3D map resolves any CSS colour with `cssHex` / `cssColor`.
   - `hollowMap.ts`: `createHollowMap` wraps `#lib/map` with level changes, the stacked
     all-levels view, impact tint, outlines, pins and data lenses. Its parts live in `scene/`
     (`transitions`, `stackPick`, `shaftColumns`, `outline`). Visuals only the scratch pages
     use are add-ons that attach on first use: `routeOverlay`, `radarOverlay`,
     `levelTintOverlay` (`scene/route.ts` etc., built on `hollowMap.hooks`).
   - `#lib/random.ts`: the shared seeded PRNG and hashes. Changing it changes every city.
4. Main Map UI, in `src/lib/components/home/`:
   - `app-sidebar.svelte` (levels + data-layer cards), `map-view.svelte` (3D map host and
     controls), `map-keys.ts` (keyboard control), `place-card.svelte` (selection details),
     `sickness-scale.svelte`, `place-icon.svelte`
   - `home-state.svelte.ts`: shared rune state. `home` (level, overview, open section),
     `registerMapNav` / `mapNav` (the sidebar drives the map), `SECTION_LENS` (an open sidebar
     card → map lens). New data layers: add the id to `LayerId`, a card (with a `content`
     snippet) to `LAYERS` in the sidebar, and a lens to `SECTION_LENS` / `mapStyle.ts`.
5. App shell: `src/routes/+layout.svelte` (`SiteNav` + full-height content). The map routes use
   `ssr = false`.

Scratch-only modules: `#lib/hotline` (call scoring, Contact/Dash agents), `#lib/server/hotline.ts`
(in-memory store + SSE), `#lib/intel` (fictional reports, vocabulary, history; not used by a page
yet).

## Conventions

- Import lib code as `#lib/...` with `.js` extensions (see `package.json` `imports`).
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
