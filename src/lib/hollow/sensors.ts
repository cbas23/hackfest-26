import { LEVELS } from './data.js';
import type { Place, PlaceKind } from './nav.js';
import { hashPair, SALT } from '#lib/random.js';
import { SIM, streamSeed, type Metric, type MonitoredKind, type Status } from './simConfig.js';
import { perFloor, type Floor } from './world.js';

/**
 * Simulated sensor readings for the Hollow's infrastructure (HollowWatch: the Detect step).
 *
 * Values are generated, not measured: each one is derived from how stressed the level is
 * (deeper, hotter, worse air) plus a little per-facility noise, so the same seed always
 * gives the same readings. Status comes from fixed thresholds (`SIM.sensors.metrics`), never
 * from an AI. Readings pinned to the lore are on the facilities in `data.ts`.
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

const METRICS: Record<MonitoredKind, readonly Metric[]> = SIM.sensors.metrics;

/** How strained a level is for one kind of infrastructure, 0 (fine) to 1 (failing). */
function stress(kind: MonitoredKind, floor: number) {
	const level = LEVELS[floor];
	const depth = floor / (LEVELS.length - 1);
	if (kind === 'air') return 1 - level.air;
	if (kind === 'clinic') return (1 - level.air) * 0.6 + depth * 0.4;
	if (kind === 'plant') return level.heat * 0.85;
	return depth * 0.9;
}

function statusOf(m: Metric, v: number): Status {
	const worse =
		m.critical > m.good ? (a: number, b: number) => a >= b : (a: number, b: number) => a <= b;
	if (worse(v, m.critical)) return 'critical';
	if (worse(v, m.high)) return 'high';
	if (worse(v, m.warning)) return 'warning';
	return 'normal';
}

const worst = (statuses: Status[]) =>
	statuses.reduce<Status>((a, b) => (STATUS_INFO[b].rank > STATUS_INFO[a].rank ? b : a), 'normal');

const isMonitored = (kind: PlaceKind): kind is MonitoredKind => kind in METRICS;

/** Per floor: room id → status, filled as places are asked for. */
const statusCache = perFloor(() => new Map<number, FacilityStatus | null>());

/** Sensor readings and overall status for a place on `floor`, or null if it has no sensors. */
export function facilityStatus(floor: Floor, place: Place): FacilityStatus | null {
	const cache = statusCache(floor);
	const hit = cache.get(place.room.id);
	if (hit !== undefined) return hit;
	let result: FacilityStatus | null = null;
	if (isMonitored(place.kind)) {
		const s = stress(place.kind, floor.index);
		const pinned = floor.facilities.get(place.room.id)?.readings ?? {};
		const noiseSeed = floor.index ^ streamSeed(floor.seed, 'sensors');
		const readings = METRICS[place.kind].map((m, i): Reading => {
			// t = 0 is the healthy value, t = 1 the critical threshold.
			const noise = hashPair(place.room.id * 31 + i, noiseSeed, SALT.sensors);
			const jitter = (noise - 0.5) * SIM.sensors.jitter;
			const t = Math.min(1.1, Math.max(0, s * 0.95 + jitter - 0.05));
			const value = pinned[m.key] ?? m.good + (m.critical - m.good) * t;
			return {
				key: m.key,
				label: m.label,
				value,
				text: `${value.toFixed(m.digits)} ${m.unit}`,
				status: statusOf(m, value)
			};
		});
		result = { status: worst(readings.map((r) => r.status)), readings };
	}
	cache.set(place.room.id, result);
	return result;
}
