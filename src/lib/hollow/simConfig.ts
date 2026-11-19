/**
 * Seeds and tuning for the Hollow's simulated data, in one place. Read it through
 * `simulation.ts`; it is a separate module only so the simulations can import it without an
 * import cycle.
 *
 * Every number here changes the generated data. The defaults reproduce the data the app
 * shipped with, so change them on purpose (and re-check the pinned lore in `data.ts`).
 */
import { HOLLOW_SEED } from './data.js';

// ── Seeds ───────────────────────────────────────────────────────────────────

/** The independent random streams the simulation draws from. */
export type SimStream = 'world' | 'sickness' | 'sensors' | 'events' | 'water' | 'airflow';

/**
 * Each stream's seed is the city seed XOR a fixed salt, so one city seed drives all of them
 * while they stay distinct. The salts are chosen so the default city (`HOLLOW_SEED`) keeps
 * the data it shipped with.
 */
const STREAM_SALT: Record<SimStream, number> = {
	world: 0,
	sickness: 0x5eed ^ HOLLOW_SEED,
	sensors: HOLLOW_SEED,
	events: 0xb1ac,
	water: 0x3a7e,
	airflow: 0xa1f0
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

export type Status = 'normal' | 'warning' | 'high' | 'critical';

/** Facility kinds that carry sensors. */
export type MonitoredKind = 'water' | 'air' | 'clinic' | 'plant';

export interface Metric {
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

	/**
	 * Tap-water health per housing block (`water.ts`), 0 (clean) to 1 (toxic). Water gets
	 * worse the further it travels from its recycler, the deeper the level, near leaky mains,
	 * and everywhere downstream of a recycler with an active water event.
	 */
	water: {
		/** Walking distance (tiles) at which the pipe run has cost ~63% of `pipeWeight`. */
		pipeLength: 140,
		pipeWeight: 0.2,
		/** Added on L7 (scaled by depth from L1). */
		depthWeight: 0.08,
		/** Leaky mains: blobs of local contamination, more of them deeper down. */
		leaks: { base: 3, perLevel: 0.6 },
		leakRadius: { min: 8, span: 20 } satisfies Spread,
		leakStrength: { min: 0.35, span: 0.4 } satisfies Spread,
		/**
		 * Added to the blocks a recycler serves, by its sensor status: in full at its door,
		 * fading to `plumeTail` of it along the pipes (tiles at which it has faded ~63%).
		 */
		statusBump: { normal: 0, warning: 0.2, high: 0.38, critical: 0.58 },
		plumeLength: 70,
		plumeTail: 0.3,
		/** Blocks no recycler reaches. */
		unserved: 0.82,
		/** Per-block noise (± half of this). */
		noise: 0.1
	},

	/**
	 * Airflow per housing block (`airflow.ts`), 0 (still) to 1 (strong). Strongest next to a
	 * ventilation plant, fading with the tunnel walk away from it, thinner on deep levels
	 * (`LEVELS[].air`), throttled by a plant's airflow reading, with drafts around the shafts.
	 */
	airflow: {
		/** Walking distance (tiles) at which a plant's push has dropped to ~37%. */
		reach: 120,
		/** Share of flow that doesn't depend on the distance to a plant. */
		floor: 0.2,
		/** Share of flow that doesn't depend on the level's air supply. */
		levelBase: 0.5,
		/** Drafts around the shafts: strength, and distance (tiles) at which they fade to ~37%. */
		shaftDraft: 0.28,
		shaftReach: 22,
		/** Blocks no ventilation plant reaches. */
		unserved: 0.06,
		/** Per-block noise (± half of this). */
		noise: 0.1
	},

	/**
	 * Sensor readings (`sensors.ts`). Air and water readings follow their events; clinics and
	 * plants (and the starter scenario's air and water events) use the stress model, with the
	 * readings pinned to the lore on the facilities in `data.ts`.
	 */
	sensors: {
		/** Per-reading noise around the level's stress (± half of this, in threshold units). */
		jitter: 0.35,
		/** A healthy reading sits up to this share of the way from `good` to `warning`. */
		healthyDrift: 0.35,
		/** What each kind of facility measures, and the thresholds that set its status. */
		metrics: {
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
		} satisfies Record<MonitoredKind, readonly Metric[]>
	},

	/** The starter scenario the control center loads (`scenario.ts`), drawn from the `events` stream. */
	scenario: {
		/** Blackouts per level: up to `max` × (1 − the level's light), at least `min`. */
		blackouts: { min: 1, max: 5 },
		/** Blackout radius in tiles, growing with the level's darkness. */
		blackoutRadius: { min: 6, span: 14 } satisfies Spread,
		/** Blocked tunnel stretches per level, and their length in tiles. */
		blockedTunnels: { min: 1, span: 3 } satisfies Spread,
		blockedLength: { min: 2, span: 4 } satisfies Spread,
		blockedReasons: ['Rockfall', 'Flooded', 'Structural damage', 'Gas leak', 'Collapsed support']
	},

	/** Impact assessment (`impact.ts`). */
	impact: {
		/** Share of dependent residents who lose service, by facility status. */
		exposure: { normal: 0, warning: 0, high: 0.5, critical: 1 } satisfies Record<Status, number>,
		/**
		 * A neighborhood's severity drops one step below the facility's status when fewer than
		 * `oneStep` of its residents depend on it, and two below `twoSteps` (never below Warning).
		 */
		soften: { oneStep: 0.5, twoSteps: 0.2 }
	}
} as const;
