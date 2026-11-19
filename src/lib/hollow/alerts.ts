import { LEVELS } from './data.js';
import { assessImpact, neighborhoodOf } from './impact.js';
import { placeCentre, placesOn, type Place } from './nav.js';
import { facilityStatus, STATUS_INFO, type Reading, type Status } from './sensors.js';
import { perFloor, type Floor } from './world.js';

/**
 * Blackout, air and water alerts (simulated). All three come from the seeded world:
 * - Blackouts: housing blocks that are dark (`floor.lit`), grouped by neighborhood. A
 *   neighborhood's severity is the share of its residents left in the dark.
 * - Air / water: ventilation and water facilities whose sensors read Warning or worse, with
 *   the blocks that depend on them (their service area, see impact.ts).
 *
 * Each air and water alert carries a cause chain, read off the same data: when most of a
 * facility's service area is dark, the chain starts at the power cut (fans and pumps stall),
 * then the failing reading, then the effect on residents. That is the story the map tells:
 * one blackout cuts the vents and the pumps, and people get sick.
 */

export type AlertKind = 'blackout' | 'air' | 'water';

export const ALERT_KINDS: AlertKind[] = ['blackout', 'air', 'water'];

/** One link in an alert's cause chain. */
export interface ChainStep {
	kind: AlertKind | 'sickness';
	label: string;
}

export interface HollowAlert {
	id: string;
	kind: AlertKind;
	severity: Status;
	floor: number;
	title: string;
	/** Where, e.g. "North-East · L3 The Warrens". */
	where: string;
	detail: string;
	/** Residents affected (in the dark, breathing bad air, or on unsafe water). */
	residents: number;
	/** Residents who depend on the facility (air and water), for the power-starved test. */
	dependents: number;
	/** Housing block (room) ids covered by the alert. */
	blocks: number[];
	/** Tile point to pin and fly to. */
	x: number;
	y: number;
	/** Cause → effect, for air and water alerts. */
	chain: ChainStep[];
	/** The failing facility, for air and water alerts. */
	place?: Place;
}

/** What an alert lens paints on a block. */
export type BlockAlert = Partial<Record<AlertKind, Status>>;

export interface FloorAlerts {
	alerts: HollowAlert[];
	/** Room id → the alerts touching that block. */
	blocks: Map<number, BlockAlert>;
	/** Facilities currently alerting (room id → kind), drawn bright under the lens. */
	sources: Map<number, AlertKind>;
	/** Room id → the alert id that paints it, per kind (each block has at most one per kind). */
	owner: Map<number, Partial<Record<AlertKind, string>>>;
	/** Facility room id → its alert id. */
	sourceOwner: Map<number, string>;
}

const rank = (s: Status) => STATUS_INFO[s].rank;
const worse = (a: Status | undefined, b: Status) => (!a || rank(b) > rank(a) ? b : a);

function blackoutSeverity(darkShare: number): Status {
	if (darkShare >= 0.5) return 'critical';
	if (darkShare >= 0.25) return 'high';
	return 'warning';
}

/** A service area counts as power-starved when this share of its residents is in the dark. */
export const STARVED = 0.3;

/** What a failing reading means, in plain words. */
const READING_CAUSE: Record<string, string> = {
	co2: 'CO₂ building up',
	pm25: 'Dust in the air',
	airflow: 'Airflow dropping',
	turbidity: 'Silt in the supply',
	chlorine: 'Not disinfected',
	output: 'Recycler failing'
};

/** Public notice for a water alert, by severity. */
const WATER_TITLE: Record<Status, string> = {
	normal: 'Water normal',
	warning: 'Boil-water advisory',
	high: 'Do-not-drink notice',
	critical: 'Water contamination'
};

const AIR_TITLE: Record<Status, string> = {
	normal: 'Air normal',
	warning: 'Air quality warning',
	high: 'Air quality alert',
	critical: 'Air emergency'
};

/** Middle of the biggest block, so the pin lands on something solid. */
function anchor(floor: Floor, ids: number[]) {
	let best = floor.map.rooms[ids[0]];
	for (const id of ids) {
		const r = floor.map.rooms[id];
		if (r.w * r.h > best.w * best.h) best = r;
	}
	return { x: best.x + best.w / 2, y: best.y + best.h / 2 };
}

const worstReading = (readings: Reading[]) =>
	readings.reduce((a, b) => (rank(b.status) > rank(a.status) ? b : a));

/** Every blackout, air and water alert on one floor, worst first. */
export const alertsOn = perFloor((floor: Floor): FloorAlerts => {
	const level = LEVELS[floor.index];
	const blocks = new Map<number, BlockAlert>();
	const owner = new Map<number, Partial<Record<AlertKind, string>>>();
	const sourceOwner = new Map<number, string>();
	const mark = (id: number, kind: AlertKind, s: Status, alertId: string) => {
		const b = blocks.get(id) ?? {};
		b[kind] = worse(b[kind], s);
		blocks.set(id, b);
		const o = owner.get(id) ?? {};
		o[kind] = alertId;
		owner.set(id, o);
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
		for (const b of g.ids) mark(b, 'blackout', severity, `blackout:${id}`);
		alerts.push({
			id: `blackout:${id}`,
			kind: 'blackout',
			severity,
			floor: floor.index,
			title: 'Blackout',
			where: `${g.name} · ${level.code} ${level.name}`,
			detail: `${g.ids.length} block${g.ids.length === 1 ? '' : 's'} without power`,
			residents,
			dependents: residents,
			blocks: g.ids,
			chain: [],
			...anchor(floor, g.ids)
		});
	}

	// Air and water: facilities that read Warning or worse, and the blocks they serve.
	const sources = new Map<number, AlertKind>();
	for (const p of placesOn(floor)) {
		if (p.kind !== 'air' && p.kind !== 'water') continue;
		const kind: AlertKind = p.kind;
		const sensors = facilityStatus(floor, p);
		if (!sensors || sensors.status === 'normal') continue;
		const impact = assessImpact(floor, p);
		if (!impact) continue;
		const ids = impact.neighborhoods.flatMap((n) => n.blocks);
		const severity = sensors.status;
		const alertId = `${kind}:${p.key}`;
		sources.set(p.room.id, kind);
		sourceOwner.set(p.room.id, alertId);
		for (const n of impact.neighborhoods)
			for (const b of n.blocks) mark(b, kind, impact.active ? n.severity : 'warning', alertId);

		const darkResidents = ids.reduce((s, b) => s + (floor.lit[b] ? 0 : floor.residents[b]), 0);
		const starved = darkResidents / Math.max(1, impact.dependentTotal) >= STARVED;
		const worst = worstReading(sensors.readings);
		const chain: ChainStep[] = [];
		if (starved) {
			chain.push({ kind: 'blackout', label: 'Power cuts' });
			chain.push({ kind, label: kind === 'air' ? 'Fans stall' : 'Pumps stall' });
		}
		chain.push({ kind, label: READING_CAUSE[worst.key] ?? worst.label });
		chain.push({ kind, label: kind === 'air' ? 'Bad air' : 'Unsafe water' });
		if (rank(severity) >= rank('high'))
			chain.push({
				kind: 'sickness',
				label: kind === 'air' ? 'Lung sickness risk' : 'Waterborne illness risk'
			});

		alerts.push({
			id: alertId,
			kind,
			severity,
			floor: floor.index,
			title: (kind === 'air' ? AIR_TITLE : WATER_TITLE)[severity],
			where: `${p.label} · ${level.code} ${level.name}`,
			detail: `${worst.label} ${worst.text}`,
			residents: impact.active ? impact.affectedTotal : impact.dependentTotal,
			dependents: impact.dependentTotal,
			blocks: ids,
			...placeCentre(p),
			chain,
			place: p
		});
	}

	alerts.sort((a, b) => rank(b.severity) - rank(a.severity) || b.residents - a.residents);
	return { alerts, blocks, sources, owner, sourceOwner };
});

export interface AlertTotals {
	count: number;
	critical: number;
	residents: Record<AlertKind, number>;
	counts: Record<AlertKind, number>;
}

export function alertTotals(alerts: HollowAlert[]): AlertTotals {
	const residents: Record<AlertKind, number> = { blackout: 0, air: 0, water: 0 };
	const counts: Record<AlertKind, number> = { blackout: 0, air: 0, water: 0 };
	let critical = 0;
	for (const a of alerts) {
		if (a.severity === 'critical') critical++;
		residents[a.kind] += a.residents;
		counts[a.kind]++;
	}
	return { count: alerts.length, critical, residents, counts };
}

/** Per-kind look shared by the HUD, list and pins. */
export const ALERT_INFO: Record<AlertKind | 'sickness', { label: string; color: string }> = {
	blackout: { label: 'Power', color: '#f43f5e' },
	air: { label: 'Air', color: '#38bdf8' },
	water: { label: 'Water', color: '#84cc16' },
	sickness: { label: 'Sickness', color: '#f97316' }
};
