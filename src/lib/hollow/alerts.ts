import { LEVELS } from './data.js';
import { assessImpact, neighborhoodOf } from './impact.js';
import { placesOn, type Place } from './nav.js';
import { facilityStatus, STATUS_INFO, type Status } from './sensors.js';
import type { Floor } from './world.js';

/**
 * Blackout and air alerts (simulated). Two sources, both already in the world:
 * - Blackouts: housing blocks that are dark (`floor.lit`), grouped by neighborhood. A
 *   neighborhood's severity is the share of its residents left in the dark.
 * - Air: ventilation facilities whose sensors read Warning or worse, with the blocks that
 *   depend on them (their service area, see impact.ts).
 * Everything is derived from the seeded world, so the same seed always raises the same alerts.
 */

export type AlertKind = 'blackout' | 'air';

export interface HollowAlert {
	id: string;
	kind: AlertKind;
	severity: Status;
	floor: number;
	title: string;
	/** Where, e.g. "North-East · L3 The Warrens". */
	where: string;
	detail: string;
	/** Residents affected (in the dark, or breathing bad air). */
	residents: number;
	/** Housing block (room) ids covered by the alert. */
	blocks: number[];
	/** Tile point to pin and fly to. */
	x: number;
	y: number;
	/** The failing facility, for air alerts. */
	place?: Place;
}

/** What an alert lens paints on a block. */
export interface BlockAlert {
	blackout?: Status;
	air?: Status;
}

export interface FloorAlerts {
	alerts: HollowAlert[];
	/** Room id → the alerts touching that block. */
	blocks: Map<number, BlockAlert>;
	/** Air facilities currently alerting (room ids), drawn bright under the lens. */
	sources: Set<number>;
}

const rank = (s: Status) => STATUS_INFO[s].rank;
const worse = (a: Status | undefined, b: Status) => (!a || rank(b) > rank(a) ? b : a);

function blackoutSeverity(darkShare: number): Status {
	if (darkShare >= 0.5) return 'critical';
	if (darkShare >= 0.25) return 'high';
	return 'warning';
}

/** Middle of the biggest block, so the pin lands on something solid. */
function anchor(floor: Floor, ids: number[]) {
	let best = floor.map.rooms[ids[0]];
	for (const id of ids) {
		const r = floor.map.rooms[id];
		if (r.w * r.h > best.w * best.h) best = r;
	}
	return { x: best.x + best.w / 2, y: best.y + best.h / 2 };
}

const cache = new Map<number, FloorAlerts>();

/** Every blackout and air alert on one floor, worst first. */
export function alertsOn(floor: Floor): FloorAlerts {
	const hit = cache.get(floor.index);
	if (hit) return hit;
	const level = LEVELS[floor.index];
	const blocks = new Map<number, BlockAlert>();
	const mark = (id: number, key: keyof BlockAlert, s: Status) => {
		const b = blocks.get(id) ?? {};
		b[key] = worse(b[key], s);
		blocks.set(id, b);
	};
	const alerts: HollowAlert[] = [];

	// Blackouts, one alert per neighborhood with dark blocks.
	const dark = new Map<string, { name: string; population: number; ids: number[] }>();
	for (const r of floor.map.rooms) {
		if (r.kind !== 'room' || floor.lit[r.id] || !(floor.residents[r.id] > 0)) continue;
		const n = neighborhoodOf(floor, r.id);
		if (!n) continue;
		const group = dark.get(n.id) ?? { name: n.name, population: n.population, ids: [] };
		group.ids.push(r.id);
		dark.set(n.id, group);
	}
	for (const [id, g] of dark) {
		const residents = g.ids.reduce((s, b) => s + floor.residents[b], 0);
		const severity = blackoutSeverity(residents / Math.max(1, g.population));
		for (const b of g.ids) mark(b, 'blackout', severity);
		alerts.push({
			id: `blackout:${id}`,
			kind: 'blackout',
			severity,
			floor: floor.index,
			title: 'Blackout',
			where: `${g.name} · ${level.code} ${level.name}`,
			detail: `${g.ids.length} block${g.ids.length === 1 ? '' : 's'} without power`,
			residents,
			blocks: g.ids,
			...anchor(floor, g.ids)
		});
	}

	// Air: ventilation that reads Warning or worse, and the blocks it serves.
	const sources = new Set<number>();
	for (const p of placesOn(floor)) {
		if (p.kind !== 'air') continue;
		const sensors = facilityStatus(p);
		if (!sensors || sensors.status === 'normal') continue;
		const impact = assessImpact(floor, p);
		if (!impact) continue;
		const ids = impact.neighborhoods.flatMap((n) => n.blocks);
		const severity = sensors.status;
		sources.add(p.room.id);
		for (const n of impact.neighborhoods)
			for (const b of n.blocks) mark(b, 'air', impact.active ? n.severity : 'warning');
		const worst = sensors.readings.reduce((a, b) => (rank(b.status) > rank(a.status) ? b : a));
		alerts.push({
			id: `air:${p.key}`,
			kind: 'air',
			severity,
			floor: floor.index,
			title: severity === 'warning' ? 'Air quality warning' : 'Air quality alert',
			where: `${p.label} · ${level.code} ${level.name}`,
			detail: `${worst.label} ${worst.text}`,
			residents: impact.active ? impact.affectedTotal : impact.dependentTotal,
			blocks: ids,
			x: p.room.x + p.room.w / 2,
			y: p.room.y + p.room.h / 2,
			place: p
		});
	}

	alerts.sort((a, b) => rank(b.severity) - rank(a.severity) || b.residents - a.residents);
	const result = { alerts, blocks, sources };
	cache.set(floor.index, result);
	return result;
}

export interface AlertTotals {
	count: number;
	critical: number;
	blackoutResidents: number;
	airResidents: number;
}

export function alertTotals(alerts: HollowAlert[]): AlertTotals {
	let critical = 0;
	let blackoutResidents = 0;
	let airResidents = 0;
	for (const a of alerts) {
		if (a.severity === 'critical') critical++;
		if (a.kind === 'blackout') blackoutResidents += a.residents;
		else airResidents += a.residents;
	}
	return { count: alerts.length, critical, blackoutResidents, airResidents };
}
