<p align="center">
  <img src="src/lib/assets/favicon.svg" alt="Hollow Guard Map icon" width="120" />
</p>

<h1 align="center">Hollow Guard Map</h1>

<p align="center">
  <strong>A live, shared 3D map of the Hollow that shows residents what is really happening where they live, and how to get somewhere safer.</strong>
</p>

<p align="center">
  <a href="https://hollow-guard-map.cbas.workers.dev"><strong>Live demo → hollow-guard-map.cbas.workers.dev</strong></a>
</p>

<p align="center">
  Hackfest '26 · SvelteKit · Svelte 5 · three.js · Convex · AI SDK · Cloudflare Workers
</p>

> **All data in this project is fictional and simulated.** The city, residents, readings and
> outbreaks are generated. Nothing is measured from the real world.

## The problem and our solution

Most of the Hollow's problems share one cause: **nobody can see the whole picture.** Information
comes from the Directorate late or not at all. A resident on L5 can't tell whether a blackout is
local or level-wide, whether bad water reaches their tap, or whether the tunnel out is still open.

Instead of building one narrow tool, we built the shared layer underneath them all: **a live 3D map
of the city's real condition, kept up to date by residents through an AI report agent.**

| Problem in the Hollow                      | What Hollow Guard Map does                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blackouts and air cuts without warning** | Save your home block to get live alerts when power or air worsens, improves or clears (`warning`, `high`, `critical`).                          |
| **Bad water from failing recyclers**       | A Water layer grades every block in five steps and spreads faults _along the tunnels_, showing which blocks broken pipes actually reach.        |
| **Lung sickness and bad official numbers** | A Lung sickness layer tracks outbreaks and block health reports. Residents report illness or recovery directly instead of relying on counts.    |
| **Blocked tunnels cutting off blocks**     | Blocked stretches show in red on the Tunnels layer, and directions automatically route around them.                                             |
| **Deep levels losing out of sight**        | Every level uses the same five-step scale in a stacked 3D **all-levels** view, making the gap from the Crown to the Furnace impossible to hide. |
| **Getting out when your block turns bad**  | **Find safe block** routes you to the nearest reachable block where power, water and air are good or fair and lung sickness is low.             |
| **Directorate control over information**   | Anyone with a saved home can send a plain-language report. An AI agent turns it into live map updates everyone sees right away.                 |

## What the app does

### The App

A sidebar next to an interactive 3D map of all seven levels.

- **3D city & all-levels view.** Pan, rotate and zoom through L1 The Crown to L7 The Furnace,
  connected by six shafts (one open, three permit-restricted, one sealed, one unmapped). Switch
  levels one by one or open the stacked **all-levels** view.
- **Your block.** Save your home block by typing an address or clicking the map. See a safety
  verdict (`Safe`, `Caution`, `Unsafe`, `Danger`) and a four-row chart for Power, Water, Air and
  Lung sickness. Click any row to open that layer.
- **Live notices.** Alerts pop in when conditions at your home appear, worsen, improve or clear,
  with a **Show on the map** shortcut.
- **Five data layers.** Open **Power**, **Water**, **Air**, **Lung sickness** or **Tunnels** in the
  sidebar to repaint the 3D map. Click any block, facility, farm, plant or shaft for details.
- **Directions.** Pick any two places to get a walking route across levels and public shafts that
  avoids blocked tunnels, with walk time, distance and per-level buttons.
- **Find safe block.** One click plots the quickest escape from your home to the nearest safe block,
  avoiding blocked tunnels, permit-only upward lifts and unmapped vents, with an on-map heads-up
  display until arrival.
- **Send a report.** Write what you see in plain English, about your home or any named place on any
  level. The AI agent updates the shared city state in the background and every open map updates
  live.
- **Phones & keyboard.** Uses a slide-over drawer on mobile. On desktop: `WASD`/arrows to pan,
  `Q`/`E` or `1`–`7` to change level, `O` for all levels, `F` to fit, `N` for north, `+`/`-` to zoom.

## How it works

### Seeded city + live Convex state

The app separates the static city from its changing state:

1. **The city never changes.** Tunnels, blocks, facilities, shafts and resident counts come from one
   seed (`2087`), pre-baked into `src/lib/hollow/floors.json` so every browser loads the exact same
   city immediately to simulate the real Hollow.

2. **The state is shared live in Convex.** There is no event history—only what is happening right
   now:
   - **Points:** power, water or air faults and lung-sickness outbreaks, each with a level, tile
     position, reach, strength and optional resident note.
   - **Blocked tunnels:** 2–5 tile stretches that cannot be passed, with a short reason.

### How faults spread

Every housing block gets a score from `0` (good) to `1` (bad) per kind, shown in five steps:

| Layer             | Spread rule                             | Five-step scale                                           |
| ----------------- | --------------------------------------- | --------------------------------------------------------- |
| **Power**         | Along tunnels (walk to each block door) | `Stable` → `Flicker` → `Brownout` → `Cuts` → `Blackout`   |
| **Water**         | Along tunnels (walk to each block door) | `Clean` → `Fair` → `Poor` → `Unsafe` → `Toxic`            |
| **Air**           | Area (straight-line distance)           | `Clean` → `Fair` → `Stale` → `Poor` → `Hazardous`         |
| **Lung sickness** | Area (straight-line distance)           | `0–20%` → `20–40%` → `40–60%` → `60–80%` → `80–100%` sick |

Power and water follow the tunnels like real cables and pipes, so a fault behind a rock wall doesn't
hit an unconnected block. Air and sickness spread over an area instead. Overlapping points compound,
and each block also starts from a level baseline (deeper levels start worse for power, water and
air; crowded upper levels start higher for sickness) plus seeded noise.

One simulation module (`#lib/hollow/simulation.ts`) feeds the 3D map, home verdict, live notices,
escape routes and the AI report agent, so every part of the app agrees.

### The AI report agent

`POST /api/report` runs a [Vercel AI SDK](https://ai-sdk.dev) tool-calling loop on OpenRouter
(defaulting to DeepSeek V4.1 Flash):

1. It reads the resident's message alongside their home readings, nearby points and blocked tunnels,
   and a summary of all seven levels.
2. Using typed tools, the agent looks up named places on any level, inspects current readings, and
   adds, updates or removes points or blocked tunnels in Convex.
3. Each write returns the updated readings so the agent can verify the map matches the report before
   finishing. Convex then pushes the change to every viewer live.

## Tech stack

| Layer        | Stack                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| App          | **SvelteKit 3**, **Svelte 5** (runes), **TypeScript**, **Vite 8**        |
| UI           | **Tailwind CSS 4**, **shadcn-svelte** (`bits-ui`), **Lucide** icons      |
| 3D map       | **three.js** with geometry built in a **Web Worker** (`mesh.worker.ts`)  |
| Shared state | **Convex** (real-time queries and mutations)                             |
| AI agent     | **Vercel AI SDK** (`ai`), **OpenRouter**, **Zod 4**, DeepSeek V4.1 Flash |
| Hosting      | **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`, **Wrangler**)    |
| Tooling      | **Bun**, Prettier, ESLint, `svelte-check`                                |

## Architecture

The codebase is split into clean layers: procedural generation (`#lib/tunnels`), a generic three.js
renderer (`#lib/map`), Hollow world and simulation logic (`#lib/hollow`), Convex live sync
(`#lib/live`), server-only AI reporting (`#lib/server`), and the Main Map and Control center UIs.

```text
src/
├── routes/
│   ├── +page.svelte        Main Map (/)
│   ├── control/            Control center (/control)
│   ├── api/report/         Report agent endpoint (POST /api/report)
│   └── tunnel-gen/         Scratch: generator playground
├── lib/
│   ├── tunnels/            Seeded procedural tunnel and room generator
│   ├── map/                Domain-agnostic three.js renderer + Web Worker mesher
│   ├── hollow/             World data, simulation, routing, notices and map lenses
│   ├── live/               Convex real-time subscriptions
│   ├── server/             OpenRouter model setup and report agent (API key stays server-side)
│   └── components/         home/ (Main Map), control/ (Control center), ui/ (shadcn-svelte)
convex/                     Schema, validators and shared-state functions
scripts/                    bake-hollow.ts, validate-intel.ts
```

## Running locally

You need [Bun](https://bun.sh) and a [Convex](https://convex.dev) account. An
[OpenRouter](https://openrouter.ai) API key is only needed for resident reports.

```sh
bun install
bun run dev:convex     # terminal 1: starts Convex and writes PUBLIC_CONVEX_URL to .env.local
bun run dev            # terminal 2: starts the app at http://localhost:5173
```

Add `OPENROUTER_API_KEY=...` to `.env.local` to enable reports. Then open `/control` and click
**Load starter scenario** to fill the map. Without `PUBLIC_CONVEX_URL`, the Main Map still runs
offline and read-only on the starter scenario.

### Other scripts

```sh
bun run check          # type check (svelte-kit sync + svelte-check)
bun run lint           # prettier --check + eslint
bun run format         # format with prettier
bun run build          # production build
bun run preview        # preview production build
bun run bake:hollow    # rebuild floors.json after changing levels, seed or generator
```

### Deploying

```sh
bun run build && bunx wrangler deploy
bunx wrangler secret put OPENROUTER_API_KEY   # once
```

`PUBLIC_CONVEX_URL` is set in `wrangler.jsonc`.

## What's next

Right now Hollow Guard Map tracks live state only. Next steps build directly on the same map and
shared state:

- **Predictive warnings.** Keep state history to warn blocks _before_ power or air cuts hit.
- **Fair rationing.** Show power and water per person by level and preview sharing plans before
  applying them.
- **Offline & mesh sync.** Cache the map on phones and pass reports device-to-device when the
  Directorate shuts down the network.
- **Family check-ins.** Let residents mark themselves safe and check family blocks across levels.
- **Clinic stock & supplies.** Show clinic inventory on the map and route medicine toward reported
  outbreaks.
- **Surface readings.** Add independent surface data above the sealed shaft so everyone can see the
  evidence.

---

_Hackfest '26 · Hollow Guard Map. Everything in the Hollow is fictional and simulated._
