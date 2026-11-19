/**
 * Power on a floor, from its blackout events. A blackout darkens every housing block whose
 * centre lies inside its circle; facilities, farms, plants and shafts keep their own supply.
 * Only active blackouts darken anything; resolved ones still know their blocks (for the
 * control center and the "fixed" list).
 */
import { isActive, type BlackoutEvent } from './events.js';
import { perFloorWith, type Floor } from './world.js';

export interface Outage {
	event: BlackoutEvent;
	/** Housing block (room) ids inside the blackout. */
	blocks: number[];
}

export interface FloorPower {
	/** Room id → has power. */
	lit: boolean[];
	/** Share of housing blocks with power. */
	litShare: number;
	/** Every blackout on this floor (active and resolved) with its blocks. */
	outages: Outage[];
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

/** Power on `floor` given the city's blackouts (all levels; it picks its own). */
export const powerOn = perFloorWith((floor: Floor, blackouts: BlackoutEvent[]): FloorPower => {
	const outages = blackouts
		.filter((b) => b.level === floor.index)
		.map((event) => ({ event, blocks: blocksInCircle(floor, event.x, event.y, event.radius) }));
	const lit = floor.map.rooms.map(() => true);
	for (const o of outages) if (isActive(o.event)) for (const id of o.blocks) lit[id] = false;
	let housing = 0;
	let powered = 0;
	for (const r of floor.map.rooms)
		if (floor.residents[r.id] > 0) {
			housing++;
			if (lit[r.id]) powered++;
		}
	return { lit, litShare: powered / Math.max(1, housing), outages };
});
