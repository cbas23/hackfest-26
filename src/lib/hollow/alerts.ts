import { LEVELS } from './data.js';
import { isActive, type EventRef, type FacilityEvent } from './events.js';
import { assessImpact, neighborhoodOf } from './impact.js';
import { placeCentre, type Place } from './nav.js';
import {
	readingsFromEvents,
	STATUS_INFO,
	type FacilityStatus,
	type Reading,
	type Status
} from './sensors.js';
import type { FloorSimulation } from './simulation.js';
import type { Floor } from './world.js';

/**
 * Blackout, air and water alerts (simulated), read off the floor's events. Each kind is
 * independent: a blackout doesn't stall the vents or the pumps.
 * - Blackouts: one alert per blackout event, over the housing blocks it darkens. Its
 *   severity is the share of the touched neighborhoods' residents left in the dark.
 * - Air / water: one alert per ventilation or water facility with active events, with the
 *   blocks that depend on it (its service area, see impact.ts).
 *
 * Alerts for resolved events are kept apart (`resolved`), for the "fixed" list.
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
	/** Residents who depend on the facility (air and water) or are in the dark (blackouts). */
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
	/** Its worst reading's metric key (e.g. `output` for a water supply cut). */
	metric?: string;
	/** The events behind the alert: fixing it resolves all of them. */
	events: EventRef[];
}

/** What an alert lens paints on a block. */
export type BlockAlert = Partial<Record<AlertKind, Status>>;

export interface FloorAlerts {
	/** Active alerts, worst first. */
	alerts: HollowAlert[];
	/** Alerts whose events were all resolved. */
	resolved: HollowAlert[];
	/** Room id → the active alerts touching that block. */
	blocks: Map<number, BlockAlert>;
	/** Facilities currently alerting (room id → kind), drawn bright under the lens. */
	sources: Map<number, AlertKind>;
}

const rank = (s: Status) => STATUS_INFO[s].rank;
const worse = (a: Status | undefined, b: Status) => (!a || rank(b) > rank(a) ? b : a);

function blackoutSeverity(darkShare: number): Status {
	if (darkShare >= 0.5) return 'critical';
	if (darkShare >= 0.25) return 'high';
	return 'warning';
}

/** What a failing reading means, in plain words. */
const READING_CAUSE: Record<string, string> = {
	co2: 'CO₂ building up',
	pm25: 'Dust in the air',
	airflow: 'Airflow dropping',
	turbidity: 'Silt in the supply',
	chlorine: 'Not disinfected',
	output: 'Recycler failing'
};

/** Public notice for a water alert, by severity: quality problems, and supply cuts. */
const WATER_TITLE: Record<Status, string> = {
	normal: 'Water normal',
	warning: 'Boil-water advisory',
	high: 'Do-not-drink notice',
	critical: 'Water contamination'
};
const SUPPLY_TITLE: Record<Status, string> = {
	normal: 'Water normal',
	warning: 'Low water pressure',
	high: 'Water rationing',
	critical: 'Water cut'
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

function blackoutAlerts(sim: FloorSimulation): HollowAlert[] {
	const { floor } = sim;
	const level = LEVELS[floor.index];
	const out: HollowAlert[] = [];
	for (const { event, blocks } of sim.power.outages) {
		if (!blocks.length) continue;
		const residents = blocks.reduce((s, b) => s + floor.residents[b], 0);
		// The share of the touched neighborhoods left in the dark.
		const touched = new Map<string, { name: string; population: number; dark: number }>();
		for (const b of blocks) {
			const n = neighborhoodOf(floor, b);
			if (!n) continue;
			const t = touched.get(n.id) ?? { name: n.name, population: n.population, dark: 0 };
			t.dark += floor.residents[b];
			touched.set(n.id, t);
		}
		const groups = [...touched.values()].sort((a, b) => b.dark - a.dark);
		const population = groups.reduce((s, g) => s + g.population, 0);
		out.push({
			id: `blackout:${event.id}`,
			kind: 'blackout',
			severity: blackoutSeverity(residents / Math.max(1, population)),
			floor: floor.index,
			title: 'Blackout',
			where: `${groups[0]?.name ?? 'Unknown'} · ${level.code} ${level.name}`,
			detail: `${blocks.length} block${blocks.length === 1 ? '' : 's'} without power`,
			residents,
			dependents: residents,
			blocks,
			chain: [],
			events: [{ table: 'blackouts', id: event.id }],
			...anchor(floor, blocks)
		});
	}
	return out;
}

function facilityAlert(
	sim: FloorSimulation,
	p: Place & { kind: 'air' | 'water' },
	events: FacilityEvent[],
	sensors: FacilityStatus
): HollowAlert | null {
	const { floor } = sim;
	const level = LEVELS[floor.index];
	const kind = p.kind;
	const impact = assessImpact(floor, p, sensors);
	if (!impact || sensors.status === 'normal') return null;
	const severity = sensors.status;
	const worst = worstReading(sensors.readings);
	const chain: ChainStep[] = [
		{ kind, label: READING_CAUSE[worst.key] ?? worst.label },
		{
			kind,
			label: kind === 'air' ? 'Bad air' : worst.key === 'output' ? 'No water' : 'Unsafe water'
		}
	];
	if (rank(severity) >= rank('high'))
		chain.push({
			kind: 'sickness',
			label: kind === 'air' ? 'Lung sickness risk' : 'Waterborne illness risk'
		});
	const titles = kind === 'air' ? AIR_TITLE : worst.key === 'output' ? SUPPLY_TITLE : WATER_TITLE;
	return {
		id: `${kind}:${p.key}`,
		kind,
		severity,
		floor: floor.index,
		title: titles[severity],
		where: `${p.label} · ${level.code} ${level.name}`,
		detail: `${worst.label} ${worst.text}`,
		residents: impact.active ? impact.affectedTotal : impact.dependentTotal,
		dependents: impact.dependentTotal,
		blocks: impact.neighborhoods.flatMap((n) => n.blocks),
		...placeCentre(p),
		chain,
		place: p,
		metric: worst.key,
		events: events.map((e) => ({ table: kind === 'air' ? 'airQuality' : 'waterCuts', id: e.id }))
	};
}

/** Every blackout, air and water alert on one floor, from its events. */
export function alertsOn(sim: FloorSimulation): FloorAlerts {
	const { floor, events } = sim;
	const blocks = new Map<number, BlockAlert>();
	const sources = new Map<number, AlertKind>();
	const mark = (id: number, kind: AlertKind, s: Status) => {
		const b = blocks.get(id) ?? {};
		b[kind] = worse(b[kind], s);
		blocks.set(id, b);
	};
	const alerts: HollowAlert[] = [];
	const resolved: HollowAlert[] = [];

	const outages = new Map(sim.power.outages.map((o) => [o.event.id, o.event]));
	for (const a of blackoutAlerts(sim)) {
		if (isActive(outages.get(a.events[0].id)!)) {
			alerts.push(a);
			for (const b of a.blocks) mark(b, 'blackout', a.severity);
		} else resolved.push(a);
	}

	for (const p of sim.places) {
		if (p.kind !== 'air' && p.kind !== 'water') continue;
		const place = p as Place & { kind: 'air' | 'water' };
		const all = (p.kind === 'air' ? events.airQuality : events.waterCuts).filter(
			(e) => e.facility === p.key
		);
		if (!all.length) continue;
		const active = all.filter(isActive);
		if (active.length) {
			const a = facilityAlert(sim, place, active, sim.status(p)!);
			if (!a) continue;
			alerts.push(a);
			sources.set(p.room.id, a.kind);
			const impact = sim.impact(p);
			for (const n of impact?.neighborhoods ?? [])
				for (const b of n.blocks) mark(b, a.kind, impact!.active ? n.severity : 'warning');
		} else {
			// Every event fixed: how it looked before, for the "fixed" list.
			const before = readingsFromEvents(floor, p, place.kind, all);
			const a = facilityAlert(sim, place, all, before);
			if (a) resolved.push(a);
		}
	}

	alerts.sort((a, b) => rank(b.severity) - rank(a.severity) || b.residents - a.residents);
	return { alerts, resolved, blocks, sources };
}

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
