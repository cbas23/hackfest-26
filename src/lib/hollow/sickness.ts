/**
 * Simulated lung-sickness reports per habitation block. Sickness comes from outbreaks: points
 * of kind `sickness` in the shared state (Convex, placed in the control center), like the
 * power, water and air points. Each outbreak makes the blocks around it sick, nearly everyone
 * at its centre and fading out to its reach over the area (straight-line distance), with a
 * steep edge; overlapping outbreaks compound. Every block also has a low background rate,
 * higher on the crowded top levels, plus seeded noise. The scoring is shared with the other
 * kinds (`kindScores` in `conditions.ts`, tuning in `SIM.conditions.sickness`); here the
 * score becomes health reports.
 */
import { hashPair } from '#lib/random.js';
import { kindScores, type PointArea } from './conditions.js';
import { SIM, spread, streamSeed } from './simConfig.js';
import type { StatePoint } from './state.js';
import { perFloorWith, type Floor } from './world.js';

export interface BlockSickness {
	/** Residents of the block who have filed a health report. */
	reported: number;
	/** Of those, how many report lung sickness. */
	sick: number;
	/** sick / reported, 0–1. */
	score: number;
}

export interface FloorSickness {
	/** Room id → sickness reports (null for rooms that aren't housing). */
	blocks: (BlockSickness | null)[];
	/** Every outbreak on this floor, with the blocks it reaches. */
	areas: PointArea[];
}

/** Sickness on `floor` from the city's points (all levels and kinds; it picks its outbreaks). */
export const sicknessOn = perFloorWith((floor: Floor, points: StatePoint[]): FloorSickness => {
	const { score, areas } = kindScores(floor, 'sickness', points);
	const seed = streamSeed(floor.seed, 'sickness') ^ floor.index;
	const blocks = score.map((s, id): BlockSickness | null => {
		if (s === null) return null;
		const share = spread(SIM.sickness.reportShare, hashPair(id * 13 + 5, seed));
		const reported = Math.max(1, Math.round(floor.residents[id] * share));
		const sick = Math.round(reported * s);
		return { reported, sick, score: sick / reported };
	});
	return { blocks, areas };
});

/** Reports summed over some floors' sickness: how many reported, how many sick, and the sick share. */
export function sicknessTotals(floors: (BlockSickness | null)[][]) {
	let reported = 0;
	let sick = 0;
	for (const f of floors)
		for (const s of f)
			if (s) {
				reported += s.reported;
				sick += s.sick;
			}
	return { reported, sick, share: sick / Math.max(1, reported) };
}

/** Five sickness steps, dark gray (few sick) to bright orange (nearly all reported sick); the colours are the `--map-sick-*` CSS variables. */
export const SICK_STEPS = [
	{ color: 'var(--map-sick-1)', range: '0–20%', short: '<20%' },
	{ color: 'var(--map-sick-2)', range: '20–40%', short: '20%+' },
	{ color: 'var(--map-sick-3)', range: '40–60%', short: '40%+' },
	{ color: 'var(--map-sick-4)', range: '60–80%', short: '60%+' },
	{ color: 'var(--map-sick-5)', range: '80–100%', short: '80%+' }
] as const;

/** Which of the five steps a 0–1 score falls in. */
export const sickStep = (score: number) =>
	Math.min(SICK_STEPS.length - 1, Math.floor(score * SICK_STEPS.length));
