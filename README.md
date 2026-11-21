<p align="center">
  <img src="src/lib/assets/favicon.svg" alt="Hollow Guard Map icon" width="120" />
</p>

<h1 align="center">Hollow Guard Map</h1>

<p align="center">
  <strong>A live, shared 3D map of the Hollow that shows every resident what is really happening where they live, and how to get somewhere safer.</strong>
</p>

<p align="center">
  <a href="https://hollow-guard-map.cbas.workers.dev"><strong>Live demo → hollow-guard-map.cbas.workers.dev</strong></a>
</p>

<p align="center">
  Built for Hackfest '26 · SvelteKit · Svelte 5 · three.js · Convex · AI SDK · Cloudflare Workers
</p>

> **All data in this project is fictional and simulated.** The city, its residents, its sensors and
> its outbreaks are generated. Nothing is measured.


## The problem we picked

The prompt listed many problems. Most of them share one cause: **nobody in the Hollow can see the
whole picture.** Information comes from the Directorate, it arrives late or not at all, and it
doesn't match what's happening on the street. A resident on L5 can't tell whether the brownout in
their block is local or level-wide, whether their tap water is the reason their kid is coughing,
or whether the tunnel to the clinic is still open.

So instead of one narrow tool, we built the layer the others would sit on: **one shared map of the
city's real condition, kept up to date by the people living in it.** That one map helps with
several of the prompt's problems at once:

| Problem from the prompt                                         | What Hollow Guard Map does                                                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blackouts and air cuts hit without warning**                  | Save your home block and get live notices the moment its power or air gets worse, better or clears, with severity (warning, high, critical).                                                        |
| **Bad water from failing recyclers**                            | A water layer grades every block in five steps. Water faults spread _along the pipes and tunnels_, so the map shows which blocks a broken recycler actually reaches.                                |
| **Lung sickness, and numbers that don't match**                 | A lung-sickness layer built from outbreak points and per-block health reports. Residents report what they see, so the map reflects the street, not the official count.                              |
| **Flooded or collapsed tunnels cutting off neighborhoods**      | Blocked tunnel stretches are drawn on the map, and directions route around them across levels and shafts.                                                                                           |
| **The deep levels always lose, and no one can see it**          | Every level is graded the same way, side by side in a stacked 3D view, so the gap between the Crown and the Furnace is visible to everyone instead of hidden in a report.                           |
| **Getting care or getting out when your block turns dangerous** | **Get to safety**: one button finds the quickest walk to the nearest block where power, water and air all read fair or better and sickness is low, avoiding blocked tunnels and permit-only shafts. |
| **The Directorate controls information**                        | Anyone can send a plain-language report ("the lights have been out on our corridor since last night"). An AI agent turns it into map updates that every viewer sees right away.                |

## What it does

### The Main Map (`/`)

The product. A sidebar next to an interactive 3D map of all seven levels.

- **3D map of the city.** Seven procedurally generated levels, from **L1 The Crown** (80 m down,
  90 M people) to **L7 The Furnace**, joined by six shafts, some open, some restricted, one sealed
  and one that isn't on any official map. Pan, rotate and zoom, step between levels, or open the
  stacked **all-levels** view to see the whole Hollow at once.
- **Your block.** Set your home address and the sidebar shows a safety verdict plus a small chart
  of your four readings: power, water, air and lung sickness.
- **Live notices.** Alerts for your home that show up as new, worse, better or cleared as the
  shared state changes.
- **Data layers.** Open a card in the sidebar (Power, Water, Air, Lung sickness, Tunnels) and the
  map switches to that lens, coloring every block from good to bad in five steps.
- **Directions.** Search for any two places and get a walking route across levels and shafts that
  steers around blocked tunnels.
- **Get to safety.** An escape route to the nearest safe block, with a heads-up display on the map
  until you arrive.
- **Report something.** A free-text report goes to an AI agent that reads it next to the current
  state of the city, works out where it's about (your home, or a place you name on any level), and
  edits the shared map: adds or weakens a power, water or air fault, adds an outbreak, or blocks
  or reopens a tunnel. It checks the readings after each change.
- Works on phones, with keyboard controls on desktop (Q/E change level, O all levels, F fit).

### The Control center (`/control`)

The tool for running the demo (and, in the story, for the operators keeping the map honest). A 2D
plan of each level where you click to place power, water and air faults and lung-sickness
outbreaks, set how far they reach and how strong they are, or block a tunnel. Hovering a fault
type lights up the tunnels it would reach. Every change appears on every open Main Map in real
time. It can also load the starter scenario or clear the map. It is reachable by URL only.

## How it works

### Two kinds of data

1. **The city itself** (tunnels, rooms, facilities, residents) is generated in the browser from a
   single seed (`2087`). It never changes and is the same for everyone.
2. **The state of the city** lives in **Convex** and is shared by every viewer. It is plain current
   state, with no event history:
   - **Points**: a fault or outbreak with a kind (`power`, `water`, `air`, `sickness`), a level, a
     position, a reach and a strength.
   - **Blocked tunnels**: short stretches of tunnel that can't be passed.

### From points to block readings

Every block gets a score from 0 (good) to 1 (bad) per kind, graded into five steps:

- **Power and water spread along the tunnels.** A fault reaches a block by _walking distance_ to
  its door, the way cables and pipes actually run. A failing recycler behind a wall doesn't affect
  the block on the other side.
- **Air and sickness spread over an area,** by straight-line distance.
- Each block also gets a level-wide baseline (deeper is worse) and seeded noise, so the city looks
  lived-in rather than clean.

The same numbers drive the map colors, the home verdict, the notices, the escape routes and the
readings the AI agent sees, so everything stays consistent.

### The report agent

`POST /api/report` runs an [AI SDK](https://ai-sdk.dev) tool-calling loop on OpenRouter (DeepSeek
V4.1 Flash by default). The agent gets the resident's report, their home block with its readings,
what's nearby and a summary of every level. Its tools let it look up places by name, list a
level's points and blocked tunnels, read any block's readings, and add, update or remove points
and blocked tunnels. Each write returns the new readings, so the agent can check that the map now
says what the resident reported. The writes go to Convex, and every open map updates live.

## Tech stack

| Area              | Tools                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| App               | **SvelteKit 3**, **Svelte 5** (runes), **TypeScript**, Vite 8                                 |
| UI                | **Tailwind CSS 4**, **shadcn-svelte** (bits-ui), Lucide icons                                 |
| 3D map            | **three.js**, with meshes built in a **Web Worker** so the UI stays smooth                    |
| Shared live state | **Convex** (realtime queries and mutations)                                                   |
| AI                | **Vercel AI SDK** (`ai`) + **OpenRouter** provider, **Zod** tool schemas, DeepSeek V4.1 Flash |
| Hosting           | **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`, Wrangler)                             |
| Tooling           | **Bun**, Prettier, ESLint, svelte-check                                                       |

## Architecture

From the bottom up:

1. **`#lib/tunnels`**: a seeded procedural generator for tunnels, rooms, doors and shaft gates.
   The seven levels are baked once into `floors.json` so the browser loads them instantly.
2. **`#lib/map`**: a general-purpose three.js renderer for tunnel maps (layers, overlays, markers,
   camera, picking). It knows nothing about the Hollow.
3. **`#lib/hollow`**: the world and its rules: the levels and facilities (`data.ts`), routing
   (`nav.ts`), graded conditions (`conditions.ts`), sickness (`sickness.ts`), home notices
   (`notices.ts`), safe blocks and escape routes (`safety.ts`), the starter scenario
   (`scenario.ts`), and `hollowMap.ts`, which adds levels, the stacked view, lenses and routes on
   top of the renderer.
4. **`#lib/live`**: the browser's link to Convex. It subscribes to the shared state and makes
   every view recompute when it changes.
5. **UI**: the Main Map in `src/lib/components/home/`, the Control center in
   `src/lib/components/control/`.
6. **`convex/`**: schema, validation, and the `points`, `blockedTunnels` and `scenario` functions.
7. **Server**: `#lib/server/ai.ts` (model setup) and `#lib/server/reportAgent.ts` (the report
   agent behind `/api/report`). The API key never reaches the browser.

```
src/
├── routes/
│   ├── +page.svelte        Main Map
│   ├── control/            Control center
│   ├── api/report/         Report agent endpoint
│   └── tunnel-gen/         Scratch: generator playground
├── lib/
│   ├── tunnels/            Procedural generator
│   ├── map/                three.js renderer + mesh worker
│   ├── hollow/             World, simulation and map dressing
│   ├── live/               Convex sync
│   ├── server/             AI model + report agent
│   └── components/         home/ (Main Map), control/ (Control center), ui/ (shadcn-svelte)
convex/                     Schema and functions for the shared state
scripts/                    bake-hollow.ts, validate-intel.ts
```

## Running it locally

Requirements: [Bun](https://bun.sh) and a [Convex](https://convex.dev) account. An
[OpenRouter](https://openrouter.ai) key is only needed for the report agent.

```sh
bun install
bun run dev:convex     # terminal 1: runs Convex, pushes convex/ and writes PUBLIC_CONVEX_URL to .env.local
bun run dev            # terminal 2: the app on http://localhost:5173
```

Add `OPENROUTER_API_KEY=...` to `.env.local` to enable reports. Then open `/control` and click
**Load starter scenario** to fill the map.

Without a Convex URL the map still runs, offline and read-only, on the starter scenario.

Other scripts:

```sh
bun run check          # type check
bun run lint           # prettier + eslint
bun run build          # production build
bun run bake:hollow    # regenerate floors.json after changing the generator, levels or seed
```

### Deploying

```sh
bun run build && bunx wrangler deploy
bunx wrangler secret put OPENROUTER_API_KEY   # once
```

`PUBLIC_CONVEX_URL` is set in `wrangler.jsonc`.

## What's next

The map is the foundation. The next steps build on the same shared state:

- **Warnings before the cut, not after.** Use the state's history to predict which blocks lose
  power or air next.
- **Fair rationing.** Show how much power and water each level gets per person, and simulate
  sharing plans before they're applied.
- **Working without the network.** Cache the map on the device and pass reports between nearby
  phones when the Directorate shuts the network down.
- **Family check-ins.** Let people mark themselves safe and see their family's blocks across levels
  during a blackout.
- **Supplies and care.** Put clinics' stock on the map and route medicine to the outbreaks the
  residents report.
- **The way up.** Add surface readings to the same map so everyone can see the evidence for
  themselves.

---

_Hackfest '26. Everything in the Hollow is fictional._
