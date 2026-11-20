/**
 * The report agent: reads a resident's report next to the city's current state and edits the
 * shared state in Convex to match. "There's bad air in my house" adds bad air at their block;
 * "the power is back" weakens or removes the fault that reaches it. Everything is fictional.
 *
 * It sees the home block, its readings (power, water, air, sickness), what is nearby and a summary
 * of every level. Reports can be about any level: it can look up places, list a level's points and
 * blocked tunnels and read any place's readings, and has tools to add, change and remove points
 * (outbreaks too) and to block or reopen tunnels anywhere. Every write tool answers with the
 * readings at the home (and at the last place it read) after the change, so it can check its work.
 * Server only (it holds the AI key and writes to Convex).
 */
import { generateText, stepCountIs, tool } from 'ai';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import { CONDITION_STEPS, conditionStep, conditionsOn } from '#lib/hollow/conditions.js';
import { LEVELS } from '#lib/hollow/data.js';
import { placeCentre, placesOn, TILE_M, type Place } from '#lib/hollow/nav.js';
import type { ReportChange, ReportResult } from '#lib/hollow/report.js';
import { nearestRoad, tunnelRun } from '#lib/hollow/scenario.js';
import { SICK_STEPS, sickStep, sicknessOn } from '#lib/hollow/sickness.js';
import { getHollow } from '#lib/hollow/simulation.js';
import {
	BLOCKED_TILES,
	POINT_INFO,
	POINT_KINDS,
	POINT_RADIUS,
	POINT_STRENGTH,
	type HollowState,
	type SourceKind,
	type StatePoint
} from '#lib/hollow/state.js';
import { aiModel } from './ai.js';

/** How far around the home (tiles, straight line) the agent is shown points and blocked tunnels. */
const NEARBY_TILES = 50;
/** Most points / blocked tunnels `listLevel` returns. */
const LIST_POINTS = 25;
const LIST_TUNNELS = 12;
const MAX_STEPS = 14;

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A place by key ("<level>:<roomId>"), if it exists. */
export function placeByKey(key: string): Place | null {
	const [level, room] = key.split(':').map(Number);
	if (!LEVELS[level]) return null;
	return placesOn(getHollow().floor(level)).find((p) => p.room.id === room) ?? null;
}

/** The current shared state, read from Convex. */
async function fetchState(client: ConvexHttpClient): Promise<HollowState> {
	const [points, blocked] = await Promise.all([
		client.query(api.points.list, {}),
		client.query(api.blockedTunnels.list, {})
	]);
	return {
		points: points.map((d) => ({
			id: d._id,
			kind: d.kind,
			level: d.level,
			x: d.x,
			y: d.y,
			radius: d.radius,
			strength: d.strength,
			note: d.note
		})),
		blockedTunnels: blocked.map((d) => ({
			id: d._id,
			level: d.level,
			tiles: d.tiles,
			reason: d.reason
		}))
	};
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.round(Math.hypot(a.x - b.x, a.y - b.y));

/**
 * The housing block whose readings stand for a place: itself if people live there, otherwise
 * the nearest block on its level (farms, plants, facilities and shafts have no readings).
 */
function housingFor(place: Place): Place {
	const floor = getHollow().floor(place.floor);
	if (floor.residents[place.room.id] > 0) return place;
	const c = placeCentre(place);
	let best = place;
	let bestD = Infinity;
	for (const p of placesOn(floor)) {
		if (!(floor.residents[p.room.id] > 0)) continue;
		const d = dist(placeCentre(p), c);
		if (d < bestD) [best, bestD] = [p, d];
	}
	return best;
}

/**
 * What a place reads now, and which points reach it. Works on any level; for a place nobody
 * lives in it reads the nearest housing block and says so (`readFrom`).
 */
function readingsAt(state: HollowState, at: Place) {
	const place = housingFor(at);
	const floor = getHollow().floor(place.floor);
	const cond = conditionsOn(floor, state.points);
	const id = place.room.id;
	const readings = Object.fromEntries(
		POINT_KINDS.map((kind) => {
			const score = cond.score[kind][id] ?? 0;
			return [
				kind,
				{ score: round(score), step: CONDITION_STEPS[kind][conditionStep(score)].label }
			];
		})
	);
	const sickness = sicknessOn(floor, state.points);
	const sick = sickness.blocks[id];
	return {
		...(place !== at
			? {
					readFrom: `${place.label}, the nearest housing (${dist(placeCentre(place), placeCentre(at))} tiles away); ${at.label} itself has no readings`
				}
			: {}),
		...readings,
		lungSickness: sick
			? {
					sickShareOfReports: round(sick.score),
					step: `${SICK_STEPS[sickStep(sick.score)].range} sick`,
					reported: sick.reported,
					sick: sick.sick
				}
			: null,
		pointsReachingIt: [...cond.areas, ...sickness.areas]
			.filter((a) => a.blocks.includes(id))
			.map((a) => a.point.id)
	};
}

type Tile = { x: number; y: number };

const pointView = (p: StatePoint, from: Tile) => ({
	id: p.id,
	kind: p.kind,
	level: p.level,
	x: p.x,
	y: p.y,
	radius: p.radius,
	strength: p.strength ?? 1,
	note: p.note,
	tilesAway: dist(p, from)
});

const tunnelView = (t: HollowState['blockedTunnels'][number], from: Tile) => ({
	id: t.id,
	level: t.level,
	reason: t.reason,
	tiles: t.tiles,
	tilesAway: dist(t.tiles[0], from)
});

/** The points and blocked tunnels on one level, nearest to `from` first. */
function levelState(state: HollowState, level: number, from: Tile) {
	const points = state.points
		.filter((p) => p.level === level)
		.map((p) => pointView(p, from))
		.sort((a, b) => a.tilesAway - b.tilesAway);
	const tunnels = state.blockedTunnels
		.filter((t) => t.level === level)
		.map((t) => tunnelView(t, from))
		.sort((a, b) => a.tilesAway - b.tilesAway);
	return {
		level,
		levelName: `${LEVELS[level].code} ${LEVELS[level].name}`,
		points: points.slice(0, LIST_POINTS),
		blockedTunnels: tunnels.slice(0, LIST_TUNNELS),
		morePoints: Math.max(0, points.length - LIST_POINTS),
		moreBlockedTunnels: Math.max(0, tunnels.length - LIST_TUNNELS)
	};
}

/** How many points of each kind and blocked tunnels each level has. */
function levelsSummary(state: HollowState) {
	return LEVELS.map((l) => {
		const points: Record<string, number> = {};
		for (const p of state.points)
			if (p.level === l.index) points[p.kind] = (points[p.kind] ?? 0) + 1;
		return {
			level: l.index,
			levelName: `${l.code} ${l.name}`,
			points,
			blockedTunnels: state.blockedTunnels.filter((t) => t.level === l.index).length
		};
	});
}

/** A place for the agent: where it is and how to point at it. */
const placeView = (p: Place) => {
	const c = placeCentre(p);
	return {
		key: p.key,
		label: p.label,
		what: p.sub,
		level: p.floor,
		centreTile: { x: Math.round(c.x), y: Math.round(c.y) },
		doorTunnelTile: p.room.access
	};
};

/** The home, its readings and what is near it on its level: the agent's first look. */
function context(state: HollowState, home: Place) {
	const level = LEVELS[home.floor];
	const floor = getHollow().floor(home.floor);
	const centre = placeCentre(home);
	return {
		home: {
			label: home.label,
			level: home.floor,
			levelName: `${level.code} ${level.name}`,
			centreTile: { x: Math.round(centre.x), y: Math.round(centre.y) },
			doorTunnelTile: home.room.access,
			size: { w: home.room.w, h: home.room.h }
		},
		readingsAtHome: readingsAt(state, home),
		pointsNearHome: state.points
			.filter((p) => p.level === home.floor && dist(p, centre) <= NEARBY_TILES)
			.map((p) => pointView(p, centre))
			.sort((a, b) => a.tilesAway - b.tilesAway)
			.slice(0, 15),
		blockedTunnelsNearHome: state.blockedTunnels
			.filter((t) => t.level === home.floor && dist(t.tiles[0], centre) <= NEARBY_TILES)
			.map((t) => tunnelView(t, centre))
			.sort((a, b) => a.tilesAway - b.tilesAway)
			.slice(0, 8),
		homeLevelSize: { width: floor.map.width, height: floor.map.height },
		allLevels: levelsSummary(state)
	};
}

const SYSTEM = `You are the report desk of the Hollow, a fictional underground city with seven levels (0 = L1 The Crown at the top … 6 = L7 The Furnace at the bottom). A resident sends a short report about their home, or about somewhere else in the city on any level. You keep the city's simulation honest: edit its shared state so it matches what the resident reports, then answer them.

The state you can edit (all simulated):
- Points: sources that make power, water or air bad, and lung-sickness outbreaks (kind "sickness"). Each has a kind, a level, a tile x/y, a radius (reach in tiles, ${POINT_RADIUS.min}–${POINT_RADIUS.max}; one tile is ${TILE_M} m) and a strength (${POINT_STRENGTH.min}–${POINT_STRENGTH.max}, how bad it is at the centre). Power and water spread along the tunnels (walking distance to a block's door); air and sickness spread over an area (straight-line distance). A point's push fades to half at its radius and to nothing soon after. Roughly, a block right at a point reads its strength as its score.
- Scores run 0 (good) to 1 (bad) in five steps of 0.2. Power: Stable, Flicker, Brownout, Cuts, Blackout. Water: Clean, Fair, Poor, Unsafe, Toxic. Air: Clean, Fair, Stale, Poor, Hazardous. Lung sickness: the share of the block's health reports that are lung sickness (sickShareOfReports), in five steps of 20% (0–20% … 80–100% sick). Each block also has a small level-wide base and noise you can't change.
- Blocked tunnels: ${BLOCKED_TILES.min}–${BLOCKED_TILES.max} tile stretches that can't be passed (a collapse, flooding, a checkpoint…).
- Lung sickness on the map comes only from outbreaks (kind "sickness" points), and you can change it like the other kinds: add an outbreak, make one stronger or weaker, grow or shrink its reach, move it, or remove it. An outbreak's strength is roughly the sick share at its centre (0.3 ≈ a third of the health reports are lung sickness).
- Sickness is about people, not the air: change it when the report is about people being sick or getting better ("half my block is coughing", "the clinic on L2 is full of lung cases", "everyone here has recovered"), and only change the air too if they also describe bad air. Size it to what they describe: one coughing neighbour is a small, weak outbreak at most (≈ 0.25, reach 3–5), several sick households a block-sized one (≈ 0.5, reach 5–8), a district-wide wave a large, strong one (≈ 0.8, reach 12+). For recoveries, weaken or remove the outbreaks that reach the place (pointsReachingIt); for a sickness that is spreading, strengthen or widen the nearest outbreak rather than stacking a new one on it.

How to work:
- Work out where the report is about: their home (the default) or a place they name, on any level. For another place, find it with findPlaces, see what is already there with listLevel, and check its readings with readPlace before editing. Pass that level to addPoint and blockTunnel. Never assume a named place is on the home's level.
- Read the report against the readings of that place. If something is wrong that the map doesn't show, add a point (or strengthen a nearby one) so the place reads it. Place it at or next to that place (its centre tile for air or sickness, its door tunnel tile for power or water) unless the report says where it comes from; use findPlaces for named places. Pick a strength that lands the place on the step the report describes (e.g. "a bit stale" ≈ 0.45, "can't breathe" ≈ 0.9) and a modest reach (4–12 tiles for one block, more if they say the whole district).
- If they say something is fixed or fine but the map shows it bad, weaken, shrink or remove the points that reach that place (pointsReachingIt).
- For a tunnel they can't get through, block a short stretch near where they say (default: by their door); if a blocked tunnel near them is open again, reopen it.
- Each write tool returns the readings at the home (homeNow) and at the last place you read with readPlace (placeNow). Check them and adjust if the place isn't on the right step. Make the fewest changes that do it (usually one or two), and only on the levels the report is about.
- Give every new point a short note for the residents it touches, in plain words (e.g. "Residents report smoke in the vents near Block L3-42").
- Only make edits that stand for what was reported: never add test or probe points. If a tool returns an error, don't keep retrying it; change nothing more and say so in your reply.
- If the report is unclear, not about power, water, air, sickness or tunnels, or asks for something you can't do, change nothing.

Finish with a reply to the resident: one to three short sentences in plain, calm civic language, saying what you changed on the map (or why you changed nothing). Stay in the world (underground: no windows, sky or outside). Don't mention ids, tools, scores or tile numbers, and don't answer questions that aren't reports.`;

/** Run the agent on one report. Throws if Convex or the model can't be reached. */
export async function handleReport(message: string, home: Place): Promise<ReportResult> {
	if (!PUBLIC_CONVEX_URL) throw new Error('PUBLIC_CONVEX_URL is not set');
	const client = new ConvexHttpClient(PUBLIC_CONVEX_URL);
	let state = await fetchState(client);
	const changes: ReportChange[] = [];
	/** The last place the agent read with readPlace: write tools report its readings too. */
	let focus: Place | null = null;

	const refresh = async () => {
		state = await fetchState(client);
		return {
			homeNow: readingsAt(state, home),
			...(focus && focus.key !== home.key
				? { placeNow: { label: focus.label, level: focus.floor, ...readingsAt(state, focus) } }
				: {})
		};
	};
	const levelOf = (level: number | undefined) => clamp(Math.round(level ?? home.floor), 0, 6);
	const tileIn = (level: number, x: number, y: number) => {
		const { width, height } = getHollow().floor(level).map;
		return { x: clamp(Math.round(x), 0, width - 1), y: clamp(Math.round(y), 0, height - 1) };
	};
	const fitRadius = (r: number) => clamp(Math.round(r), POINT_RADIUS.min, POINT_RADIUS.max);
	const fitStrength = (s: number) => round(clamp(s, POINT_STRENGTH.min, POINT_STRENGTH.max));
	const findPoint = (id: string) => state.points.find((p) => p.id === id);
	const describe = (kind: SourceKind, level: number, radius: number, strength: number) =>
		`${POINT_INFO[kind].point} on ${LEVELS[level].code} (reach ${radius}, strength ${strength})`;

	const tools = {
		findPlaces: tool({
			description:
				'Find named places on any level (facilities, farms, plants, shaft landings, blocks such as "L3-42") by name. Returns their key, level and tiles.',
			inputSchema: z.object({
				query: z.string().describe('Part of the name, e.g. "clinic" or "Warrens Air"'),
				level: z.number().int().min(0).max(6).optional().describe('Only this level')
			}),
			execute: async ({ query, level }) => {
				const q = query.toLowerCase().replace(/^block\s+/, '');
				const floors = level === undefined ? LEVELS.map((l) => l.index) : [level];
				return floors
					.flatMap((f) => placesOn(getHollow().floor(f)))
					.filter((p) => p.label.toLowerCase().includes(q))
					.slice(0, 8)
					.map(placeView);
			}
		}),

		listLevel: tool({
			description:
				'The points and blocked tunnels on one level (any level), nearest to x/y first (default: the middle of the level).',
			inputSchema: z.object({
				level: z.number().int().min(0).max(6),
				x: z.number().optional().describe('Tile x'),
				y: z.number().optional().describe('Tile y')
			}),
			execute: async ({ level, x, y }) => {
				const { width, height } = getHollow().floor(level).map;
				return levelState(state, level, { x: x ?? width / 2, y: y ?? height / 2 });
			}
		}),

		readPlace: tool({
			description:
				'The readings at a place on any level right now, by its key from findPlaces. Write tools then also report this place.',
			inputSchema: z.object({ key: z.string().describe('e.g. "4:17"') }),
			execute: async ({ key }) => {
				const place = placeByKey(key);
				if (!place) return { error: `No place ${key}` };
				focus = place;
				return { ...placeView(place), readings: readingsAt(state, place) };
			}
		}),

		readHome: tool({
			description: "The home's readings right now (after any changes).",
			inputSchema: z.object({}),
			execute: async () => (await refresh()).homeNow
		}),

		addPoint: tool({
			description: 'Add a source of bad power, water or air, or a lung-sickness outbreak.',
			inputSchema: z.object({
				kind: z.enum(['power', 'water', 'air', 'sickness']),
				level: z.number().int().min(0).max(6).optional().describe("Default: the home's level"),
				x: z.number().describe('Tile x'),
				y: z.number().describe('Tile y'),
				radius: z.number().describe(`Reach in tiles, ${POINT_RADIUS.min}–${POINT_RADIUS.max}`),
				strength: z.number().describe(`${POINT_STRENGTH.min}–${POINT_STRENGTH.max}`),
				note: z.string().max(140).describe('Short words for the residents it touches')
			}),
			execute: async (p) => {
				const level = levelOf(p.level);
				const radius = fitRadius(p.radius);
				const strength = fitStrength(p.strength);
				const id = await client.mutation(api.points.add, {
					kind: p.kind,
					level,
					...tileIn(level, p.x, p.y),
					radius,
					strength,
					note: p.note.trim() || undefined
				});
				changes.push({
					action: 'added',
					layer: p.kind,
					level,
					text: describe(p.kind, level, radius, strength)
				});
				return { id, ...(await refresh()) };
			}
		}),

		updatePoint: tool({
			description: 'Change a point: move it, or change its reach, strength or note.',
			inputSchema: z.object({
				id: z.string(),
				x: z.number().optional(),
				y: z.number().optional(),
				radius: z.number().optional(),
				strength: z.number().optional(),
				note: z.string().max(140).optional()
			}),
			execute: async ({ id, ...patch }) => {
				const p = findPoint(id);
				if (!p) return { error: `No point ${id}` };
				const at = tileIn(p.level, patch.x ?? p.x, patch.y ?? p.y);
				const next = {
					...(patch.x !== undefined || patch.y !== undefined ? at : {}),
					...(patch.radius !== undefined ? { radius: fitRadius(patch.radius) } : {}),
					...(patch.strength !== undefined ? { strength: fitStrength(patch.strength) } : {}),
					...(patch.note !== undefined ? { note: patch.note } : {})
				};
				await client.mutation(api.points.update, { id: id as Id<'points'>, patch: next });
				changes.push({
					action: 'updated',
					layer: p.kind,
					level: p.level,
					text: `Now: ${describe(p.kind, p.level, next.radius ?? p.radius, next.strength ?? p.strength ?? 1)}`
				});
				return { ok: true, ...(await refresh()) };
			}
		}),

		removePoint: tool({
			description: 'Remove a point (the problem it stood for is over).',
			inputSchema: z.object({ id: z.string() }),
			execute: async ({ id }) => {
				const p = findPoint(id);
				if (!p) return { error: `No point ${id}` };
				await client.mutation(api.points.remove, { id: id as Id<'points'> });
				changes.push({
					action: 'removed',
					layer: p.kind,
					level: p.level,
					text: `${POINT_INFO[p.kind].point} on ${LEVELS[p.level].code} cleared`
				});
				return { ok: true, ...(await refresh()) };
			}
		}),

		blockTunnel: tool({
			description: `Block a short stretch of tunnel (${BLOCKED_TILES.min}–${BLOCKED_TILES.max} tiles) starting at the tunnel tile nearest x/y.`,
			inputSchema: z.object({
				level: z.number().int().min(0).max(6).optional().describe("Default: the home's level"),
				x: z.number(),
				y: z.number(),
				length: z.number().int().min(BLOCKED_TILES.min).max(BLOCKED_TILES.max),
				reason: z.string().max(80).describe('e.g. "Rockfall", "Flooded"')
			}),
			execute: async (b) => {
				const level = levelOf(b.level);
				const floor = getHollow().floor(level);
				const at = tileIn(level, b.x, b.y);
				const start = nearestRoad(floor, at.x, at.y, 6);
				const tiles = start ? tunnelRun(floor, start, b.length) : [];
				if (tiles.length < BLOCKED_TILES.min) return { error: 'No tunnel there to block' };
				await client.mutation(api.blockedTunnels.add, {
					level,
					tiles,
					reason: b.reason.trim() || 'Blocked'
				});
				changes.push({
					action: 'blocked',
					layer: 'tunnels',
					level,
					text: `Tunnel blocked on ${LEVELS[level].code}: ${b.reason}`
				});
				return { ok: true, tiles, ...(await refresh()) };
			}
		}),

		reopenTunnel: tool({
			description: 'Reopen a blocked tunnel.',
			inputSchema: z.object({ id: z.string() }),
			execute: async ({ id }) => {
				const t = state.blockedTunnels.find((b) => b.id === id);
				if (!t) return { error: `No blocked tunnel ${id}` };
				await client.mutation(api.blockedTunnels.remove, { id: id as Id<'blockedTunnels'> });
				changes.push({
					action: 'reopened',
					layer: 'tunnels',
					level: t.level,
					text: `Tunnel reopened on ${LEVELS[t.level].code} (was: ${t.reason})`
				});
				return { ok: true, ...(await refresh()) };
			}
		})
	};

	const result = await generateText({
		model: aiModel(),
		system: SYSTEM,
		prompt: `The resident's report:\n"""\n${message}\n"""\n\nThe city around their home right now:\n${JSON.stringify(context(state, home), null, 1)}`,
		tools,
		stopWhen: stepCountIs(MAX_STEPS),
		maxRetries: 1
	});

	const reply =
		result.text.trim() ||
		(changes.length
			? 'Thanks for your report. We have updated the map.'
			: 'Thanks for your report. We made no change to the map.');
	return { reply, changes };
}
