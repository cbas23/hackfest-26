import { LEVELS } from './data.js';
import type { Place, PlaceKind } from './nav.js';

/**
 * Simulated sensor readings for the Hollow's infrastructure (HollowWatch: the Detect step).
 *
 * Values are generated, not measured: each one is derived from how stressed the level is
 * (deeper, hotter, worse air) plus a little per-facility noise, so the same seed always
 * gives the same readings. Status comes from fixed thresholds in code, never from an AI.
 */

export type Status = 'normal' | 'warning' | 'high' | 'critical';

export const STATUS_INFO: Record<Status, { label: string; color: string; rank: number }> = {
	normal: { label: 'Normal', color: '#22c55e', rank: 0 },
	warning: { label: 'Warning', color: '#eab308', rank: 1 },
	high: { label: 'High risk', color: '#f97316', rank: 2 },
	critical: { label: 'Critical', color: '#ef4444', rank: 3 }
};

interface Metric {
	key: string;
	label: string;
	unit: string;
	/** Healthy value. Whether higher or lower is worse follows from `good` vs `critical`. */
	good: number;
	warning: number;
	high: number;
	critical: number;
	digits: number;
}

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

type MonitoredKind = 'water' | 'air' | 'clinic' | 'plant';

const METRICS: Record<MonitoredKind, Metric[]> = {
	water: [
		{
			key: 'turbidity',
			label: 'Turbidity',
			unit: 'NTU',
			good: 0.3,
			warning: 1,
			high: 4,
			critical: 10,
			digits: 1
		},
		{
			key: 'chlorine',
			label: 'Free chlorine',
			unit: 'mg/L',
			good: 1.2,
			warning: 0.5,
			high: 0.2,
			critical: 0.05,
			digits: 2
		},
		{
			key: 'output',
			label: 'Recycler output',
			unit: '%',
			good: 98,
			warning: 80,
			high: 60,
			critical: 40,
			digits: 0
		}
	],
	air: [
		{
			key: 'co2',
			label: 'CO₂',
			unit: 'ppm',
			good: 600,
			warning: 1000,
			high: 2000,
			critical: 5000,
			digits: 0
		},
		{
			key: 'pm25',
			label: 'PM2.5',
			unit: 'µg/m³',
			good: 5,
			warning: 15,
			high: 35,
			critical: 75,
			digits: 0
		},
		{
			key: 'airflow',
			label: 'Airflow',
			unit: '% rated',
			good: 100,
			warning: 80,
			high: 60,
			critical: 40,
			digits: 0
		}
	],
	clinic: [
		{
			key: 'beds',
			label: 'Bed occupancy',
			unit: '%',
			good: 60,
			warning: 85,
			high: 95,
			critical: 100,
			digits: 0
		},
		{
			key: 'stock',
			label: 'Medicine stock',
			unit: 'days',
			good: 30,
			warning: 14,
			high: 7,
			critical: 3,
			digits: 0
		}
	],
	plant: [
		{
			key: 'power',
			label: 'Power output',
			unit: '% rated',
			good: 100,
			warning: 85,
			high: 70,
			critical: 50,
			digits: 0
		},
		{
			key: 'coolant',
			label: 'Coolant temp',
			unit: '°C',
			good: 70,
			warning: 90,
			high: 105,
			critical: 120,
			digits: 0
		}
	]
};

/** Readings pinned to the facility notes in data.ts, so the numbers agree with the lore. */
const OVERRIDES: Record<string, Record<string, number>> = {
	'The Drip': { output: 40 }, // "Running at 40% capacity"
	'Recycler Array 7': { output: 62.5 }, // "Three of eight units offline"
	'Clinic Nine': { beds: 118 } // "Overwhelmed by lung sickness"
};

/** How strained a level is for one kind of infrastructure, 0 (fine) to 1 (failing). */
function stress(kind: MonitoredKind, floor: number) {
	const level = LEVELS[floor];
	const depth = floor / (LEVELS.length - 1);
	if (kind === 'air') return 1 - level.air;
	if (kind === 'clinic') return (1 - level.air) * 0.6 + depth * 0.4;
	if (kind === 'plant') return level.heat * 0.85;
	return depth * 0.9;
}

/** Cheap deterministic hash → [0, 1). */
function noise(a: number, b: number) {
	let h = Math.imul(a ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	return (h >>> 0) / 4294967296;
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

const cache = new Map<string, FacilityStatus | null>();

/** Sensor readings and overall status for a place, or null if it has no sensors. */
export function facilityStatus(place: Place): FacilityStatus | null {
	const hit = cache.get(place.key);
	if (hit !== undefined) return hit;
	let result: FacilityStatus | null = null;
	if (isMonitored(place.kind)) {
		const s = stress(place.kind, place.floor);
		const pinned = OVERRIDES[place.label] ?? {};
		const readings = METRICS[place.kind].map((m, i): Reading => {
			// t = 0 is the healthy value, t = 1 the critical threshold.
			const jitter = (noise(place.room.id * 31 + i, place.floor) - 0.5) * 0.35;
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
	cache.set(place.key, result);
	return result;
}
