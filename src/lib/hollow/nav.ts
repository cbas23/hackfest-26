import type { Point, Room } from '#lib/tunnels/generate.js';
import {
	FACILITY_INFO,
	FLOOR_CONFIG,
	LEVELS,
	SHAFT_COLORS,
	SHAFTS,
	type FacilityKind
} from './data.js';
import { perFloor, type Floor, type Hollow } from './world.js';

const W = FLOOR_CONFIG.width;
const H = FLOOR_CONFIG.height;

/** Metres per tile. */
export const TILE_M = 4;
const WALK_MPS = 1.3;
const LIFT_MPS = 3;
const CHECKPOINT_S = 90;
const TURN_PENALTY_M = 3;

export type PlaceKind = 'block' | 'farm' | 'plant' | 'shaft' | FacilityKind;

export interface Place {
	key: string;
	floor: number;
	room: Room;
	kind: PlaceKind;
	label: string;
	/** Second line, e.g. "Habitation · L3 The Warrens". */
	sub: string;
	shaft?: number;
	/** Facilities only: lore line for the place card. */
	note?: string;
}

export interface RouteOptions {
	/** Directorate permit: allows riding restricted shafts upward. */
	permit: boolean;
	/** Allow the unmapped Old Mine Vent. */
	unregistered: boolean;
	/** Tunnel tiles that can't be passed on a floor ("x,y"), e.g. the blocked tunnels. */
	blocked?: (floor: number) => ReadonlySet<string>;
}

export interface Leg {
	floor: number;
	/** Tiles from door to door, inclusive. */
	path: Point[];
}

export interface Ride {
	shaft: number;
	from: number;
	to: number;
}

export interface Route {
	from: Place;
	to: Place;
	legs: Leg[];
	/** Shaft rides between consecutive legs. */
	rides: Ride[];
	walkMeters: number;
	liftMeters: number;
	seconds: number;
}

const DIRS: Point[] = [
	{ x: 0, y: -1 },
	{ x: 1, y: 0 },
	{ x: 0, y: 1 },
	{ x: -1, y: 0 }
];

const dirIndex = (a: Point, b: Point) => {
	const dx = Math.sign(b.x - a.x);
	const dy = Math.sign(b.y - a.y);
	return DIRS.findIndex((d) => d.x === dx && d.y === dy);
};

// ── Places ──────────────────────────────────────────────────────────────────
/** Every named place on a floor (cached per floor; treat the array as read-only). */
export const placesOn = perFloor((floor: Floor): Place[] => {
	const level = LEVELS[floor.index];
	const where = `${level.code} ${level.name}`;
	const out: Place[] = [];
	let farm = 0;
	let plant = 0;
	for (const r of floor.map.rooms) {
		const base = { key: `${floor.index}:${r.id}`, floor: floor.index, room: r };
		if (r.kind === 'gate') {
			const shaft = floor.shaftGates.indexOf(r);
			if (shaft < 0) continue;
			out.push({
				...base,
				kind: 'shaft',
				shaft,
				label: SHAFTS[shaft].name,
				sub: `Shaft landing · ${where}`
			});
		} else if (r.kind === 'farm') {
			out.push({
				...base,
				kind: 'farm',
				label: `${level.name} Farm ${++farm}`,
				sub: `Communal farm · ${where}`
			});
		} else if (r.kind === 'plant') {
			out.push({
				...base,
				kind: 'plant',
				label: `${level.name} Geothermal ${++plant}`,
				sub: `Geothermal plant · ${where}`
			});
		} else if (floor.facilities.has(r.id)) {
			const f = floor.facilities.get(r.id)!;
			out.push({
				...base,
				kind: f.kind,
				label: f.name,
				sub: `${FACILITY_INFO[f.kind].label} · ${where}`,
				note: f.note ?? FACILITY_INFO[f.kind].about
			});
		} else {
			out.push({
				...base,
				kind: 'block',
				label: `Block ${level.code}-${r.id}`,
				sub: `Habitation · ${where}`
			});
		}
	}
	return out;
});

/** Marker colour (a CSS colour) for each kind of place; shafts use their status colour. */
const KIND_COLOR: Record<Exclude<PlaceKind, 'shaft'>, string> = {
	block: 'var(--chart-1)',
	farm: 'var(--chart-2)',
	plant: 'var(--chart-3)',
	air: FACILITY_INFO.air.color,
	water: FACILITY_INFO.water.color,
	clinic: FACILITY_INFO.clinic.color,
	market: FACILITY_INFO.market.color,
	directorate: FACILITY_INFO.directorate.color
};

export const placeColor = (p: Place) =>
	p.kind === 'shaft' ? SHAFT_COLORS[SHAFTS[p.shaft!].status] : KIND_COLOR[p.kind];

/** Centre of a place's room, in tiles. */
export const placeCentre = (p: Place) => ({
	x: p.room.x + p.room.w / 2,
	y: p.room.y + p.room.h / 2
});

// ── Routing ─────────────────────────────────────────────────────────────────
class Heap {
	private k: number[] = [];
	private p: number[] = [];
	get size() {
		return this.k.length;
	}
	push(key: number, pri: number) {
		const { k, p } = this;
		k.push(key);
		p.push(pri);
		let i = k.length - 1;
		while (i > 0) {
			const up = (i - 1) >> 1;
			if (p[up] <= p[i]) break;
			[k[up], k[i]] = [k[i], k[up]];
			[p[up], p[i]] = [p[i], p[up]];
			i = up;
		}
	}
	pop(): [number, number] {
		const { k, p } = this;
		const top: [number, number] = [k[0], p[0]];
		const lk = k.pop()!;
		const lp = p.pop()!;
		if (k.length) {
			k[0] = lk;
			p[0] = lp;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1;
				const r = l + 1;
				let m = i;
				if (l < k.length && p[l] < p[m]) m = l;
				if (r < k.length && p[r] < p[m]) m = r;
				if (m === i) break;
				[k[m], k[i]] = [k[i], k[m]];
				[p[m], p[i]] = [p[i], p[m]];
				i = m;
			}
		}
		return top;
	}
}

const tileKey = (f: number, x: number, y: number) => (f * H + y) * W + x;
const unKey = (key: number) => {
	const x = key % W;
	const rest = (key - x) / W;
	const y = rest % H;
	return { f: (rest - y) / H, x, y };
};

/** Whether shaft `s` may be ridden from floor `from` to the adjacent floor `to`. */
export function canRide(s: number, from: number, to: number, opts: RouteOptions) {
	const { status } = SHAFTS[s];
	if (status === 'sealed') return false;
	if (status === 'unregistered') return opts.unregistered;
	// "Movement down is easy; movement up requires a permit."
	if (status === 'restricted' && to < from) return opts.permit;
	return true;
}

/** Ride cost in walking-metre equivalents, so the router trades lifts off against walking. */
function rideCost(s: number, from: number, to: number) {
	const metres = Math.abs(LEVELS[to].depth - LEVELS[from].depth);
	const seconds = metres / LIFT_MPS + (SHAFTS[s].status === 'restricted' ? CHECKPOINT_S : 0);
	return seconds * WALK_MPS;
}

export function findRoute(
	hollow: Hollow,
	from: Place,
	to: Place,
	opts: RouteOptions
): Route | null {
	return routeToNearest(hollow, from, [to], opts);
}

/**
 * The quickest route from `from` to whichever of `targets` is closest by travel time, or
 * null when none can be reached. One search, however many targets.
 */
export function routeToNearest(
	hollow: Hollow,
	from: Place,
	targets: Place[],
	opts: RouteOptions
): Route | null {
	const floors = LEVELS.map((_, i) => hollow.floor(i));
	const blocked = floors.map((fl) => opts.blocked?.(fl.index));
	const isRoad = (f: number, x: number, y: number) =>
		floors[f].map.grid[y]?.[x] === 'road' && !blocked[f]?.has(`${x},${y}`);
	// Access tile → shaft index, per floor.
	const shaftAt = new Map<number, number>();
	for (const fl of floors)
		fl.shaftGates.forEach((g, s) => {
			if (g) shaftAt.set(tileKey(fl.index, g.access.x, g.access.y), s);
		});

	const startKey = tileKey(from.floor, from.room.access.x, from.room.access.y);
	const goals = new Map(
		targets.map((t) => [tileKey(t.floor, t.room.access.x, t.room.access.y), t])
	);
	const startDir = Math.max(0, dirIndex(from.room.door, from.room.access));

	// Dijkstra over (tile, heading) so turns cost a little and paths stay straight.
	const dist = new Map<number, number>();
	const prev = new Map<number, number>();
	const heap = new Heap();
	const s0 = startKey * 4 + startDir;
	dist.set(s0, 0);
	heap.push(s0, 0);
	let goal = -1;

	while (heap.size) {
		const [state, d] = heap.pop();
		if (d > (dist.get(state) ?? Infinity)) continue;
		const key = state >> 2;
		const dir = state & 3;
		if (goals.has(key)) {
			goal = state;
			break;
		}
		const { f, x, y } = unKey(key);
		const relax = (nk: number, nd: number, cost: number) => {
			const ns = nk * 4 + nd;
			const next = d + cost;
			if (next < (dist.get(ns) ?? Infinity)) {
				dist.set(ns, next);
				prev.set(ns, state);
				heap.push(ns, next);
			}
		};
		for (let nd = 0; nd < 4; nd++) {
			const nx = x + DIRS[nd].x;
			const ny = y + DIRS[nd].y;
			if (!isRoad(f, nx, ny)) continue;
			const turn = nd === dir ? 0 : (nd + 2) % 4 === dir ? TURN_PENALTY_M * 4 : TURN_PENALTY_M;
			relax(tileKey(f, nx, ny), nd, TILE_M + turn);
		}
		const s = shaftAt.get(key);
		if (s === undefined) continue;
		for (const nf of [f - 1, f + 1]) {
			const gate = floors[nf]?.shaftGates[s];
			if (!gate || !canRide(s, f, nf, opts)) continue;
			const exitDir = Math.max(0, dirIndex(gate.door, gate.access));
			relax(tileKey(nf, gate.access.x, gate.access.y), exitDir, rideCost(s, f, nf));
		}
	}
	if (goal < 0) return null;
	const to = goals.get(goal >> 2)!;

	// Rebuild the tile path, one leg per floor visited.
	const states: number[] = [];
	for (let s: number | undefined = goal; s !== undefined; s = prev.get(s)) states.push(s);
	states.reverse();
	const legs: Leg[] = [];
	const hops: number[] = [];
	for (const s of states) {
		const { f, x, y } = unKey(s >> 2);
		const leg = legs[legs.length - 1];
		if (leg && leg.floor === f) {
			leg.path.push({ x, y });
			continue;
		}
		if (leg) {
			const end = leg.path[leg.path.length - 1];
			hops.push(shaftAt.get(tileKey(leg.floor, end.x, end.y))!);
		}
		legs.push({ floor: f, path: [{ x, y }] });
	}

	// Collapse consecutive hops on one shaft into a single ride: a leg that is just the
	// landing tile, entered and left by the same shaft, is a pass-through.
	const kept: Leg[] = [legs[0]];
	const rides: Ride[] = [];
	for (let i = 1; i < legs.length;) {
		const shaft = hops[i - 1];
		let j = i;
		while (j < legs.length - 1 && legs[j].path.length === 1 && hops[j] === shaft) j++;
		rides.push({ shaft, from: kept[kept.length - 1].floor, to: legs[j].floor });
		kept.push(legs[j]);
		i = j + 1;
	}

	// Extend each leg into its door tiles so the line reaches the building.
	kept.forEach((leg, i) => {
		const fl = floors[leg.floor];
		const startRoom = i === 0 ? from.room : fl.shaftGates[rides[i - 1].shaft];
		const endRoom = i === kept.length - 1 ? to.room : fl.shaftGates[rides[i].shaft];
		leg.path.unshift({ ...startRoom.door });
		leg.path.push({ ...endRoom.door });
	});

	const walkMeters = kept.reduce((sum, leg) => sum + (leg.path.length - 1) * TILE_M, 0);
	let liftMeters = 0;
	let checkpoints = 0;
	for (const r of rides) {
		liftMeters += Math.abs(LEVELS[r.to].depth - LEVELS[r.from].depth);
		if (SHAFTS[r.shaft].status === 'restricted') checkpoints += Math.abs(r.to - r.from);
	}
	const seconds = walkMeters / WALK_MPS + liftMeters / LIFT_MPS + checkpoints * CHECKPOINT_S;
	return { from, to, legs: kept, rides, walkMeters, liftMeters, seconds };
}
