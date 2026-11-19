import { LEVELS } from './data.js';
import type { Place, PlaceKind } from './nav.js';
import { hashPair, SALT } from '#lib/random.js';
import { isActive, type FacilityEvent, type HollowEvents, type Severity } from './events.js';
import { SIM, streamSeed, type Metric, type MonitoredKind, type Status } from './simConfig.js';
import { perFloor, type Floor } from './world.js';

/**
 * Sensor readings for the Hollow's infrastructure (HollowWatch: the Detect step). All of
 * it is simulated.
 *
 * - Ventilation and water: read off their events (`airQuality` / `waterCuts` in Convex). A
 *   facility without an active event reads healthy; each event pushes one metric into its
 *   severity's band. Status is the worst reading.
 * - Clinics and plants: the stress model, derived from how strained the level is (deeper,
 *   hotter, worse air) plus a little per-facility noise. The starter scenario uses the same
 *   model to pick its first air and water events.
 *
 * Status always comes from fixed thresholds (`SIM.sensors.metrics`), never from an AI.
 */

export type { MonitoredKind, Status };

/** `color` is a CSS `var()` (see `layout.css`). */
export const STATUS_INFO: Record<Status, { label: string; color: string; rank: number }> = {
	normal: { label: 'Normal', color: 'var(--status-normal)', rank: 0 },
	warning: { label: 'Warning', color: 'var(--status-warning)', rank: 1 },
	high: { label: 'High risk', color: 'var(--status-high)', rank: 2 },
	critical: { label: 'Critical', color: 'var(--status-critical)', rank: 3 }
};

export interface Reading {
	key: string;
	label: string;
	value: number;
	text: string;
	status: Status;
}

export interface FacilityStatus {
	status: Status;
	readings: Reading[];
}

export const METRICS: Record<MonitoredKind, readonly Metric[]> = SIM.sensors.metrics;

export const isMonitored = (kind: PlaceKind): kind is MonitoredKind => kind in METRICS;

const rank = (s: Status) => STATUS_INFO[s].rank;
export const worstStatus = (statuses: Status[]) =>
	statuses.reduce<Status>((a, b) => (rank(b) > rank(a) ? b : a), 'normal');

function statusOf(m: Metric, v: number): Status {
	const worse =
		m.critical > m.good ? (a: number, b: number) => a >= b : (a: number, b: number) => a <= b;
	if (worse(v, m.critical)) return 'critical';
	if (worse(v, m.high)) return 'high';
	if (worse(v, m.warning)) return 'warning';
	return 'normal';
}

const reading = (m: Metric, value: number): Reading => ({
	key: m.key,
	label: m.label,
	value,
	text: `${value.toFixed(m.digits)} ${m.unit}`,
	status: statusOf(m, value)
});

/** A value well inside a severity's band: halfway to the next threshold, or past critical. */
export function bandValue(m: Metric, severity: Severity) {
	if (severity === 'warning') return (m.warning + m.high) / 2;
	if (severity === 'high') return (m.high + m.critical) / 2;
	return m.critical + (m.critical - m.high) * 0.3;
}

// ── Event-driven readings (air, water) ──────────────────────────────────────

/** A facility's sensor events, active ones only. */
export function facilityEvents(events: HollowEvents, place: Place): FacilityEvent[] {
	const list =
		place.kind === 'air' ? events.airQuality : place.kind === 'water' ? events.waterCuts : [];
	return list.filter((e) => e.facility === place.key && isActive(e));
}

/** Readings for a facility given its events (healthy where no event touches a metric). */
export function readingsFromEvents(
	floor: Floor,
	place: Place,
	kind: MonitoredKind,
	events: FacilityEvent[]
): FacilityStatus {
	const seed = floor.index ^ streamSeed(floor.seed, 'sensors');
	const readings = METRICS[kind].map((m, i): Reading => {
		const mine = events.filter((e) => e.metric === m.key);
		if (mine.length) {
			// The worst event on this metric sets its value.
			const worst = mine.reduce((a, b) => (rank(b.severity) > rank(a.severity) ? b : a));
			return reading(m, worst.value ?? bandValue(m, worst.severity));
		}
		const drift = hashPair(place.room.id * 31 + i, seed, SALT.sensors) * SIM.sensors.healthyDrift;
		return reading(m, m.good + (m.warning - m.good) * drift);
	});
	return { status: worstStatus(readings.map((r) => r.status)), readings };
}

// ── Stress model (clinics, plants, starter scenario) ────────────────────────

/** How strained a level is for one kind of infrastructure, 0 (fine) to 1 (failing). */
function stress(kind: MonitoredKind, floor: number) {
	const level = LEVELS[floor];
	const depth = floor / (LEVELS.length - 1);
	if (kind === 'air') return 1 - level.air;
	if (kind === 'clinic') return (1 - level.air) * 0.6 + depth * 0.4;
	if (kind === 'plant') return level.heat * 0.85;
	return depth * 0.9;
}

/** Per floor: room id → status from the stress model, filled as places are asked for. */
const stressCache = perFloor(() => new Map<number, FacilityStatus>());

/** Readings from the stress model (and the lore's pinned readings). */
export function stressReadings(floor: Floor, place: Place, kind: MonitoredKind): FacilityStatus {
	const cache = stressCache(floor);
	const hit = cache.get(place.room.id);
	if (hit) return hit;
	const s = stress(kind, floor.index);
	const pinned = floor.facilities.get(place.room.id)?.readings ?? {};
	const noiseSeed = floor.index ^ streamSeed(floor.seed, 'sensors');
	const readings = METRICS[kind].map((m, i): Reading => {
		// t = 0 is the healthy value, t = 1 the critical threshold.
		const noise = hashPair(place.room.id * 31 + i, noiseSeed, SALT.sensors);
		const jitter = (noise - 0.5) * SIM.sensors.jitter;
		const t = Math.min(1.1, Math.max(0, s * 0.95 + jitter - 0.05));
		return reading(m, pinned[m.key] ?? m.good + (m.critical - m.good) * t);
	});
	const result = { status: worstStatus(readings.map((r) => r.status)), readings };
	cache.set(place.room.id, result);
	return result;
}

/** Sensor readings and overall status for a place on `floor`, or null if it has no sensors. */
export function facilityStatus(
	floor: Floor,
	place: Place,
	events: HollowEvents
): FacilityStatus | null {
	if (!isMonitored(place.kind)) return null;
	if (place.kind === 'air' || place.kind === 'water')
		return readingsFromEvents(floor, place, place.kind, facilityEvents(events, place));
	return stressReadings(floor, place, place.kind);
}
