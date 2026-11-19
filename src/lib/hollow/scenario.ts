/**
 * The starter scenario: a deterministic first set of events for a city, drawn from its seed
 * (the `events` stream). The control center loads it into Convex ("Load starter scenario"),
 * and pages that never connect to Convex use it as their read-only events.
 *
 * - Blackouts: a few round power cuts per level, more and wider on the darker, deeper levels.
 * - Air and water: each ventilation and water facility the stress model (sensors.ts) reads
 *   as Warning or worse gets one event on its worst metric, with that reading.
 * - Blocked tunnels: a few short stretches of tunnel per level.
 * - Sickness: the default settings.
 * Tuning: `SIM.scenario`.
 */
import { mulberry32 } from '#lib/random.js';
import { LEVELS } from './data.js';
import type {
	AirEvent,
	AirMetric,
	BlackoutEvent,
	BlockedTunnelEvent,
	HollowEvents,
	Severity,
	Tile,
	WaterEvent,
	WaterMetric
} from './events.js';
import { placesOn } from './nav.js';
import { STATUS_INFO, stressReadings } from './sensors.js';
import { DEFAULT_SICKNESS } from './sickness.js';
import { SIM, spread, streamSeed } from './simConfig.js';
import type { Floor, Hollow } from './world.js';

type New<T> = Omit<T, 'id'>;

/** A scenario before it has ids: what Convex's `events.loadScenario` takes. */
export interface Scenario {
	blackouts: New<BlackoutEvent>[];
	airQuality: New<AirEvent>[];
	waterCuts: New<WaterEvent>[];
	blockedTunnels: New<BlockedTunnelEvent>[];
	sickness: HollowEvents['sickness'];
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
	const level = LEVELS[floor.index];
	const rand = mulberry32(streamSeed(citySeed, 'events') + floor.index * 7919);
	const housing = floor.map.rooms.filter((r) => floor.residents[r.id] > 0);
	const dark = 1 - level.light;

	const blackouts: New<BlackoutEvent>[] = [];
	const count = Math.max(
		C.blackouts.min,
		Math.round(C.blackouts.max * dark * (0.6 + rand() * 0.6))
	);
	for (let i = 0; i < count && housing.length; i++) {
		const r = housing[Math.floor(rand() * housing.length)];
		blackouts.push({
			level: floor.index,
			x: Math.round(r.x + r.w / 2),
			y: Math.round(r.y + r.h / 2),
			radius: Math.round(spread(C.blackoutRadius, rand()) * (0.5 + 1.6 * dark))
		});
	}

	const airQuality: New<AirEvent>[] = [];
	const waterCuts: New<WaterEvent>[] = [];
	for (const p of placesOn(floor)) {
		if (p.kind !== 'air' && p.kind !== 'water') continue;
		const s = stressReadings(floor, p, p.kind);
		if (s.status === 'normal') continue;
		const worst = s.readings.reduce((a, b) =>
			STATUS_INFO[b.status].rank > STATUS_INFO[a.status].rank ? b : a
		);
		const event = {
			level: floor.index,
			facility: p.key,
			severity: worst.status as Severity,
			value: worst.value
		};
		if (p.kind === 'air') airQuality.push({ ...event, metric: worst.key as AirMetric });
		else waterCuts.push({ ...event, metric: worst.key as WaterMetric });
	}

	const blockedTunnels: New<BlockedTunnelEvent>[] = [];
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

	return { blackouts, airQuality, waterCuts, blockedTunnels };
}

/** The starter scenario for a city (builds every floor, so it is slow the first time). */
export function starterScenario(city: Hollow): Scenario {
	const out: Scenario = {
		blackouts: [],
		airQuality: [],
		waterCuts: [],
		blockedTunnels: [],
		sickness: { ...DEFAULT_SICKNESS }
	};
	for (const level of LEVELS) {
		const s = floorScenario(city.floor(level.index), city.seed);
		out.blackouts.push(...s.blackouts);
		out.airQuality.push(...s.airQuality);
		out.waterCuts.push(...s.waterCuts);
		out.blockedTunnels.push(...s.blockedTunnels);
	}
	return out;
}

/** Give a scenario's events local ids, to use it without Convex. */
export function withLocalIds(s: Scenario): HollowEvents {
	const ids = <T>(table: string, list: T[]) =>
		list.map((e, i) => ({ ...e, id: `local:${table}:${i}` }));
	return {
		blackouts: ids('blackouts', s.blackouts),
		airQuality: ids('airQuality', s.airQuality),
		waterCuts: ids('waterCuts', s.waterCuts),
		blockedTunnels: ids('blockedTunnels', s.blockedTunnels),
		sickness: s.sickness
	};
}
