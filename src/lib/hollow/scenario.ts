/**
 * The starter scenario: a deterministic first state for a city, drawn from its seed (the
 * `scenario` stream). The control center loads it into Convex ("Load starter scenario"), and
 * pages that never connect to Convex use it as their read-only state.
 *
 * - Points: a few power, water and air points per level, centred on housing blocks; more
 *   and wider on the darker, deeper levels.
 * - Blocked tunnels: a few short stretches of tunnel per level.
 * - Sickness: the default settings.
 * Tuning: `SIM.scenario`.
 */
import { mulberry32 } from '#lib/random.js';
import { LEVELS } from './data.js';
import {
	POINT_KINDS,
	POINT_RADIUS,
	type BlockedTunnel,
	type HollowState,
	type StatePoint,
	type Tile
} from './state.js';
import { DEFAULT_SICKNESS } from './sickness.js';
import { SIM, spread, streamSeed } from './simConfig.js';
import type { Floor, Hollow } from './world.js';

type New<T> = Omit<T, 'id'>;

/** A scenario before it has ids: what Convex's `scenario.load` takes. */
export interface Scenario {
	points: New<StatePoint>[];
	blockedTunnels: New<BlockedTunnel>[];
	sickness: HollowState['sickness'];
}

const C = SIM.scenario;
const STEPS: Tile[] = [
	{ x: 1, y: 0 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 0, y: -1 }
];

const isRoad = (floor: Floor, x: number, y: number) => floor.map.grid[y]?.[x] === 'road';

/** The road tile nearest (x, y) within `reach` tiles, or null. */
export function nearestRoad(floor: Floor, x: number, y: number, reach = 3): Tile | null {
	let best: Tile | null = null;
	let bestD = Infinity;
	for (let dy = -reach; dy <= reach; dy++)
		for (let dx = -reach; dx <= reach; dx++) {
			const d = dx * dx + dy * dy;
			if (d < bestD && isRoad(floor, x + dx, y + dy)) {
				bestD = d;
				best = { x: x + dx, y: y + dy };
			}
		}
	return best;
}

/**
 * A run of `length` road tiles starting at (x, y): straight along the tunnel where it can,
 * otherwise following its turns. May come back shorter at a dead end.
 */
export function tunnelRun(floor: Floor, start: Tile, length: number): Tile[] {
	if (!isRoad(floor, start.x, start.y)) return [];
	const run = [start];
	const seen = new Set([`${start.x},${start.y}`]);
	const free = (t: Tile) => isRoad(floor, t.x, t.y) && !seen.has(`${t.x},${t.y}`);
	let dir = STEPS.find((d) => free({ x: start.x + d.x, y: start.y + d.y }));
	while (dir && run.length < length) {
		const at = run[run.length - 1];
		const ahead = { x: at.x + dir.x, y: at.y + dir.y };
		if (!free(ahead)) {
			dir = STEPS.find((d) => free({ x: at.x + d.x, y: at.y + d.y }));
			continue;
		}
		run.push(ahead);
		seen.add(`${ahead.x},${ahead.y}`);
	}
	return run;
}

function floorScenario(floor: Floor, citySeed: number): Omit<Scenario, 'sickness'> {
	const rand = mulberry32(streamSeed(citySeed, 'scenario') + floor.index * 7919);
	const housing = floor.map.rooms.filter((r) => floor.residents[r.id] > 0);
	const dark = 1 - LEVELS[floor.index].light;
	const depth = floor.index / (LEVELS.length - 1);

	const points: New<StatePoint>[] = [];
	for (const kind of POINT_KINDS) {
		const count = Math.max(C.points.min, Math.round(C.points.max * dark * (0.4 + rand() * 0.6)));
		for (let i = 0; i < count && housing.length; i++) {
			const r = housing[Math.floor(rand() * housing.length)];
			const radius = Math.round(spread(C.pointRadius, rand()) * (0.7 + depth * 0.6));
			points.push({
				kind,
				level: floor.index,
				x: Math.round(r.x + r.w / 2),
				y: Math.round(r.y + r.h / 2),
				radius: Math.min(POINT_RADIUS.max, Math.max(POINT_RADIUS.min, radius))
			});
		}
	}

	const blockedTunnels: New<BlockedTunnel>[] = [];
	const roads: Tile[] = [];
	floor.map.grid.forEach((row, y) =>
		row.forEach((t, x) => {
			if (t === 'road') roads.push({ x, y });
		})
	);
	const stretches = Math.floor(spread(C.blockedTunnels, rand()));
	for (let i = 0, tries = 0; i < stretches && tries < 20; tries++) {
		const length = Math.floor(spread(C.blockedLength, rand()));
		const tiles = tunnelRun(floor, roads[Math.floor(rand() * roads.length)], length);
		if (tiles.length < 2) continue;
		blockedTunnels.push({
			level: floor.index,
			tiles,
			reason: C.blockedReasons[Math.floor(rand() * C.blockedReasons.length)]
		});
		i++;
	}

	return { points, blockedTunnels };
}

/** The starter scenario for a city (builds every floor, so it is slow the first time). */
export function starterScenario(city: Hollow): Scenario {
	const out: Scenario = { points: [], blockedTunnels: [], sickness: { ...DEFAULT_SICKNESS } };
	for (const level of LEVELS) {
		const s = floorScenario(city.floor(level.index), city.seed);
		out.points.push(...s.points);
		out.blockedTunnels.push(...s.blockedTunnels);
	}
	return out;
}

/** Give a scenario local ids, to use it without Convex. */
export function withLocalIds(s: Scenario): HollowState {
	return {
		points: s.points.map((p, i) => ({ ...p, id: `local:points:${i}` })),
		blockedTunnels: s.blockedTunnels.map((t, i) => ({ ...t, id: `local:blockedTunnels:${i}` })),
		sickness: s.sickness
	};
}
