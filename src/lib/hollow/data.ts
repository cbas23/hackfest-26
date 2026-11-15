export type Status = 'stable' | 'strained' | 'failing' | 'blackout' | 'hostile';
export type DistrictKind =
	| 'city'
	| 'farm'
	| 'plant'
	| 'recycler'
	| 'hub'
	| 'directorate'
	| 'air'
	| 'clinic'
	| 'ruin'
	| 'machine';
export type ShaftStatus = 'open' | 'restricted' | 'sealed' | 'unregistered';

export interface Level {
	id: string;
	index: number;
	code: string;
	name: string;
	depth: string;
	population: string;
	/** 0-1 qualitative conditions */
	light: number;
	air: number;
	heat: number;
	description: string;
	/** radius of the carved area in scene units */
	rx: number;
	rz: number;
}

export interface District {
	id: string;
	level: string;
	name: string;
	kind: DistrictKind;
	status: Status;
	x: number;
	z: number;
	population?: string;
	description: string;
}

export interface Shaft {
	id: string;
	name: string;
	x: number;
	z: number;
	from: string;
	to: string;
	status: ShaftStatus;
	description: string;
}

export const LEVELS: Level[] = [
	{
		id: 'surface',
		index: 0,
		code: 'SURFACE',
		name: 'The Dead Cities',
		depth: '0 m',
		population: '0 humans · unknown machines',
		light: 1,
		air: 0,
		heat: 0.5,
		description:
			'Abandoned 30 years ago after the superstorms. The automated systems humanity left behind still run the ruins and answer to no one. Rumours say the air has cleared.',
		rx: 22,
		rz: 15
	},
	{
		id: 'l1',
		index: 1,
		code: 'L1',
		name: 'The Crown',
		depth: '−80 m',
		population: '≈ 90 M',
		light: 0.9,
		air: 0.9,
		heat: 0.2,
		description:
			'Seat of the Directorate. First access to filtered air, full-spectrum light and open space. Movement down is easy; movement up requires a permit.',
		rx: 12,
		rz: 8
	},
	{
		id: 'l2',
		index: 2,
		code: 'L2',
		name: 'Lampline',
		depth: '−200 m',
		population: '≈ 310 M',
		light: 0.7,
		air: 0.75,
		heat: 0.35,
		description:
			'The breadbasket of the Hollow. Communal farms grow under rationed grow-lamps. Light is metered and sold by the hour.',
		rx: 15,
		rz: 9.5
	},
	{
		id: 'l3',
		index: 3,
		code: 'L3',
		name: 'The Warrens',
		depth: '−350 m',
		population: '≈ 620 M',
		light: 0.45,
		air: 0.5,
		heat: 0.5,
		description:
			'Old subway tunnels turned into stacked housing. The most crowded level in the Hollow. Lung sickness clusters reported in every district.',
		rx: 17,
		rz: 10.5
	},
	{
		id: 'l4',
		index: 4,
		code: 'L4',
		name: 'Lowmarch',
		depth: '−520 m',
		population: '≈ 580 M',
		light: 0.3,
		air: 0.35,
		heat: 0.65,
		description:
			'Former mine galleries. Recycled water tastes of metal. Rolling blackouts every week; the black market runs when the lights don’t.',
		rx: 17.5,
		rz: 11
	},
	{
		id: 'l5',
		index: 5,
		code: 'L5',
		name: 'The Sump',
		depth: '−700 m',
		population: '≈ 390 M',
		light: 0.12,
		air: 0.2,
		heat: 0.85,
		description:
			'Where the water ends up. Recycler arrays are breaking down. Blackouts last for days and hit here first. Official sickness figures are lowest here, which nobody believes.',
		rx: 16,
		rz: 10.5
	},
	{
		id: 'l6',
		index: 6,
		code: 'L6',
		name: 'The Furnace',
		depth: '−900 m',
		population: '≈ 12 M (work crews)',
		light: 0.08,
		air: 0.15,
		heat: 1,
		description:
			'Aging geothermal plants that power the entire Hollow. Rotating work crews only. Every failure here is felt on every level above.',
		rx: 13,
		rz: 9
	}
];

export const DISTRICTS: District[] = [
	// Surface
	{
		id: 'old-meridian',
		level: 'surface',
		name: 'Old Meridian',
		kind: 'ruin',
		status: 'hostile',
		x: -9,
		z: -3,
		description:
			'The largest of the dead cities, directly above the Crown. Towers still lit at night.'
	},
	{
		id: 'foundry',
		level: 'surface',
		name: 'The Foundry',
		kind: 'machine',
		status: 'hostile',
		x: 10,
		z: 5,
		description:
			'An automated factory complex that never stopped. Drones patrol its perimeter and the shaft heads around it.'
	},
	{
		id: 'grid-north',
		level: 'surface',
		name: 'Grid North',
		kind: 'machine',
		status: 'hostile',
		x: 6,
		z: -9,
		description:
			'Field of self-maintaining solar arrays and relay masts. Origin of unexplained signals.'
	},
	// L1
	{
		id: 'spire',
		level: 'l1',
		name: 'Directorate Spire',
		kind: 'directorate',
		status: 'stable',
		x: -3,
		z: -2,
		population: '4 M',
		description:
			'Administrative heart of the Hollow. Controls the air supply, the network and all level transit.'
	},
	{
		id: 'intake',
		level: 'l1',
		name: 'Intake North',
		kind: 'air',
		status: 'stable',
		x: 6,
		z: -4,
		population: '2 M',
		description:
			'Primary air filtration plant. Every breath in the Hollow passes through here first.'
	},
	{
		id: 'terraces',
		level: 'l1',
		name: 'Crown Terraces',
		kind: 'city',
		status: 'stable',
		x: 4,
		z: 4,
		population: '62 M',
		description:
			'Wide galleries, daylight lamps, private gardens. Directorate families and contractors.'
	},
	{
		id: 'signal-hall',
		level: 'l1',
		name: 'Signal Hall',
		kind: 'hub',
		status: 'stable',
		x: -8,
		z: 3,
		population: '22 M',
		description: 'Network core and level-transit control. All lift permits are issued here.'
	},
	// L2
	{
		id: 'greenhall',
		level: 'l2',
		name: 'Greenhall Farms',
		kind: 'farm',
		status: 'stable',
		x: -9,
		z: -3,
		population: '70 M',
		description: 'The largest communal farm. Feeds roughly a third of the Hollow.'
	},
	{
		id: 'lamp-market',
		level: 'l2',
		name: 'Lamp Market',
		kind: 'city',
		status: 'stable',
		x: 0,
		z: 1,
		population: '140 M',
		description: 'Trade hub where light-hours, water chits and food rations change hands.'
	},
	{
		id: 'eastbore',
		level: 'l2',
		name: 'Eastbore Farms',
		kind: 'farm',
		status: 'strained',
		x: 9,
		z: -2,
		population: '60 M',
		description: 'Yields falling as lamp output is cut to save power for upper levels.'
	},
	{
		id: 'commons',
		level: 'l2',
		name: 'The Commons',
		kind: 'city',
		status: 'stable',
		x: 3,
		z: 7,
		population: '40 M',
		description: 'Communal kitchens and dormitories for farm crews.'
	},
	// L3
	{
		id: 'junction',
		level: 'l3',
		name: 'Old Line Junction',
		kind: 'hub',
		status: 'strained',
		x: 0,
		z: -1,
		population: '120 M',
		description:
			'Where five pre-collapse subway lines met. Now the busiest crossroads in the Hollow.'
	},
	{
		id: 'stackhouse',
		level: 'l3',
		name: 'Stackhouse',
		kind: 'city',
		status: 'strained',
		x: -10,
		z: 3,
		population: '260 M',
		description: 'Bunk housing stacked twelve high inside a former rail depot.'
	},
	{
		id: 'kiln-row',
		level: 'l3',
		name: 'Kiln Row',
		kind: 'city',
		status: 'strained',
		x: 10,
		z: 4,
		population: '200 M',
		description: 'Workshops and fabrication. Air thick with dust; lung sickness reported widely.'
	},
	{
		id: 'clinic-nine',
		level: 'l3',
		name: 'Clinic Nine',
		kind: 'clinic',
		status: 'failing',
		x: 6,
		z: -7,
		population: '40 M',
		description:
			'Main hospital below the Crown. Overwhelmed by lung sickness. Its patient count does not match Directorate reports.'
	},
	// L4
	{
		id: 'ironbore',
		level: 'l4',
		name: 'Ironbore',
		kind: 'city',
		status: 'strained',
		x: -9,
		z: -4,
		population: '210 M',
		description: 'Old mine galleries converted to housing. Ceilings low, corridors endless.'
	},
	{
		id: 'hollowmere',
		level: 'l4',
		name: 'Hollowmere',
		kind: 'city',
		status: 'blackout',
		x: 8,
		z: -3,
		population: '230 M',
		description: 'Built around a flooded cavern. Currently in its fourth day without power.'
	},
	{
		id: 'the-drip',
		level: 'l4',
		name: 'The Drip',
		kind: 'recycler',
		status: 'failing',
		x: 0,
		z: 6,
		population: '80 M',
		description: 'Mid-level water recycler. Running at 40% capacity; water rations halved.'
	},
	{
		id: 'night-market',
		level: 'l4',
		name: 'Night Market',
		kind: 'hub',
		status: 'strained',
		x: -2,
		z: -1,
		population: '60 M',
		description: 'Unofficial exchange. Batteries, filters, rumours of the surface.'
	},
	// L5
	{
		id: 'array-7',
		level: 'l5',
		name: 'Recycler Array 7',
		kind: 'recycler',
		status: 'failing',
		x: -6,
		z: -4,
		population: '30 M',
		description: 'The largest water recycler in the Hollow. Three of eight units offline.'
	},
	{
		id: 'sumpside',
		level: 'l5',
		name: 'Sumpside',
		kind: 'city',
		status: 'blackout',
		x: 7,
		z: 1,
		population: '220 M',
		description: 'Densest settlement of the deep levels. Blackout ongoing for six days.'
	},
	{
		id: 'ashwell',
		level: 'l5',
		name: 'Ashwell',
		kind: 'city',
		status: 'blackout',
		x: -5,
		z: 6,
		population: '140 M',
		description: 'Hot, humid and dark. Highest unofficial count of lung sickness in the Hollow.'
	},
	// L6
	{
		id: 'plant-alpha',
		level: 'l6',
		name: 'Geothermal Alpha',
		kind: 'plant',
		status: 'strained',
		x: -6,
		z: -2,
		population: '5 M',
		description: 'Oldest geothermal plant, 60+ years in service. Output down 30% this decade.'
	},
	{
		id: 'plant-beta',
		level: 'l6',
		name: 'Geothermal Beta',
		kind: 'plant',
		status: 'failing',
		x: 6,
		z: 2,
		population: '4 M',
		description: 'Turbine hall partially collapsed. Its failures trigger the deep-level blackouts.'
	},
	{
		id: 'vent-works',
		level: 'l6',
		name: 'Vent Works',
		kind: 'air',
		status: 'strained',
		x: 0,
		z: -6,
		population: '3 M',
		description: 'Exhausts heat and bad air upward through the old mine vents.'
	}
];

export const TUNNELS: [string, string][] = [
	['spire', 'intake'],
	['spire', 'terraces'],
	['spire', 'signal-hall'],
	['terraces', 'intake'],
	['greenhall', 'lamp-market'],
	['lamp-market', 'eastbore'],
	['lamp-market', 'commons'],
	['greenhall', 'commons'],
	['junction', 'stackhouse'],
	['junction', 'kiln-row'],
	['junction', 'clinic-nine'],
	['kiln-row', 'clinic-nine'],
	['stackhouse', 'kiln-row'],
	['ironbore', 'night-market'],
	['night-market', 'hollowmere'],
	['night-market', 'the-drip'],
	['ironbore', 'the-drip'],
	['array-7', 'sumpside'],
	['array-7', 'ashwell'],
	['ashwell', 'sumpside'],
	['plant-alpha', 'plant-beta'],
	['plant-alpha', 'vent-works'],
	['vent-works', 'plant-beta'],
	['old-meridian', 'foundry'],
	['foundry', 'grid-north'],
	['old-meridian', 'grid-north']
];

export const SHAFTS: Shaft[] = [
	{
		id: 'ascent',
		name: 'The Ascent',
		x: -7,
		z: -1,
		from: 'l1',
		to: 'surface',
		status: 'sealed',
		description:
			'The only shaft built to reach the surface. Sealed by the Directorate 30 years ago; the upper end is overrun by machines.'
	},
	{
		id: 'spire-lift',
		name: 'Spire Lift',
		x: -2,
		z: -4,
		from: 'l2',
		to: 'l1',
		status: 'restricted',
		description: 'Express lift from Lampline to the Crown. Directorate permits only.'
	},
	{
		id: 'central-line',
		name: 'Central Line',
		x: 1,
		z: 0,
		from: 'l5',
		to: 'l2',
		status: 'restricted',
		description: 'Main passenger lift through the middle levels. Checkpoints at every level.'
	},
	{
		id: 'freight-bore',
		name: 'Freight Bore',
		x: 8.5,
		z: -0.5,
		from: 'l6',
		to: 'l2',
		status: 'open',
		description:
			'Heavy cargo shaft carrying food down and equipment up. Workers ride it unofficially.'
	},
	{
		id: 'air-trunk',
		name: 'Air Trunk',
		x: 5,
		z: -6,
		from: 'l5',
		to: 'l1',
		status: 'restricted',
		description:
			'Distributes filtered air from Intake North. Flow is metered per level — less the deeper you go.'
	},
	{
		id: 'old-vent',
		name: 'Old Mine Vent',
		x: -1,
		z: -6.5,
		from: 'l6',
		to: 'l4',
		status: 'open',
		description: 'Hot exhaust vent from the Furnace. Climbable, barely.'
	},
	{
		id: 'crawl',
		name: 'The Crawl',
		x: -9,
		z: 4.5,
		from: 'l5',
		to: 'l3',
		status: 'unregistered',
		description: 'Unmapped maintenance crawlway used to move people and goods past checkpoints.'
	}
];

export const STATUS_COLORS: Record<Status, string> = {
	stable: '#5eead4',
	strained: '#fbbf24',
	failing: '#f97316',
	blackout: '#64748b',
	hostile: '#f43f5e'
};

export const SHAFT_COLORS: Record<ShaftStatus, string> = {
	open: '#a3e635',
	restricted: '#38bdf8',
	sealed: '#f43f5e',
	unregistered: '#c084fc'
};

export const KIND_LABELS: Record<DistrictKind, string> = {
	city: 'Habitation',
	farm: 'Farm',
	plant: 'Geothermal plant',
	recycler: 'Water recycler',
	hub: 'Hub',
	directorate: 'Directorate',
	air: 'Air plant',
	clinic: 'Clinic',
	ruin: 'Ruins',
	machine: 'Machine zone'
};

export const LEVEL_SPACING = 6;
export const levelY = (index: number) => -index * LEVEL_SPACING;
export const levelById = (id: string) => LEVELS.find((l) => l.id === id)!;
