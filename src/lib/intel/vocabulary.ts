import type { LevelCode, Sector } from './types.js';

/**
 * Shared vocabulary: one set of concept codes that every report is mapped onto.
 *
 * Reports describe the same thing in different words ("breathing difficulties",
 * "pulmonary illness", "cough"). Code can only compare them once they share a code, so
 * counting and alert logic works on these codes, never on raw wording.
 *
 * The keyword matching here is the deterministic baseline. Later the Intake agent reads free
 * text and maps it onto the same codes; its output is checked against this list.
 */

export type HealthConcept = 'respiratory' | 'fever' | 'gastrointestinal' | 'heat-illness';

export type InfrastructureConcept =
	| 'ventilation-failure'
	| 'air-quality'
	| 'power-outage'
	| 'heat'
	| 'humidity'
	| 'mould'
	| 'water-quality'
	| 'flooding';

export type SupplyConcept = 'inhaler' | 'filter-mask' | 'oxygen';

export type Concept = HealthConcept | InfrastructureConcept | SupplyConcept;

export type ConceptGroup = 'health' | 'infrastructure' | 'supply';

interface ConceptEntry {
	group: ConceptGroup;
	label: string;
	/** Lowercase phrases that mean this concept. Matched on word boundaries. */
	terms: string[];
}

export const CONCEPTS: Record<Concept, ConceptEntry> = {
	respiratory: {
		group: 'health',
		label: 'Respiratory illness',
		terms: [
			'respiratory',
			'cough',
			'coughing',
			'shortness of breath',
			'short of breath',
			'trouble breathing',
			'breathing difficulties',
			'difficulty breathing',
			'chest tightness',
			'chest pain',
			'pulmonary',
			'lung sickness',
			'wheezing'
		]
	},
	fever: {
		group: 'health',
		label: 'Fever',
		terms: ['fever', 'feverish', 'high temperature', 'chills']
	},
	gastrointestinal: {
		group: 'health',
		label: 'Stomach illness',
		terms: ['diarrhoea', 'diarrhea', 'vomiting', 'stomach cramps', 'nausea']
	},
	'heat-illness': {
		group: 'health',
		label: 'Heat illness',
		terms: ['heat stroke', 'heat exhaustion', 'dehydration', 'fainting']
	},
	'ventilation-failure': {
		group: 'infrastructure',
		label: 'Ventilation failure',
		terms: [
			'fan failure',
			'fans tripped',
			'fans went quiet',
			'did not restart',
			'reduced airflow',
			'ventilation interrupted',
			'ventilation and network service were interrupted'
		]
	},
	'air-quality': {
		group: 'infrastructure',
		label: 'Poor air quality',
		terms: ['co₂', 'co2', 'air feels thick', 'stale air', 'dust', 'smoke']
	},
	'power-outage': {
		group: 'infrastructure',
		label: 'Power outage',
		terms: ['blackout', 'outage', 'power cut', 'lost power']
	},
	heat: {
		group: 'infrastructure',
		label: 'High temperature',
		terms: ['temperature averaged', 'overheating', 'cooling failure', '°c']
	},
	humidity: {
		group: 'infrastructure',
		label: 'High humidity',
		terms: ['humidity', 'damp', 'condensation']
	},
	mould: {
		group: 'infrastructure',
		label: 'Mould',
		terms: ['mould', 'mold', 'fungal growth']
	},
	'water-quality': {
		group: 'infrastructure',
		label: 'Water quality',
		terms: ['turbidity', 'contaminated water', 'bad water', 'discoloured water']
	},
	flooding: {
		group: 'infrastructure',
		label: 'Flooding or sewage',
		terms: ['flooding', 'flooded', 'sewage', 'backed up']
	},
	inhaler: {
		group: 'supply',
		label: 'Inhalers',
		terms: ['inhaler', 'inhalers', 'bronchodilator', 'puffer', 'puffers']
	},
	'filter-mask': {
		group: 'supply',
		label: 'Filter masks',
		terms: ['mask', 'masks', 'filter mask', 'respirator']
	},
	oxygen: {
		group: 'supply',
		label: 'Oxygen',
		terms: ['oxygen', 'o2 canister', 'oxygen canister']
	}
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary matcher per concept, built once. */
const MATCHERS = (Object.entries(CONCEPTS) as [Concept, ConceptEntry][]).map(
	([concept, entry]) =>
		[
			concept,
			new RegExp(
				`(^|[^\\p{L}\\p{N}])(${entry.terms.map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`,
				'iu'
			)
		] as const
);

/** All concepts mentioned in a piece of text, in vocabulary order. */
export function conceptsIn(text: string): Concept[] {
	return MATCHERS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

export function conceptsInGroup(text: string, group: ConceptGroup): Concept[] {
	return conceptsIn(text).filter((c) => CONCEPTS[c].group === group);
}

/**
 * Informal place names residents and crews use, mapped to real places in `hollow/data.ts`.
 * Lets "near the Stackhouse stairs" land on L3 · Stackhouse Vents.
 */
export interface PlaceAlias {
	level: LevelCode;
	place?: string;
	sectors?: Sector[];
}

export const PLACE_ALIASES: Record<string, PlaceAlias> = {
	'stackhouse stairs': { level: 'L3', place: 'Stackhouse Vents', sectors: ['North-West', 'North'] },
	stackhouse: { level: 'L3', place: 'Stackhouse Vents' },
	'north warrens': { level: 'L3', sectors: ['North-West', 'North'] },
	'north-west and north blocks': { level: 'L3', sectors: ['North-West', 'North'] },
	'west warrens': { level: 'L3', sectors: ['West'] },
	'west blocks': { level: 'L3', sectors: ['West'] },
	'the junction': { level: 'L3', place: 'Old Line Junction' },
	'old line': { level: 'L3', place: 'Old Line Junction' },
	commons: { level: 'L2', place: 'Commons Clinic' },
	'the drip': { level: 'L4', place: 'The Drip' },
	'the array': { level: 'L5', place: 'Recycler Array 7' }
};

/** Every alias mentioned in a piece of text, longest first so specific names win. */
export function placeAliasesIn(text: string): (PlaceAlias & { alias: string })[] {
	const lower = text.toLowerCase();
	return Object.keys(PLACE_ALIASES)
		.sort((a, b) => b.length - a.length)
		.filter((alias) => lower.includes(alias))
		.map((alias) => ({ alias, ...PLACE_ALIASES[alias] }));
}
