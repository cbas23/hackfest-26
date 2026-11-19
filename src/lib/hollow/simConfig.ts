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
export type SimStream = 'world' | 'sickness' | 'scenario';

/**
 * Each stream's seed is the city seed XOR a fixed salt, so one city seed drives all of them
 * while they stay distinct. The salts are chosen so the default city (`HOLLOW_SEED`) keeps
 * the data it shipped with.
 */
const STREAM_SALT: Record<SimStream, number> = {
	world: 0,
	sickness: 0x5eed ^ HOLLOW_SEED,
	scenario: 0xb1ac
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
	 * Lung-sickness reports (`sickness.ts`). Where the hotspots are and how strong they are is
	 * set by the shared `SicknessSettings` (Convex, edited in the control center); these are
	 * the fixed parts of the model. "Per level down" compounds from L1.
	 */
	sickness: {
		/** Background decays faster with depth than the hotspots: falloff ^ (level × this). */
		backgroundDepthPower: Math.log(0.75) / Math.log(0.82),
		/** Hotspot radius in tiles and peak sick share, before scaling by reach and the settings. */
		radius: { min: 8, span: 18 } satisfies Spread,
		peak: { min: 0.8, span: 0.3 } satisfies Spread,
		/** Chance (on L1) of an isolated sick block outside any hotspot, and its score. */
		stray: 0.03,
		strayScore: { min: 0.3, span: 0.4 } satisfies Spread,
		/** Share of a block's residents who file a health report. */
		reportShare: { min: 0.04, span: 0.16 } satisfies Spread
	},

	/** The starter scenario the control center loads (`scenario.ts`), drawn from the `scenario` stream. */
	scenario: {
		/** Points per level and kind: up to `max` (more on the darker, deeper levels), at least `min`. */
		points: { min: 1, max: 4 },
		/** Point radius in tiles, growing a little with depth. */
		pointRadius: { min: 6, span: 12 } satisfies Spread,
		/** Blocked tunnel stretches per level, and their length in tiles. */
		blockedTunnels: { min: 1, span: 3 } satisfies Spread,
		blockedLength: { min: 2, span: 4 } satisfies Spread,
		blockedReasons: ['Rockfall', 'Flooded', 'Structural damage', 'Gas leak', 'Collapsed support']
	}
} as const;
