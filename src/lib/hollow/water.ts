/**
 * Simulated tap-water health per housing block, 0 (clean) to 1 (toxic). Nothing here is
 * measured. A block drinks from the water recycler that reaches its door first through the
 * tunnels (its service area, see `impact.ts`); its water gets worse with:
 * - the length of the pipe run from that recycler,
 * - depth (older, hotter mains further down),
 * - leaky mains: a few seeded patches of local contamination per level,
 * - the recycler's own status (its active `waterCuts` events), for every block it serves.
 * Blocks no recycler reaches read close to toxic. Tuning is in `SIM.water`.
 */
import { mulberry32 } from '#lib/random.js';
import { LEVELS } from './data.js';
import { isActive, type WaterEvent } from './events.js';
import { servedBy } from './impact.js';
import { placesOn } from './nav.js';
import { readingsFromEvents, type Status } from './sensors.js';
import { SIM, spread, streamSeed } from './simConfig.js';
import { perFloorWith, type Floor } from './world.js';

const C = SIM.water;

export interface BlockWater {
	/** 0 (clean) to 1 (toxic). */
	score: number;
	/** Room id of the recycler serving the block, or null when none reaches it. */
	facility: number | null;
	/** That recycler's sensor status. */
	status: Status | null;
}

/** Room id → tap-water health (null for rooms that aren't housing). */
export const waterHealthOf = perFloorWith(
	(floor: Floor, events: WaterEvent[]): (BlockWater | null)[] => {
		const rand = mulberry32(streamSeed(floor.seed, 'water') + floor.index * 7_919);
		const depth = floor.index / (LEVELS.length - 1);
		const { rooms } = floor.map;
		const housing = rooms.filter((r) => floor.residents[r.id] > 0);

		// Each recycler's status, from its active events.
		const status = new Map<number, Status>();
		for (const p of placesOn(floor)) {
			if (p.kind !== 'water') continue;
			const mine = events.filter((e) => e.facility === p.key && isActive(e));
			status.set(p.room.id, readingsFromEvents(floor, p, 'water', mine).status);
		}

		const leaks = Array.from(
			{ length: housing.length ? Math.round(C.leaks.base + floor.index * C.leaks.perLevel) : 0 },
			() => {
				const r = housing[Math.floor(rand() * housing.length)];
				return {
					x: r.x + r.w / 2,
					y: r.y + r.h / 2,
					radius: spread(C.leakRadius, rand()),
					strength: spread(C.leakStrength, rand())
				};
			}
		);

		return rooms.map((r): BlockWater | null => {
			if (!floor.residents[r.id]) return null;
			const noise = (rand() - 0.5) * C.noise;
			const served = servedBy(floor, 'water', r);
			if (!served) return { score: clamp(C.unserved + noise), facility: null, status: null };
			const cx = r.x + r.w / 2;
			const cy = r.y + r.h / 2;
			const leak = leaks.reduce((m, l) => {
				const d = Math.hypot(cx - l.x, cy - l.y) / l.radius;
				return Math.max(m, l.strength / (1 + d * d * d));
			}, 0);
			const s = status.get(served.facility) ?? 'normal';
			const pipe = 1 - Math.exp(-served.dist / C.pipeLength);
			// A failing recycler taints its whole service area, worst near its door.
			const plume = C.plumeTail + (1 - C.plumeTail) * Math.exp(-served.dist / C.plumeLength);
			const score =
				pipe * C.pipeWeight + depth * C.depthWeight + leak + C.statusBump[s] * plume + noise;
			return { score: clamp(score), facility: served.facility, status: s };
		});
	}
);

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Five water steps, slate (clean) through violet to toxic fuchsia; colours are the `--map-water-*` CSS variables. */
export const WATER_STEPS = [
	{ color: 'var(--map-water-1)', label: 'Clean', short: 'Clean' },
	{ color: 'var(--map-water-2)', label: 'Fair', short: 'Fair' },
	{ color: 'var(--map-water-3)', label: 'Poor', short: 'Poor' },
	{ color: 'var(--map-water-4)', label: 'Unsafe', short: 'Unsafe' },
	{ color: 'var(--map-water-5)', label: 'Toxic', short: 'Toxic' }
] as const;

/** Which of the five steps a 0–1 score falls in. */
export const waterStep = (score: number) =>
	Math.min(WATER_STEPS.length - 1, Math.floor(score * WATER_STEPS.length));

/** Residents per step over some floors' water health. */
export function waterTotals(floors: { floor: Floor; water: (BlockWater | null)[] }[]) {
	const byStep = WATER_STEPS.map(() => 0);
	let residents = 0;
	for (const { floor, water } of floors)
		water.forEach((w, id) => {
			if (!w) return;
			byStep[waterStep(w.score)] += floor.residents[id];
			residents += floor.residents[id];
		});
	/** Residents on unsafe or toxic water. */
	const unsafe = byStep[3] + byStep[4];
	return { byStep, residents, unsafe, share: unsafe / Math.max(1, residents) };
}
