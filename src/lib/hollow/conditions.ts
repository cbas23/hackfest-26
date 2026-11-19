/**
 * Power, water and air per housing block, from the state's points: a block is bad for a
 * kind when its centre is inside any point of that kind, and good otherwise. Nothing else
 * goes into it, and each kind is independent of the others.
 */
import type { PointKind, StatePoint } from './state.js';
import { perFloorWith, type Floor } from './world.js';

/** A point on this floor with the housing blocks it covers. */
export interface PointArea {
	point: StatePoint;
	/** Housing block (room) ids inside the point. */
	blocks: number[];
}

export interface FloorConditions {
	/** Kind → room id → bad (always false for rooms that aren't housing). */
	bad: Record<PointKind, boolean[]>;
	/** Every point on this floor, with its blocks. */
	areas: PointArea[];
}

/** Housing blocks whose centre is within `radius` tiles of (x, y). */
export function blocksInCircle(floor: Floor, x: number, y: number, radius: number) {
	const out: number[] = [];
	for (const r of floor.map.rooms) {
		if (!(floor.residents[r.id] > 0)) continue;
		if (Math.hypot(r.x + r.w / 2 - x, r.y + r.h / 2 - y) <= radius) out.push(r.id);
	}
	return out;
}

/** Conditions on `floor` given the city's points (all levels; it picks its own). */
export const conditionsOn = perFloorWith((floor: Floor, points: StatePoint[]): FloorConditions => {
	const none = () => floor.map.rooms.map(() => false);
	const bad = { power: none(), water: none(), air: none() };
	const areas = points
		.filter((p) => p.level === floor.index)
		.map((point) => ({
			point,
			blocks: blocksInCircle(floor, point.x + 0.5, point.y + 0.5, point.radius)
		}));
	for (const a of areas) for (const id of a.blocks) bad[a.point.kind][id] = true;
	return { bad, areas };
});

/** Residents with bad `kind` over some floors' conditions. */
export function conditionTotals(
	floors: { floor: Floor; conditions: FloorConditions }[],
	kind: PointKind
) {
	let residents = 0;
	let bad = 0;
	let blocks = 0;
	for (const { floor, conditions } of floors)
		floor.map.rooms.forEach((r) => {
			const n = floor.residents[r.id];
			if (!(n > 0)) return;
			residents += n;
			if (conditions.bad[kind][r.id]) {
				bad += n;
				blocks++;
			}
		});
	return { residents, bad, blocks, share: bad / Math.max(1, residents) };
}
