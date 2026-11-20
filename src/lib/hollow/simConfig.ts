/**
 * Seeds and tuning for the Hollow's simulated data, in one place. Read it through
 * `simulation.ts`; it is a separate module only so the simulations can import it without an
 * import cycle.
 *
 * Every number here changes the generated data. The defaults reproduce the data the app
 * shipped with, so change them on purpose (and re-check the lore in `data.ts`).
 */
import { HOLLOW_SEED } from './data.js';

// ── Seeds ───────────────────────────────────────────────────────────────────

/** The independent random streams the simulation draws from. */
export type SimStream = 'world' | 'sickness' | 'scenario' | 'power' | 'water' | 'air';

/**
 * Each stream's seed is the city seed XOR a fixed salt, so one city seed drives all of them
 * while they stay distinct. The salts are chosen so the default city (`HOLLOW_SEED`) keeps
 * the data it shipped with.
 */
const STREAM_SALT: Record<SimStream, number> = {
	world: 0,
	sickness: 0x5eed ^ HOLLOW_SEED,
	scenario: 0xb1ac,
	power: 0x9a3e,
	water: 0x3a7e,
	air: 0xa1f0
};

/** The seed one simulation draws from, for a given city seed. */
export const streamSeed = (citySeed: number, stream: SimStream) => citySeed ^ STREAM_SALT[stream];

// ── Tuning ──────────────────────────────────────────────────────────────────

/** A random amount: `min + r * span` for r in [0, 1). */
export interface Spread {
	min: number;
	span: number;
}
export const spread = ({ min, span }: Spread, r: number) => min + r * span;

export const SIM = {
	/** Population and facility placement (`world.ts`). Level-wide conditions live on `LEVELS` in `data.ts`. */
	world: {
		/** Facilities go in chambers at least this many tiles across. */
		facilityMinSize: 3
	},

	/**
	 * Lung-sickness reports (`sickness.ts`). How sick a block is comes from the outbreak points
	 * (`SIM.conditions.sickness`); this is the share of its residents who file a health report.
	 */
	sickness: {
		reportShare: { min: 0.04, span: 0.16 } satisfies Spread
	},

	/**
	 * Power, water and air per housing block (`conditions.ts`), 0 (good) to 1 (bad). Each
	 * block starts from a level-wide base plus seeded noise; every point of the kind then
	 * pushes it towards bad, strongest at the point and fading with distance. Power and water
	 * spread along the tunnels (walking distance to the block's door, so a point reaches what
	 * its tunnels connect, not what is nearby through rock); air and sickness spread over an
	 * area. `edge` is the falloff's steepness: higher keeps the point's
	 * strength further out and then drops sharply at its reach.
	 */
	conditions: {
		power: {
			spread: 'tunnels',
			edge: 5,
			/** Base on a level with no light (scaled by the level's darkness), and noise. */
			base: 0.02,
			levelWeight: 0.14,
			noise: 0.12,
			/** Per-block share of a point's push it feels (patchy edges). */
			jitter: { min: 0.8, span: 0.35 } satisfies Spread
		},
		water: {
			spread: 'tunnels',
			edge: 2.2,
			/** Base, plus up to this much more on L7 (scaled by depth). */
			base: 0.04,
			levelWeight: 0.16,
			noise: 0.14,
			jitter: { min: 0.75, span: 0.4 } satisfies Spread
		},
		air: {
			spread: 'area',
			edge: 4,
			/** Base, plus up to this much more where the level's air supply is thinnest. */
			base: 0.03,
			levelWeight: 0.2,
			noise: 0.12,
			jitter: { min: 0.75, span: 0.35 } satisfies Spread
		},
		/**
		 * Lung-sickness outbreaks: the sick share of a block's health reports. A plateau near
		 * the outbreak that drops off sharply at its reach.
		 */
		sickness: {
			spread: 'area',
			edge: 4,
			/** Background sick share, plus up to this much more on the crowded top levels. */
			base: 0.02,
			levelWeight: 0.08,
			noise: 0.12,
			jitter: { min: 0.75, span: 0.35 } satisfies Spread
		}
	},

	/** The starter scenario the control center loads (`scenario.ts`), drawn from the `scenario` stream. */
	scenario: {
		/** Points per level and kind: up to `max` (more on the darker, deeper levels), at least `min`. */
		points: { min: 1, max: 4 },
		/** Point reach in tiles per kind (along the tunnels for power and water), growing a little with depth. */
		pointRadius: {
			power: { min: 18, span: 24 },
			water: { min: 25, span: 30 },
			air: { min: 8, span: 14 }
		} satisfies Record<'power' | 'water' | 'air', Spread>,
		/** Point strength (its push at the centre). */
		pointStrength: { min: 0.55, span: 0.45 } satisfies Spread,
		/**
		 * Lung-sickness outbreaks: `first` on L1, `drop` fewer each level down (at least one).
		 * Each level down keeps `keep` of their size and heat, so they are many and fierce on
		 * the first floors and few and mild further down.
		 */
		outbreaks: {
			first: 9,
			drop: 1.3,
			keep: 0.82,
			radius: { min: 6, span: 12 } satisfies Spread,
			strength: { min: 0.8, span: 0.2 } satisfies Spread
		},
		/** Blocked tunnel stretches per level, and their length in tiles. */
		blockedTunnels: { min: 1, span: 3 } satisfies Spread,
		blockedLength: { min: 2, span: 4 } satisfies Spread,
		blockedReasons: ['Rockfall', 'Flooded', 'Structural damage', 'Gas leak', 'Collapsed support']
	}
} as const;
