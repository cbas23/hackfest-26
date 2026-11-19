import { placesOn, type Place, type PlaceKind } from './nav.js';
import { STATUS_INFO, type FacilityStatus, type Status } from './sensors.js';
import { perFloor, type Floor } from './world.js';
import { SIM } from './simConfig.js';

/**
 * Infrastructure impact assessment (the Assess step): when a facility fails, which
 * neighborhoods depend on it and how many residents are affected.
 *
 * Simulated assumptions, stated plainly because none of this is measured:
 * - Neighborhoods are a 3×3 grid of districts over each floor's housing.
 * - A housing block depends on the nearest facility of each kind on its own floor,
 *   by walking distance through the tunnels (its "service area").
 * - Critical facilities cut service to every dependent resident; High risk ones to half.
 * - Normal and Warning facilities affect no one yet.
 * The rates are in `SIM.impact` (`simConfig.ts`).
 */

const SECTORS = [
	['North-West', 'North', 'North-East'],
	['West', 'Central', 'East'],
	['South-West', 'South', 'South-East']
];

export interface NeighborhoodImpact {
	id: string;
	name: string;
	/** Everyone living in the neighborhood. */
	population: number;
	/** Residents who depend on this facility. */
	dependent: number;
	/** Residents estimated to lose service. */
	affected: number;
	severity: Status;
	/** Housing block (room) ids that depend on the facility. */
	blocks: number[];
}

export interface ImpactAssessment {
	facility: Place;
	status: Status;
	/** Whether the facility's status is bad enough to affect residents. */
	active: boolean;
	neighborhoods: NeighborhoodImpact[];
	dependentTotal: number;
	affectedTotal: number;
}

interface FloorIndex {
	places: Place[];
	/** Housing block id → neighborhood index (0-8), for blocks with residents. */
	sector: Map<number, number>;
	sectorPopulation: number[];
	/** Cached service areas per facility kind: facility room id → dependent block ids. */
	areas: Map<PlaceKind, Map<number, number[]>>;
}

const indexFloor = perFloor((floor: Floor): FloorIndex => {
	const housing = floor.map.rooms.filter((r) => floor.residents[r.id] > 0);
	const cx = (r: (typeof housing)[number]) => r.x + r.w / 2;
	const cy = (r: (typeof housing)[number]) => r.y + r.h / 2;
	const minX = Math.min(...housing.map(cx));
	const maxX = Math.max(...housing.map(cx));
	const minY = Math.min(...housing.map(cy));
	const maxY = Math.max(...housing.map(cy));
	const third = (v: number, lo: number, hi: number) =>
		Math.min(2, Math.floor(((v - lo) / Math.max(1, hi - lo)) * 3));
	const sector = new Map<number, number>();
	const sectorPopulation = new Array(9).fill(0);
	for (const r of housing) {
		const s = third(cy(r), minY, maxY) * 3 + third(cx(r), minX, maxX);
		sector.set(r.id, s);
		sectorPopulation[s] += floor.residents[r.id];
	}
	return { places: placesOn(floor), sector, sectorPopulation, areas: new Map() };
});

/** Who serves each tunnel tile for one facility kind, and how far it is from its door. */
export interface ServiceReach {
	/** Tile index (y * width + x) → serving facility's room id, or -1 (unreachable). */
	owner: Int32Array;
	/** Tile index → walking distance in tiles from that facility's door (-1: unreachable). */
	dist: Int32Array;
	width: number;
}

const reachCache = perFloor(() => new Map<PlaceKind, ServiceReach>());

/**
 * A multi-source breadth-first search over tunnel tiles from the door of every facility of
 * one kind, so each tile goes to whichever facility reaches it first.
 */
export function serviceReach(floor: Floor, kind: PlaceKind): ServiceReach {
	const cache = reachCache(floor);
	const hit = cache.get(kind);
	if (hit) return hit;
	const { grid, width, height } = floor.map;
	const owner = new Int32Array(width * height).fill(-1);
	const dist = new Int32Array(width * height).fill(-1);
	const queue: number[] = [];
	for (const p of placesOn(floor)) {
		if (p.kind !== kind) continue;
		const t = p.room.access.y * width + p.room.access.x;
		if (owner[t] === -1) {
			owner[t] = p.room.id;
			dist[t] = 0;
			queue.push(t);
		}
	}
	for (let head = 0; head < queue.length; head++) {
		const t = queue[head];
		const x = t % width;
		const y = (t - x) / width;
		for (const [nx, ny] of [
			[x + 1, y],
			[x - 1, y],
			[x, y + 1],
			[x, y - 1]
		]) {
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
			const n = ny * width + nx;
			if (owner[n] !== -1 || grid[ny][nx] !== 'road') continue;
			owner[n] = owner[t];
			dist[n] = dist[t] + 1;
			queue.push(n);
		}
	}
	const reach = { owner, dist, width };
	cache.set(kind, reach);
	return reach;
}

/** The facility of one kind serving a room (by its door), and the walk there in tiles; null if none reaches it. */
export function servedBy(
	floor: Floor,
	kind: PlaceKind,
	room: { access: { x: number; y: number } }
) {
	const { owner, dist, width } = serviceReach(floor, kind);
	const t = room.access.y * width + room.access.x;
	return owner[t] === -1 ? null : { facility: owner[t], dist: dist[t] };
}

/** Split a floor's housing between all facilities of one kind (see `serviceReach`). */
function serviceAreas(floor: Floor, idx: FloorIndex, kind: PlaceKind) {
	const cached = idx.areas.get(kind);
	if (cached) return cached;
	const areas = new Map<number, number[]>();
	for (const p of idx.places) if (p.kind === kind) areas.set(p.room.id, []);
	for (const id of idx.sector.keys()) {
		const s = servedBy(floor, kind, floor.map.rooms[id]);
		if (s) areas.get(s.facility)?.push(id);
	}
	idx.areas.set(kind, areas);
	return areas;
}

/** A neighborhood's severity: the facility's status, softened when few residents depend on it. */
function severityOf(status: Status, dependentShare: number): Status {
	const order: Status[] = ['normal', 'warning', 'high', 'critical'];
	const { oneStep, twoSteps } = SIM.impact.soften;
	const drop = dependentShare >= oneStep ? 0 : dependentShare >= twoSteps ? 1 : 2;
	return order[Math.max(1, STATUS_INFO[status].rank - drop)];
}

/** Impact of a monitored facility's status (its sensor readings) on the floor it serves, or null. */
export function assessImpact(
	floor: Floor,
	facility: Place,
	sensors: Pick<FacilityStatus, 'status'> | null
): ImpactAssessment | null {
	if (facility.floor !== floor.index || !sensors) return null;
	const idx = indexFloor(floor);
	const blocks = serviceAreas(floor, idx, facility.kind).get(facility.room.id) ?? [];
	const exposure = SIM.impact.exposure[sensors.status];
	const active = exposure > 0;

	const bySector = new Map<number, number[]>();
	for (const id of blocks) {
		const s = idx.sector.get(id)!;
		const list = bySector.get(s);
		if (list) list.push(id);
		else bySector.set(s, [id]);
	}
	const neighborhoods = [...bySector].map(([s, ids]): NeighborhoodImpact => {
		const dependent = ids.reduce((sum, id) => sum + floor.residents[id], 0);
		const population = idx.sectorPopulation[s];
		return {
			id: `${floor.index}:${s}`,
			name: SECTORS[Math.floor(s / 3)][s % 3],
			population,
			dependent,
			affected: Math.round(dependent * exposure),
			severity: active ? severityOf(sensors.status, dependent / population) : 'normal',
			blocks: ids
		};
	});
	neighborhoods.sort((a, b) => b.dependent - a.dependent);

	const dependentTotal = neighborhoods.reduce((s, n) => s + n.dependent, 0);
	return {
		facility,
		status: sensors.status,
		active,
		neighborhoods,
		dependentTotal,
		affectedTotal: neighborhoods.reduce((s, n) => s + n.affected, 0)
	};
}

/** The neighborhood (3×3 district) a housing block belongs to, or null if nobody lives there. */
export function neighborhoodOf(floor: Floor, roomId: number) {
	const idx = indexFloor(floor);
	const s = idx.sector.get(roomId);
	if (s === undefined) return null;
	return {
		id: `${floor.index}:${s}`,
		name: SECTORS[Math.floor(s / 3)][s % 3],
		population: idx.sectorPopulation[s]
	};
}
