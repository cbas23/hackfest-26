# Hollow Guardian — Hackfest 26 Plan

_Last updated: 2026-11-16_

**Pitch:** An AI-powered system that turns scattered reports and sensor data from the Hollow into outbreak intelligence with an evidence trail, then coordinates medicine delivery, with a person approving every action.

> Everything in the app is fictional/simulated and must be labeled that way.

---

## ⚠️ Reminders from team review (read first)

**Deadline: Thursday (2026-11-19).**

1. **Five agents is too much.** Build only **Intake, Investigator and Supply** for the hackathon. Directorate Auditor and Infrastructure Watch stay **stretch goals**.
2. **Pick one AI provider: Claude or OpenAI.** Don't spend time integrating both.
3. **No PostgreSQL for the demo.** Keep storage simple (files or DuckDB). Add Postgres later only if the project grows.
4. **The agent dashboard is extra work.** Live steps, handoffs, stuck detection and costs are secondary. First prove the outbreak investigation and medicine coordination actually work; the dashboard comes after.

---

## 1. Problems covered

| Priority   | Challenge                                  | Coverage                                             |
| ---------- | ------------------------------------------ | ---------------------------------------------------- |
| Main       | **#9** Lung sickness and outbreak tracking | Full                                                 |
| Next       | **#10** Medicine shortages                 | Full                                                 |
| Supporting | **#1** Blackouts and air failures          | Partial (air/ventilation data, blackout data delays) |
| Supporting | **#3** Geothermal overheating              | Partial (heat as evidence)                           |
| Supporting | **#2** Fair resource distribution          | Partial (rule-based medicine allocation)             |
| Stretch    | **#1** early warning, **#4** water sensors | One extra tool each, no new agent                    |
| Later      | #5 sewage, #6 overcrowding                 | Not in this build                                    |
| Skipped    | #7, #8, #11–#15                            | Out of scope                                         |

**For the judges:** "Two challenges fully solved (#9, #10), with three more supporting them (#1, #3, #2)."

---

## 2. Data

### Where data comes from (in the Hollow)

| Source                    | Counts                                | Reliability                                       |
| ------------------------- | ------------------------------------- | ------------------------------------------------- |
| Clinic intake logs        | **Patients** (with resident IDs)      | High, but misses people who can't reach a clinic  |
| Block coordinator tallies | **Reports** (no IDs)                  | Medium: duplicates, arrives late by runner        |
| Anonymous kiosk reports   | **Reports**                           | Low, but catches people afraid of the Directorate |
| Pharmacy sales            | **Indirect signal** (inhalers, masks) | Early warning                                     |
| Directorate bulletins     | **Confirmed cases** only              | Narrow definition, possibly hiding numbers        |

### Every record has

Source, count type (patients / reports / confirmed cases), level + named place + sector, reporting period, submitted vs received time, document ID.

> Refer to **levels, named places and sectors** — never grid coordinates — so nothing breaks if the map changes size.

### What the dataset is made of

- **Simulated history (12–26 weeks)**, generated in code with a fixed seed:
  - normal levels per block (higher on deep levels)
  - one past incident where the cause was found (e.g. Stackhouse Vents fan failure)
  - the Directorate's record of undercounting
  - past blackout data delays
- **Current week:** 10–15 hand-written fictional reports that agree in some places and conflict in others
- **Demo location:** L3 The Warrens (Clinic Nine is already in the data)

### Why historical data (one of our core "whys")

**In one line:** historical data teaches Hollow Guardian what normal looks like, so it can recognize when something is wrong.

Without history, the system only knows that 31 people reported respiratory symptoms. With history, it knows 31 is unusual.

**Example — L3 The Warrens (illustrative fictional data):**

| Week                 | Respiratory reports |
| -------------------- | ------------------- |
| Week 1               | 7                   |
| Week 2               | 9                   |
| Week 3               | 8                   |
| Week 4               | 10                  |
| **Week 5 (current)** | **31**              |

1. **Learns the normal pattern:** L3 usually sees about 8–10 reports a week.
2. **Detects an unusual increase:** 31 is roughly 3× normal.
3. **Raises an alert:** something unusual may be happening in The Warrens.
4. **Investigates:** the Investigator agent checks clinic and community reports, ventilation records and official bulletins.
5. **Supports a response:** if medicine demand is rising, the Supply agent checks inventory and proposes deliveries.

**All the reasons we need history:**

- **Baseline → anomaly detection:** tells "9 this week" (normal) apart from "31 this week" (possible emergency).
- **Fewer false alarms:** normal week-to-week noise is known, so small bumps don't trigger alerts.
- **Directorate track record:** one mismatch could be noise; a gap that shows up every week and grows with depth is evidence.
- **Past incident with a known cause:** a simulated earlier ventilation failure (Stackhouse Vents) gives a pattern to compare against — "this looks like Week 31."
- **Environmental vs contagious:** the past incident shows what an air-caused cluster looks like over time (follows a service area, drops after repair) versus spread along tunnels.
- **Data delays:** knowing how late reports usually arrive after blackouts means recent weeks are marked _incomplete_ instead of looking like a drop.
- **Speed of rise → urgency:** how fast reports are climbing compared with past weeks sets how urgent the alert is.
- **Medicine demand (#10):** past inhaler use per clinic lets code estimate demand instead of guessing.

**Important limit:** history helps detect unusual patterns. It does **not** prove an outbreak or identify its cause — that's what the investigation and a human review are for.

### Real-world grounding (not imported as Hollow data)

- **Realistic numbers:** CDC ILINet (normal levels/noise), indoor CO₂ guidelines (~1,000 ppm), Hurricane Maria / COVID excess-death gaps (undercount ratio)
- **Precedents for the pitch:** John Snow 1854 (shared source), Legionnaires' 1976 (cooling system outbreak), Milwaukee 1993 (pharmacy sales early warning), Hurricane Maria (official 64 vs thousands), Flint, black lung
- Verify exact figures against original sources before they go on a slide

---

## 3. Logic (deterministic code)

1. **Validate** what the AI extracts; standardize places and dates
2. **Never mix count types** (patients, reports, confirmed cases)
3. **Remove duplicates** where IDs exist; otherwise show a **range** (e.g. 31–58), never a sum
4. **Compare with normal** using history; flag above ~2× normal
5. **Directorate gap** = expected (definition difference) + **unexplained** (flagged)
6. **Data freshness** per level — blackouts delay reports, so recent deep-level numbers are incomplete
7. **Environmental vs contagious:** does the cluster match an air exchange's service area (`impact.ts`) or spread along tunnels over time (`nav.ts`)? Show which fits better; never claim it's proven

**AI never:** produces counts, diagnoses, decides causes, or decides who gets supplies.

### Shared vocabulary (the semantic layer)

**What it is:** a semantic model organizes information by what it _means_, not the exact words. Reports say the same thing in different ways:

- Clinic Nine: "Respiratory patients increased."
- Coordinator: "More residents are experiencing breathing difficulties."
- Directorate: "Pulmonary illness cases remain stable."

All three are about the same concept (respiratory illness). Without a shared vocabulary, code can't tell they should be compared.

**How we use it (for Thursday):** one vocabulary file that every report is mapped onto.

| Concept group  | Example terms → one code                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Symptoms       | cough, shortness of breath, breathing difficulties, chest tightness, pulmonary illness → `respiratory` |
| Places         | "Stackhouse stairs", "north Warrens" → L3 + Stackhouse Vents / North-West, North                       |
| Report types   | shift report, tally, bulletin, dispensing note → source + count type                                   |
| Infrastructure | fans tripped, reduced airflow, CO₂ high, mould on filters → `ventilation-failure`, `air-quality`       |

- The **Intake agent** reads free text and maps it to these codes (it's good at understanding wording).
- **Code** then counts, compares and flags using the codes only — so "breathing difficulties" from a coordinator and "pulmonary illness" from the Directorate land in the same comparison.
- It also helps **historical comparisons** (older reports with different wording match the same category), **Directorate discrepancies** (same issue, different words), the **Investigator** (finding related incidents and documents), and **infrastructure links** (ventilation failures next to respiratory complaints).

**Scope:**

- **Yes, now:** a consistent vocabulary for symptoms, places, report types and infrastructure concepts.
- **Maybe later:** embeddings and vector search to find similar historical reports (the scaling story above).
- **Not yet:** a full knowledge graph or complex ontology.

**Same rule as everywhere:** semantic understanding helps the system know what reports _mean_; deterministic code still calculates counts, trends, discrepancies and medicine allocation.

---

## 4. Agents

| Agent                    | Problem           | Job                                                                       | Model                  |
| ------------------------ | ----------------- | ------------------------------------------------------------------------- | ---------------------- |
| **Intake**               | #9                | Reads each report, extracts fields; moves up to Sonnet if the check fails | Haiku 5.5 → Sonnet 5.5 |
| **Investigator**         | #9 (+#1, #3 data) | Looks into alerts with search tools, writes a cited case file             | Sonnet 5.5 / Opus 5.5  |
| **Supply**               | #10               | Drafts restock proposals and delivery routes (existing tunnel routing)    | Sonnet 5.5             |
| **Directorate auditor**  | #9                | Weekly brief on unexplained gaps (stretch)                                | Sonnet 5.5             |
| **Infrastructure watch** | #1, #3            | Flags failing air/cooling; stretch: early warning (stretch)               | Haiku 5.5              |
| _No agent_               | #2                | Allocation is a scoring rule in code; an agent only explains it           | —                      |

**Flow:** new report → Intake → (code raises alert) → Investigator → (demand rising) → Supply → **human approves**

**Guardrails:** read-only tools, step and token limits, numbers only from code tools, a person approves every delivery.

### AI features

- **Citations:** every claim in an explanation links to the exact passage in its source report
- **Search tools:** agents retrieve data with exact queries (agentic retrieval)
- **Shared vocabulary:** Intake maps different wording onto one set of concept codes (see section 3)
- **No vector RAG for now** — that's the scaling story ("at city scale we add a semantic index behind the same tool")
- **Optional later:** forecaster trained on real CDC ILINet data

---

## 5. What the user sees

- **3D map** (existing): affected blocks highlighted
- **Intelligence Center:** reports by level (local vs official), discrepancy alert with source documents, AI summary, report list + upload
- **Baseline and anomaly chart** (the historical-data feature), one per level:
  - grey band = normal range from history
  - solid line = local reports; dashed line = Directorate's official count
  - badge like **"3.1× normal"** when the current week breaks the band
  - markers for past incidents and blackouts
  - recent weeks shaded as **"data incomplete"** when reports are still arriving
  - **"Similar past incident"** card: "Looks like Week 31 — Stackhouse Vents fan failure; cases followed the service area and dropped after repair"
- **Agent operations dashboard:**
  - agent cards with status (idle / working / waiting on you / stuck)
  - live step timeline (every tool call)
  - handoffs between agents
  - **stuck detection:** same tool 3× with same input, N steps without new info, or token budget hit
  - human approval queue
  - cost and model escalations

---

## 6. Tech stack

- **Existing:** SvelteKit + TypeScript + Three.js + bun (don't rebuild the map)
- **AI:** Anthropic TypeScript SDK, tool runner, inside SvelteKit server routes
- **Live updates:** server-sent events from the server to the dashboard
- **Storage:** files in the repo (or DuckDB if queries get complex) — Postgres not needed for the demo

---

## 7. PR plan

**Rule:** stay out of each other's files.

- **Sebastian (map):** `hollowMap.ts`, `mapStyle.ts`, `world.ts`, `floors.json`, bake script
- **Intel work:** new folders only — `src/lib/intel/`, `src/routes/intel/`
- **Shared files** (`hollow/+page.svelte`, `impact.ts`, `nav.ts`): only in the last PRs, coordinate first

| #   | PR                                                                                                                              | Touches map?     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | Report data types + 10–15 fictional reports                                                                                     | No               |
| 2   | Shared vocabulary + history generator + core logic (normal levels, ×-normal alerts, duplicates, Directorate gap, past incident) | No               |
| 3   | Intelligence Center page using static data, including the baseline and anomaly chart                                            | No               |
| 4   | Claude setup + Intake agent + processing status                                                                                 | No               |
| 5   | Investigator agent (+ simple step log)                                                                                          | No               |
| 6   | Supply agent + approval step                                                                                                    | No               |
| 7   | "Show on map" link + route on the map                                                                                           | Yes — coordinate |
| 8   | Agent dashboard (handoffs, stuck detection, costs) — only if time                                                               | No               |
| —   | Stretch: auditor, infrastructure watch, early warning, water                                                                    | —                |

_Reordered after team review: the core investigation and medicine coordination (PRs 1–7) come before the dashboard._

**Each PR:** branch off latest main → one focused change → `bun run check` + `bun run lint` → push → PR with description/screenshot → review → merge → pull main.

If only PRs 1–6 land, there's still a working demo of the investigation and medicine coordination.

---

## 8. Still to decide

- [ ] AI provider: Claude (this plan) or OpenAI (old handoff) — **pick one only**
- [ ] Storage: files or DuckDB (no Postgres for the demo)
- [ ] Confirm demo location: L3 The Warrens
- [ ] Who builds what
- [x] Deadline: Thursday 2026-11-19
- [ ] Who gets the API key for the chosen provider

## 9. Risks

- **Scope:** only three agents for the hackathon; dashboard last — PRs 1–6 must work first
- **Live demo:** agents can be slow or unpredictable on stage — record a backup video of one good run
- **API key / cost:** demo costs cents, but someone needs a key set up in `.env` (never commit it)
