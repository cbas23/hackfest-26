import type { FeatureSpec } from '#lib/tunnels/generate.js';

export type ShaftStatus = 'open' | 'restricted' | 'sealed' | 'unregistered';

export interface Level {
	index: number;
	code: string;
	name: string;
	/** Metres below the dead cities. Gaps grow with depth — the bottom floors go deeper. */
	depth: number;
	population: number; // millions
	/** 0-1 qualitative conditions */
	light: number;
	air: number;
	heat: number;
	description: string;
	/** Share of the 250×200 grid the city spans. */
	cityScale: number;
	features: FeatureSpec[];
}

export interface ShaftInfo {
	name: string;
	status: ShaftStatus;
	description: string;
}

/** Generator settings shared by every floor. */
export const FLOOR_CONFIG = {
	width: 250,
	height: 200,
	gates: 6,
	interiorGateChance: 0.6,
	streetDensity: 0.25,
	roomDensity: 1
} as const;

export const HOLLOW_SEED = 2087;

const farms = (count: number): FeatureSpec => ({ kind: 'farm', count, size: [10, 20] });
const plants = (count: number): FeatureSpec => ({ kind: 'plant', count, size: [7, 7] });

export const LEVELS: Level[] = [
	{
		index: 0,
		code: 'L1',
		name: 'The Crown',
		depth: 80,
		population: 90,
		light: 0.92,
		air: 0.9,
		heat: 0.15,
		description:
			'Seat of the Directorate. First access to filtered air, full-spectrum light and open space. The six great shafts were sunk from here. Movement down is easy; movement up requires a permit.',
		cityScale: 0.62,
		features: [farms(1)]
	},
	{
		index: 1,
		code: 'L2',
		name: 'Lampline',
		depth: 200,
		population: 310,
		light: 0.72,
		air: 0.75,
		heat: 0.3,
		description:
			'The breadbasket of the Hollow. Communal farms ring the city under rationed grow-lamps. Light is metered and sold by the hour.',
		cityScale: 0.72,
		features: [farms(6)]
	},
	{
		index: 2,
		code: 'L3',
		name: 'The Warrens',
		depth: 350,
		population: 620,
		light: 0.5,
		air: 0.5,
		heat: 0.45,
		description:
			'Old subway tunnels turned into stacked housing — the most crowded level in the Hollow. Lung sickness clusters reported in every district.',
		cityScale: 0.86,
		features: [farms(3)]
	},
	{
		index: 3,
		code: 'L4',
		name: 'Lowmarch',
		depth: 540,
		population: 520,
		light: 0.34,
		air: 0.38,
		heat: 0.6,
		description:
			'Former mine galleries. Recycled water tastes of metal. Rolling blackouts every week; the black market runs when the lights don’t.',
		cityScale: 0.84,
		features: [farms(2), plants(1)]
	},
	{
		index: 4,
		code: 'L5',
		name: 'The Sump',
		depth: 760,
		population: 300,
		light: 0.2,
		air: 0.25,
		heat: 0.75,
		description:
			'Where the water ends up. Recycler arrays are breaking down. Blackouts last for days and hit here first. Official sickness figures are lowest here, which nobody believes.',
		cityScale: 0.78,
		features: [farms(1), plants(2)]
	},
	{
		index: 5,
		code: 'L6',
		name: 'Blackline',
		depth: 1010,
		population: 150,
		light: 0.1,
		air: 0.16,
		heat: 0.88,
		description:
			'Galleries abandoned after the first plant failures and quietly resettled by people the levels above pushed out. No lighting schedule — power arrives when the Furnace has some to spare.',
		cityScale: 0.7,
		features: [plants(3)]
	},
	{
		index: 6,
		code: 'L7',
		name: 'The Furnace',
		depth: 1300,
		population: 12,
		light: 0.06,
		air: 0.12,
		heat: 1,
		description:
			'The aging geothermal plants that power the entire Hollow. Rotating work crews only. Every failure here is felt on every level above.',
		cityScale: 0.6,
		features: [plants(6)]
	}
];

/** One entry per gate; each gate is a shaft running through every floor at the same coordinates. */
export const SHAFTS: ShaftInfo[] = [
	{
		name: 'The Ascent',
		status: 'sealed',
		description:
			'The only shaft built to reach the surface. Sealed above the Crown by the Directorate 30 years ago; the upper end is overrun by machines.'
	},
	{
		name: 'Spire Lift',
		status: 'restricted',
		description: 'Express lift serving the Crown. Directorate permits checked at every landing.'
	},
	{
		name: 'Central Line',
		status: 'restricted',
		description: 'Main passenger lift through the Hollow. Checkpoints on every level.'
	},
	{
		name: 'Freight Bore',
		status: 'open',
		description:
			'Heavy cargo shaft carrying food down and equipment up. Workers ride it unofficially.'
	},
	{
		name: 'Air Trunk',
		status: 'restricted',
		description:
			'Distributes filtered air from the Crown’s intakes. Flow is metered per level — less the deeper you go.'
	},
	{
		name: 'Old Mine Vent',
		status: 'unregistered',
		description:
			'Hot exhaust vent from the Furnace, never officially mapped. Climbable, barely — the way people move past checkpoints.'
	}
];

export const SHAFT_COLORS: Record<ShaftStatus, string> = {
	open: '#a3e635',
	restricted: '#38bdf8',
	sealed: '#f43f5e',
	unregistered: '#c084fc'
};

export const MAX_DEPTH = LEVELS[LEVELS.length - 1].depth;
