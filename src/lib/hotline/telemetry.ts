/**
 * Fictional life-support telemetry for each level of the Hollow: water recyclers, tap-water
 * turbidity and chlorine, air recyclers and crowding. The Contact Agent's letter cites it as
 * evidence alongside resident reports.
 */

/** Fictional life-support telemetry, one row per level (L1 first). */
export interface LevelSystems {
	level: number;
	/** Water recycler running at capacity, %. */
	waterRecycler: number;
	/** Tap-water turbidity now and three days ago, NTU (safe drinking water is under 1; 5 is unsafe). */
	turbidityNTU: number;
	turbidity3dAgoNTU: number;
	/** Disinfectant left in the pipes, mg/L (under 0.2 lets bacteria grow). */
	chlorineMgL: number;
	/** Air recyclers running at capacity, %. Stale air spreads lung sickness. */
	airRecycler: number;
	/** People per room, rated for 2. */
	crowding: number;
}

export const SYSTEMS: LevelSystems[] = [
	{
		level: 1,
		waterRecycler: 97,
		turbidityNTU: 0.3,
		turbidity3dAgoNTU: 0.3,
		chlorineMgL: 0.9,
		airRecycler: 96,
		crowding: 1.2
	},
	{
		level: 2,
		waterRecycler: 88,
		turbidityNTU: 0.8,
		turbidity3dAgoNTU: 0.5,
		chlorineMgL: 0.6,
		airRecycler: 84,
		crowding: 2.1
	},
	{
		level: 3,
		waterRecycler: 54,
		turbidityNTU: 4.1,
		turbidity3dAgoNTU: 1.6,
		chlorineMgL: 0.15,
		airRecycler: 63,
		crowding: 3.8
	},
	{
		level: 4,
		waterRecycler: 61,
		turbidityNTU: 3.2,
		turbidity3dAgoNTU: 1.9,
		chlorineMgL: 0.2,
		airRecycler: 58,
		crowding: 4.4
	},
	{
		level: 5,
		waterRecycler: 66,
		turbidityNTU: 2.6,
		turbidity3dAgoNTU: 2.2,
		chlorineMgL: 0.3,
		airRecycler: 52,
		crowding: 5.1
	},
	{
		level: 6,
		waterRecycler: 72,
		turbidityNTU: 1.4,
		turbidity3dAgoNTU: 0.9,
		chlorineMgL: 0.4,
		airRecycler: 47,
		crowding: 4.8
	},
	{
		level: 7,
		waterRecycler: 80,
		turbidityNTU: 0.9,
		turbidity3dAgoNTU: 0.8,
		chlorineMgL: 0.5,
		airRecycler: 41,
		crowding: 4.2
	}
];
