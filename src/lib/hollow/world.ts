import {
	generateTunnelMap,
	type GateSpec,
	type Room,
	type Side,
	type TunnelMap
} from '#lib/tunnels/generate.js';
import { FLOOR_CONFIG, LEVELS, SHAFTS, type FacilitySpec } from './data.js';

export interface Floor {
	index: number;
	map: TunnelMap;
	/** Gate room for each shaft index (same coordinates on every floor). */
	shaftGates: Room[];
	/** Room id → is the block currently powered. */
	lit: boolean[];
	/** Room id → estimated residents (habitation blocks only). */
	residents: number[];
	litShare: number;
	/** Room id → the civic facility housed there (ventilation, water, clinic…). */
	facilities: Map<number, FacilitySpec>;
}

export interface Hollow {
	seed: number;
	/** Gate positions shared by every floor, one per shaft. */
	gateSpecs: GateSpec[];
	/** Floors are generated lazily — ~200 ms each at 250×200. */
	floor(index: number): Floor;
	isReady(index: number): boolean;
}

const sideOf = (r: Room): Side => {
	const dx = r.access.x - r.door.x;
	const dy = r.access.y - r.door.y;
	return dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
};

/** Cheap deterministic hash → [0, 1). */
const hash01 = (a: number, b: number) => {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	return (h >>> 0) / 4294967296;
};

const floorSeed = (seed: number, index: number) => seed * 31 + index * 7919;

/**
 * Put each of a level's facilities in a roomy chamber (at least 3×3), spreading them
 * across the city: each pick is the candidate furthest from those already chosen,
 * with a little seeded noise so layouts don't all hug the edge.
 */
function placeFacilities(map: TunnelMap, specs: FacilitySpec[], seed: number) {
	const out = new Map<number, FacilitySpec>();
	const candidates = map.rooms.filter((r) => r.kind === 'room' && Math.min(r.w, r.h) >= 3);
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
			const spread = chosen.length
				? Math.min(...chosen.map((o) => Math.hypot(o.x - c.x, o.y - c.y)))
				: 60 - Math.hypot(c.x - cx, c.y - cy) * 0.5;
			// Cap the spread so picks don't all run to the rim; noise breaks ties.
			const score = Math.min(spread, 45) + hash01(r.id, seed) * 12 + r.w * r.h * 0.2;
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

export function createHollow(seed: number): Hollow {
	// The Crown is generated first; its random gates become the fixed shaft positions
	// that every other floor is built around. Retry until all six shafts fit.
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

	const cache = new Map<number, Floor>();

	const build = (index: number, map: TunnelMap): Floor => {
		const level = LEVELS[index];
		const gates = map.rooms.filter((r) => r.kind === 'gate');
		const shaftGates = gateSpecs.map((_, i) => gates.find((g) => g.specIndex === i) ?? gates[i]);
		const facilities = placeFacilities(map, level.facilities, floorSeed(seed, index));
		// Deeper floors lose power first: share of lit blocks tracks the level's light.
		// Facilities and infrastructure are kept powered.
		const lit = map.rooms.map(
			(r) =>
				r.kind !== 'room' ||
				facilities.has(r.id) ||
				hash01(r.id, floorSeed(seed, index)) < 0.15 + level.light * 0.85
		);
		const housing = map.rooms.filter((r) => r.kind === 'room' && !facilities.has(r.id));
		const area = housing.reduce((s, r) => s + r.w * r.h, 0);
		const perTile = (level.population * 1e6) / Math.max(1, area);
		const residents = map.rooms.map((r) =>
			r.kind === 'room' && !facilities.has(r.id) ? Math.round(r.w * r.h * perTile) : 0
		);
		const litShare = housing.filter((r) => lit[r.id]).length / Math.max(1, housing.length);
		return { index, map, shaftGates, lit, residents, litShare, facilities };
	};

	cache.set(0, build(0, crown!));

	return {
		seed,
		gateSpecs,
		isReady: (index) => cache.has(index),
		floor(index) {
			let f = cache.get(index);
			if (!f) {
				const level = LEVELS[index];
				const map = generateTunnelMap({
					...FLOOR_CONFIG,
					seed: floorSeed(seed, index),
					gates: gateSpecs,
					cityScale: level.cityScale,
					features: level.features
				});
				f = build(index, map);
				cache.set(index, f);
			}
			return f;
		}
	};
}

/** Shaft index for a gate room on a given floor, or -1. */
export const shaftOf = (floor: Floor, room: Room | null | undefined) =>
	room ? floor.shaftGates.findIndex((g) => g?.id === room.id) : -1;
