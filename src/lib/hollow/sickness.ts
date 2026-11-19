/**
 * Simulated lung-sickness reports per habitation block. Most of a level stays near-clean;
 * the sickness sits in tight hotspots where nearly everyone who reports is sick, with a
 * steep edge around each. Outbreaks start on the top levels (the first floors): they get
 * more, larger and hotter hotspots, and the background rate also falls with depth.
 * Deterministic per floor, so the map is stable between visits. Tuning: `SIM.sickness`.
 */
import { perFloor, type Floor } from './world.js';
import { mulberry32 } from '#lib/random.js';
import { SIM, spread, streamSeed } from './simConfig.js';

const C = SIM.sickness;

export interface BlockSickness {
	/** Residents of the block who have filed a health report. */
	reported: number;
	/** Of those, how many report lung sickness. */
	sick: number;
	/** sick / reported, 0–1. */
	score: number;
}

/** Floor-wide background rate: low everywhere, lowest deep down. */
const background = (level: number) => C.background * Math.pow(C.backgroundDecay, level);

/** Room id → sickness reports (null for rooms that aren't housing). */
export const sicknessOf = perFloor((floor: Floor): (BlockSickness | null)[] => {
	const rand = mulberry32(streamSeed(floor.seed, 'sickness') + floor.index * 104_729);
	const { rooms } = floor.map;
	const housing = rooms.filter((r) => floor.residents[r.id] > 0);
	const level = floor.index;

	// Hotspots: many and fierce on the first floors, few and milder further down.
	const reach = Math.pow(C.reachDecay, level);
	const hotspots = Array.from({ length: Math.max(1, C.hotspots - level * C.hotspotsDrop) }, () => {
		const r = housing[Math.floor(rand() * housing.length)];
		return {
			x: r.x + r.w / 2,
			y: r.y + r.h / 2,
			radius: spread(C.radius, rand()) * (0.6 + reach * 0.4),
			peak: Math.min(1, spread(C.peak, rand()) * (0.45 + reach * 0.55))
		};
	});

	return rooms.map((r): BlockSickness | null => {
		const residents = floor.residents[r.id];
		if (!residents) return null;
		const cx = r.x + r.w / 2;
		const cy = r.y + r.h / 2;
		// Strongest hotspot here: a plateau near its centre that drops off sharply at the edge.
		const heat = hotspots.reduce((m, h) => {
			const d = Math.hypot(cx - h.x, cy - h.y) / h.radius;
			return Math.max(m, h.peak / (1 + Math.pow(d, 4)));
		}, 0);
		// Per-block noise keeps hotspots patchy, with the odd isolated sick block outside them.
		const stray = rand() < C.stray * reach ? spread(C.strayScore, rand()) : 0;
		const bg = background(level) * rand() * 2;
		const score = Math.min(1, Math.max(0, Math.max(heat * (0.75 + rand() * 0.35), stray) + bg));
		const reported = Math.max(1, Math.round(residents * spread(C.reportShare, rand())));
		const sick = Math.round(reported * score);
		return { reported, sick, score: sick / reported };
	});
});

/** Reports summed over some floors: how many reported, how many sick, and the sick share. */
export function sicknessTotals(floors: Floor[]) {
	let reported = 0;
	let sick = 0;
	for (const f of floors)
		for (const s of sicknessOf(f))
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
