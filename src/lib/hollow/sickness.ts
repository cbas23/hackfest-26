/**
 * Simulated lung-sickness reports per habitation block. Most of a level stays near-clean;
 * the sickness sits in tight hotspots where nearly everyone who reports is sick, with a
 * steep edge around each. Outbreaks start on the top levels (the first floors): they get
 * more, larger and hotter hotspots, and the background rate also falls with depth.
 * Deterministic per floor, so the map is stable between visits.
 */
import type { Floor } from './world.js';

export interface BlockSickness {
	/** Residents of the block who have filed a health report. */
	reported: number;
	/** Of those, how many report lung sickness. */
	sick: number;
	/** sick / reported, 0–1. */
	score: number;
}

/** Floor-wide background rate: low everywhere, lowest deep down. */
const background = (level: number) => 0.14 * Math.pow(0.75, level);

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const cache = new Map<number, (BlockSickness | null)[]>();

/** Room id → sickness reports (null for rooms that aren't housing). */
export function sicknessOf(floor: Floor): (BlockSickness | null)[] {
	const hit = cache.get(floor.index);
	if (hit) return hit;
	const rand = rng(0x5eed + floor.index * 104_729);
	const { rooms } = floor.map;
	const housing = rooms.filter((r) => floor.residents[r.id] > 0);
	const level = floor.index;

	// Hotspots: many and fierce on the first floors, few and milder further down.
	const reach = Math.pow(0.82, level);
	const hotspots = Array.from({ length: Math.max(1, 9 - level * 1.3) }, () => {
		const r = housing[Math.floor(rand() * housing.length)];
		return {
			x: r.x + r.w / 2,
			y: r.y + r.h / 2,
			radius: (8 + rand() * 18) * (0.6 + reach * 0.4),
			peak: Math.min(1, (0.8 + rand() * 0.3) * (0.45 + reach * 0.55))
		};
	});

	const out = rooms.map((r): BlockSickness | null => {
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
		const stray = rand() < 0.03 * reach ? 0.3 + rand() * 0.4 : 0;
		const bg = background(level) * rand() * 2;
		const score = Math.min(1, Math.max(0, Math.max(heat * (0.75 + rand() * 0.35), stray) + bg));
		const reported = Math.max(1, Math.round(residents * (0.04 + rand() * 0.16)));
		const sick = Math.round(reported * score);
		return { reported, sick, score: sick / reported };
	});
	cache.set(floor.index, out);
	return out;
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
