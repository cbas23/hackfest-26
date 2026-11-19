import {
	generateTunnelMap,
	type GateSpec,
	type Room,
	type Side,
	type TunnelMap
} from '#lib/tunnels/generate.js';
import { FLOOR_CONFIG, LEVELS, SHAFTS, type FacilitySpec } from './data.js';
import { decodeFloor, type BakedHollow } from './bake.js';
import baked from './floors.json';
import { hashPair } from '#lib/random.js';
import { SIM, streamSeed } from './simConfig.js';

export interface Floor {
	index: number;
	/** The city seed the floor was built from (simulations derive their own seeds from it). */
	seed: number;
	map: TunnelMap;
	/** Gate room for each shaft index (same coordinates on every floor). */
	shaftGates: Room[];
	/** Room id → estimated residents (habitation blocks only). */
	residents: number[];
	/** Room id → the civic facility housed there (ventilation, water, clinic…). */
	facilities: Map<number, FacilitySpec>;
}

export interface Hollow {
	seed: number;
	/** Gate positions shared by every floor, one per shaft. */
	gateSpecs: GateSpec[];
	/** Floors load lazily: decoded from the baked data, or generated (~600 ms each) if it's stale. */
	floor(index: number): Floor;
	isReady(index: number): boolean;
}

const sideOf = (r: Room): Side => {
	const dx = r.access.x - r.door.x;
	const dy = r.access.y - r.door.y;
	return dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
};

const floorSeed = (seed: number, index: number) => seed * 31 + index * 7919;

/**
 * Put each of a level's facilities in a roomy chamber (at least 3×3), spreading them
 * across the city: each pick is the candidate furthest from those already chosen,
 * with a little seeded noise so layouts don't all hug the edge.
 */
function placeFacilities(map: TunnelMap, specs: FacilitySpec[], seed: number) {
	const out = new Map<number, FacilitySpec>();
	const candidates = map.rooms.filter(
		(r) => r.kind === 'room' && Math.min(r.w, r.h) >= SIM.world.facilityMinSize
	);
	const cx = map.width / 2;
	const cy = map.height / 2;
	const centre = (r: Room) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
	const chosen: { x: number; y: number }[] = [];
	for (const spec of specs) {
		let best: Room | null = null;
		let bestScore = -Infinity;
		for (const r of candidates) {
			if (out.has(r.id)) continue;
			const c = centre(r);
			const apart = chosen.length
				? Math.min(...chosen.map((o) => Math.hypot(o.x - c.x, o.y - c.y)))
				: 120 - Math.hypot(c.x - cx, c.y - cy) * 0.5;
			// Cap the spread so picks don't all run to the rim; noise breaks ties.
			const score = Math.min(apart, 90) + hashPair(r.id, seed) * 12 + r.w * r.h * 0.2;
			if (score > bestScore) {
				bestScore = score;
				best = r;
			}
		}
		if (!best) break;
		out.set(best.id, spec);
		chosen.push(centre(best));
	}
	return out;
}

/**
 * Generate the Crown. Its random gates become the fixed shaft positions that every other
 * floor is built around, so retry until all six shafts fit.
 */
function generateCrown(seed: number) {
	let crown: TunnelMap | undefined;
	for (let attempt = 0; attempt < 20; attempt++) {
		const m = generateTunnelMap({
			...FLOOR_CONFIG,
			seed: floorSeed(seed, 0) + attempt * 104729,
			cityScale: LEVELS[0].cityScale,
			features: LEVELS[0].features
		});
		if (m.rooms.filter((r) => r.kind === 'gate').length === FLOOR_CONFIG.gates) {
			crown = m;
			break;
		}
		crown ??= m;
	}
	const crownGates = crown!.rooms.filter((r) => r.kind === 'gate').slice(0, SHAFTS.length);
	const gateSpecs: GateSpec[] = crownGates.map((g) => ({ x: g.x, y: g.y, door: sideOf(g) }));
	return { crown: crown!, gateSpecs };
}

const generateFloor = (seed: number, index: number, gateSpecs: GateSpec[]) =>
	generateTunnelMap({
		...FLOOR_CONFIG,
		seed: floorSeed(seed, index),
		gates: gateSpecs,
		cityScale: LEVELS[index].cityScale,
		features: LEVELS[index].features
	});

/** Generate every floor from scratch (used to bake `floors.json`). */
export function generateHollowMaps(seed: number) {
	const { crown, gateSpecs } = generateCrown(seed);
	const maps = [crown, ...LEVELS.slice(1).map((l) => generateFloor(seed, l.index, gateSpecs))];
	return { gateSpecs, maps };
}

/** The baked floors, if they were made with this seed and the current generator settings. */
function bakedFor(seed: number): BakedHollow | null {
	const b = baked as BakedHollow;
	const ok =
		b.seed === seed &&
		b.width === FLOOR_CONFIG.width &&
		b.height === FLOOR_CONFIG.height &&
		b.floors.length === LEVELS.length;
	return ok ? b : null;
}

export function createHollow(seed: number): Hollow {
	const stored = bakedFor(seed);
	/** Facility placement draws from the world stream; the tunnels use `seed` itself. */
	const worldSeed = streamSeed(seed, 'world');
	let generated: { crown: TunnelMap; gateSpecs: GateSpec[] } | null = null;
	if (!stored) {
		console.warn('[hollow] baked floors are stale; generating. Run `bun run bake:hollow`.');
		generated = generateCrown(seed);
	}
	const gateSpecs = stored ? stored.gateSpecs : generated!.gateSpecs;
	const loadMap = (index: number): TunnelMap =>
		stored
			? decodeFloor(stored, index)
			: index === 0
				? generated!.crown
				: generateFloor(seed, index, gateSpecs);

	const cache = new Map<number, Floor>();

	const build = (index: number, map: TunnelMap): Floor => {
		const level = LEVELS[index];
		const gates = map.rooms.filter((r) => r.kind === 'gate');
		const shaftGates = gateSpecs.map((_, i) => gates.find((g) => g.specIndex === i) ?? gates[i]);
		const facilities = placeFacilities(map, level.facilities, floorSeed(worldSeed, index));
		const housing = map.rooms.filter((r) => r.kind === 'room' && !facilities.has(r.id));
		const area = housing.reduce((s, r) => s + r.w * r.h, 0);
		const perTile = (level.population * 1e6) / Math.max(1, area);
		const residents = map.rooms.map((r) =>
			r.kind === 'room' && !facilities.has(r.id) ? Math.round(r.w * r.h * perTile) : 0
		);
		return { index, seed, map, shaftGates, residents, facilities };
	};

	cache.set(0, build(0, loadMap(0)));

	return {
		seed,
		gateSpecs,
		isReady: (index) => cache.has(index),
		floor(index) {
			let f = cache.get(index);
			if (!f) {
				f = build(index, loadMap(index));
				cache.set(index, f);
			}
			return f;
		}
	};
}

/**
 * Memoise per-floor derived data. Keyed by the floor object itself, so floors from
 * Hollows with different seeds never share an entry.
 */
export function perFloor<T>(fn: (floor: Floor) => T): (floor: Floor) => T {
	const cache = new WeakMap<Floor, T>();
	return (floor) => {
		if (cache.has(floor)) return cache.get(floor)!;
		const value = fn(floor);
		cache.set(floor, value);
		return value;
	};
}

/**
 * Memoise per-floor data that also depends on an input (an event list, settings). Keeps the
 * last result per floor and recomputes when the input changes identity, so replace inputs
 * instead of mutating them.
 */
export function perFloorWith<K, T>(fn: (floor: Floor, input: K) => T) {
	const cache = new WeakMap<Floor, { input: K; value: T }>();
	return (floor: Floor, input: K): T => {
		const hit = cache.get(floor);
		if (hit && hit.input === input) return hit.value;
		const value = fn(floor, input);
		cache.set(floor, { input, value });
		return value;
	};
}

/** `[minX, minY, maxX, maxY]` in tiles. */
export type Bounds = readonly [number, number, number, number];

const extentOf = perFloor((floor) => {
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	let [bMinX, bMinY, bMaxX, bMaxY] = [Infinity, Infinity, -Infinity, -Infinity];
	floor.map.grid.forEach((row, y) =>
		row.forEach((t, x) => {
			if (t === 'void') return;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
			if (t === 'rock') return;
			bMinX = Math.min(bMinX, x);
			bMaxX = Math.max(bMaxX, x + 1);
			bMinY = Math.min(bMinY, y);
			bMaxY = Math.max(bMaxY, y + 1);
		})
	);
	return {
		dug: [minX, minY, maxX, maxY] as Bounds,
		built: [bMinX, bMinY, bMaxX, bMaxY] as Bounds
	};
});

/** Inclusive tile bounds of the dug area (everything but void): what "fit level" frames. */
export const floorBounds = (floor: Floor): Bounds => extentOf(floor).dug;

/** Bounds of the built tiles (no rock), with exclusive maxima. */
export const builtBounds = (floor: Floor): Bounds => extentOf(floor).built;
