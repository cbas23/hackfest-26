/**
 * Simulated airflow per housing block, 0 (still) to 1 (strong). Nothing here is measured.
 * A block breathes from the ventilation plant that reaches its door first through the
 * tunnels (its service area, see `impact.ts`). Its flow:
 * - fades with the tunnel walk from that plant,
 * - thins with the level's air supply (`LEVELS[].air`: less the deeper you go),
 * - is throttled by the plant's airflow reading (its active `airQuality` events),
 * - picks up drafts near the shafts, which move air between levels.
 * Tuning is in `SIM.airflow`.
 */
import { mulberry32 } from '#lib/random.js';
import { LEVELS } from './data.js';
import { isActive, type AirEvent } from './events.js';
import { servedBy } from './impact.js';
import { placesOn } from './nav.js';
import { readingsFromEvents, type Status } from './sensors.js';
import { SIM, streamSeed } from './simConfig.js';
import { perFloorWith, type Floor } from './world.js';

const C = SIM.airflow;

export interface BlockAirflow {
	/** 0 (still) to 1 (strong). */
	score: number;
	/** Room id of the ventilation plant serving the block, or null when none reaches it. */
	facility: number | null;
	/** That plant's sensor status. */
	status: Status | null;
}

/** Room id → airflow (null for rooms that aren't housing). */
export const airflowOf = perFloorWith(
	(floor: Floor, events: AirEvent[]): (BlockAirflow | null)[] => {
		const rand = mulberry32(streamSeed(floor.seed, 'airflow') + floor.index * 6_151);
		const supply = C.levelBase + (1 - C.levelBase) * LEVELS[floor.index].air;

		// Each plant's status and how much of its rated flow it pushes, from its active events.
		const plants = new Map<number, { status: Status; output: number }>();
		for (const p of placesOn(floor)) {
			if (p.kind !== 'air') continue;
			const mine = events.filter((e) => e.facility === p.key && isActive(e));
			const s = readingsFromEvents(floor, p, 'air', mine);
			const flow = s.readings.find((r) => r.key === 'airflow')?.value ?? 100;
			plants.set(p.room.id, { status: s.status, output: Math.min(1.05, flow / 100) });
		}
		const shafts = floor.shaftGates.map((g) => ({ x: g.x + g.w / 2, y: g.y + g.h / 2 }));

		return floor.map.rooms.map((r): BlockAirflow | null => {
			if (!floor.residents[r.id]) return null;
			const noise = (rand() - 0.5) * C.noise;
			const cx = r.x + r.w / 2;
			const cy = r.y + r.h / 2;
			const nearShaft = shafts.reduce((m, s) => Math.min(m, Math.hypot(cx - s.x, cy - s.y)), 1e9);
			const draft = C.shaftDraft * Math.exp(-nearShaft / C.shaftReach) * supply;
			const served = servedBy(floor, 'air', r);
			if (!served)
				return { score: clamp(C.unserved + draft + noise), facility: null, status: null };
			const plant = plants.get(served.facility) ?? { status: 'normal' as Status, output: 1 };
			const push = C.floor + (1 - C.floor) * Math.exp(-served.dist / C.reach);
			const score = push * supply * plant.output + draft + noise;
			return { score: clamp(score), facility: served.facility, status: plant.status };
		});
	}
);

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Five airflow steps, diverging: stale air is a dusty amber, fresh air a bright aqua, and
 * the middle recedes. Colours are the `--map-air-*` CSS variables.
 */
export const AIR_STEPS = [
	{ color: 'var(--map-air-1)', label: 'Still', short: 'Still' },
	{ color: 'var(--map-air-2)', label: 'Weak', short: 'Weak' },
	{ color: 'var(--map-air-3)', label: 'Fair', short: 'Fair' },
	{ color: 'var(--map-air-4)', label: 'Good', short: 'Good' },
	{ color: 'var(--map-air-5)', label: 'Strong', short: 'Strong' }
] as const;

/** Which of the five steps a 0–1 score falls in. */
export const airStep = (score: number) =>
	Math.min(AIR_STEPS.length - 1, Math.floor(score * AIR_STEPS.length));

/** Residents per step over some floors' airflow. */
export function airflowTotals(floors: { floor: Floor; airflow: (BlockAirflow | null)[] }[]) {
	const byStep = AIR_STEPS.map(() => 0);
	let residents = 0;
	for (const { floor, airflow } of floors)
		airflow.forEach((a, id) => {
			if (!a) return;
			byStep[airStep(a.score)] += floor.residents[id];
			residents += floor.residents[id];
		});
	/** Residents in still or weak air. */
	const stale = byStep[0] + byStep[1];
	return { byStep, residents, stale, share: stale / Math.max(1, residents) };
}
