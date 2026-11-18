/**
 * Hollow Hotline: keyword extraction and risk scoring.
 *
 * Pure functions shared by the server (webhook) and the dashboard, so both always agree.
 *
 *   report_weight = severity × household × recency
 *   cluster_bonus = 0.25 × (same-category reports within 2 levels in the last 24 h), max 2.0
 *   points        = report_weight × (1 + cluster_bonus)
 *   risk %        = 100 × (1 − e^(−total_points / 20))
 */

import { buildingByKey, findBuilding, type Building } from './places.js';

export type Category = 'lungs' | 'water' | 'power' | 'air';
export const CATEGORIES: Category[] = ['lungs', 'water', 'power', 'air'];

export const CAT_INFO: Record<Category, { label: string; color: string; score: string }> = {
	lungs: { label: 'Lungs', color: '#ef4444', score: 'Outbreak' },
	water: { label: 'Water', color: '#3b82f6', score: 'Water' },
	power: { label: 'Power', color: '#eab308', score: 'Blackout' },
	air: { label: 'Heat / air', color: '#f97316', score: 'Heat' }
};

export const LEVEL_COUNT = 7;
const HOUR = 3_600_000;

// ── Extraction ────────────────────────────────────────────────────────────

interface Rule {
	cat: Category;
	group: string;
	re: RegExp;
	severe?: boolean;
}

const RULES: Rule[] = [
	{ cat: 'water', group: 'cloudy', re: /\bcloudy\b/gi },
	{ cat: 'water', group: 'metallic', re: /\bmetallic\b/gi },
	{ cat: 'water', group: 'smell', re: /\b(bad[- ]smelling|smells? (bad|awful|wrong)|stinks?)\b/gi },
	{
		cat: 'water',
		group: 'contaminated',
		re: /\b(contaminated|filthy|dirty water|brown water)\b/gi
	},
	{ cat: 'water', group: 'sick-drinking', re: /\bsick after drinking\b/gi },
	{ cat: 'lungs', group: 'cough', re: /\bcough(s|ing|ed)?\b/gi },
	{ cat: 'lungs', group: 'wheeze', re: /\bwheez\w*/gi },
	{
		cat: 'lungs',
		group: 'breath',
		re: /\b(short of breath|trouble breathing|can'?t breathe)\b/gi,
		severe: true
	},
	{ cat: 'lungs', group: 'fever', re: /\bfevers?\b/gi, severe: true },
	{ cat: 'lungs', group: 'chest', re: /\bchest( pain| hurts?)?\b/gi },
	{ cat: 'lungs', group: 'lung', re: /\blungs?( sickness| hurt| hurts)?\b/gi },
	{ cat: 'power', group: 'flicker', re: /\bflicker\w*/gi },
	{
		cat: 'power',
		group: 'out',
		re: /\b(lights (are |went |keep going )?out|blackouts?|no power|power('s| is)? out)\b/gi
	},
	{ cat: 'air', group: 'hot', re: /\b(so hot|hotter|too hot|heat)\b/gi },
	{ cat: 'air', group: 'stale', re: /\b(stale|thick) air\b|\bair is (stale|thick)\b/gi }
];

export interface Match {
	start: number;
	end: number;
	cat: Category;
	group: string;
	severe: boolean;
}

/** Keyword hits in a piece of text, in order, without overlaps. */
export function findKeywords(text: string): Match[] {
	const t = text.replace(/[’‘]/g, "'");
	const out: Match[] = [];
	for (const r of RULES) {
		for (const m of t.matchAll(r.re)) {
			const start = m.index!;
			const end = start + m[0].length;
			if (out.some((o) => start < o.end && end > o.start)) continue;
			out.push({ start, end, cat: r.cat, group: r.group, severe: !!r.severe });
		}
	}
	return out.sort((a, b) => a.start - b.start);
}

const NUM: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10
};
const num = (s: string) => NUM[s.toLowerCase()] ?? Number(s);

export interface Extracted {
	level: number;
	levelGuessed: boolean;
	name: string | null;
	anonymous: boolean;
	people: number;
	matches: Match[];
	categories: Category[];
	/** Named building the caller is at, if they said one. */
	building: Building | null;
	/** Caller said they can't get to a clinic (needs a delivery instead). */
	cantReachClinic: boolean;
}

/** Turn what the caller said into structured fields. */
export function extract(callerText: string): Extracted {
	const text = callerText.replace(/[’‘]/g, "'");
	const lower = text.toLowerCase();

	let level: number | null = null;
	const lv = lower.match(/\blevel\s+(\d{1,3}|one|two|three|four|five|six|seven)\b/);
	if (lv) level = num(lv[1]);
	else if (/\bdeep\b/.test(lower)) level = 6;
	else if (/\bmiddle\b/.test(lower)) level = 4;
	else if (/\b(top|upper)\b/.test(lower)) level = 2;
	// A named building also tells us the level when the caller didn't say one.
	const building = findBuilding(text, level ?? undefined);
	if (level === null && building) level = building.level;
	const levelGuessed = level === null;
	level = Math.min(LEVEL_COUNT, Math.max(1, level ?? 4));

	let people = 1;
	const n = lower.match(
		/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(of us|people|kids|children|in my household)\b/
	);
	if (n) people = num(n[1]);
	else if (/\bmy (whole )?family\b|\beveryone (at home|in my house)\b/.test(lower)) people = 4;
	else if (/\b\w+ and i\b|\bboth of us\b|\bwe('ve| have| are| both)\b/.test(lower)) people = 2;

	const nm = text.match(/\b(?:my name is|[Tt]his is|I'm|I am)\s+([A-Z][a-z]+)\b/);
	const anonymous = !nm || /\banonymous\b/i.test(text);

	const matches = findKeywords(text);
	const categories = CATEGORIES.filter((c) => matches.some((m) => m.cat === c));
	return {
		level,
		levelGuessed,
		name: anonymous ? null : nm![1],
		anonymous,
		people,
		matches,
		categories,
		building: building && building.level === level ? building : null,
		cantReachClinic:
			/\b(can'?t|cannot|won'?t be able to|unable to|not able to)\s+(get|go|make it|walk|reach)\s+(to\s+)?(the\s+|a\s+)?clinic\b|\btoo sick to (walk|move|go|leave)\b|\bneed (a |the )?deliver(y|ed)\b|\bbring (them|it|supplies|medicine) to\b/i.test(
				text
			)
	};
}

// ── Weighting ─────────────────────────────────────────────────────────────

export function severityOf(matches: Match[]) {
	if (matches.some((m) => m.severe)) return 2.0;
	const symptoms = new Set(matches.map((m) => (m.cat === 'lungs' ? m.group : m.cat)));
	return symptoms.size >= 2 ? 1.5 : 1.0;
}
export const householdOf = (people: number) => (people >= 5 ? 1.6 : people >= 2 ? 1.3 : 1.0);
export const recencyOf = (ageHours: number) => (ageHours <= 6 ? 1.0 : ageHours <= 24 ? 0.6 : 0.2);

export interface Line {
	role: 'agent' | 'caller';
	text: string;
}

export interface Report extends Extracted {
	id: string;
	t: number;
	transcript: Line[];
	severity: number;
	household: number;
	recency: number;
	weight: number;
	/** Nearby same-category reports counted for the cluster bonus. */
	nearby: Partial<Record<Category, number>>;
	points: Partial<Record<Category, number>>;
	seed?: boolean;
	source: 'phone' | 'simulated' | 'seed';
}

export interface ReportInput {
	transcript: Line[];
	t?: number;
	source: Report['source'];
	/** Structured fields from the voice agent; override what the regexes found. */
	fields?: Partial<{
		level: number;
		name: string;
		people: number;
		anonymous: boolean;
		building: string;
		/** Caller can't get to a clinic and needs supplies brought to them. */
		needsDelivery: boolean;
	}>;
	/** Pin the report to a known building (used for seeded reports). */
	buildingKey?: string;
}

export const callerText = (lines: Line[]) =>
	lines
		.filter((l) => l.role === 'caller')
		.map((l) => l.text)
		.join(' ');

/** Score a new report against the ones already received. */
export function buildReport(input: ReportInput, existing: Report[], now = Date.now()): Report {
	const t = input.t ?? now;
	const ex = extract(callerText(input.transcript));
	const f = input.fields ?? {};
	if (f.level) ex.level = Math.min(LEVEL_COUNT, Math.max(1, Math.round(f.level)));
	if (f.people) ex.people = f.people;
	if (f.name && !f.anonymous) {
		ex.name = f.name;
		ex.anonymous = false;
	}
	if (f.needsDelivery) ex.cantReachClinic = true;
	if (f.building) ex.building = findBuilding(f.building, ex.level) ?? ex.building;
	if (input.buildingKey) ex.building = buildingByKey(input.buildingKey) ?? ex.building;
	if (ex.building && ex.building.level !== ex.level) ex.building = null;

	const severity = severityOf(ex.matches);
	const household = householdOf(ex.people);
	const recency = recencyOf((now - t) / HOUR);
	const weight = severity * household * recency;

	const nearby: Report['nearby'] = {};
	const points: Report['points'] = {};
	for (const c of ex.categories) {
		const count = existing.filter(
			(r) =>
				r.categories.includes(c) &&
				Math.abs(r.level - ex.level) <= 2 &&
				r.t <= t &&
				t - r.t <= 24 * HOUR
		).length;
		nearby[c] = count;
		points[c] = weight * (1 + Math.min(2, 0.25 * count));
	}

	return {
		...ex,
		id: `R${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		t,
		transcript: input.transcript,
		severity,
		household,
		recency,
		weight,
		nearby,
		points,
		source: input.source,
		...(input.source === 'seed' ? { seed: true } : {})
	};
}

// ── Scores ────────────────────────────────────────────────────────────────

export const riskOf = (points: number) => 100 * (1 - Math.exp(-points / 20));

export function bandPoints(reports: Report[], cat: Category, lo: number, hi: number) {
	let p = 0;
	for (const r of reports) if (r.level >= lo && r.level <= hi) p += r.points[cat] ?? 0;
	return p;
}

export interface Band {
	cat: Category;
	lo: number;
	hi: number;
	points: number;
	risk: number;
}

/** The 3-level band with the highest score for a category. */
export function hottestBand(reports: Report[], cat: Category): Band {
	let best: Band = { cat, lo: 1, hi: 3, points: 0, risk: 0 };
	for (let lo = 1; lo <= LEVEL_COUNT - 2; lo++) {
		const points = bandPoints(reports, cat, lo, lo + 2);
		if (points > best.points) best = { cat, lo, hi: lo + 2, points, risk: riskOf(points) };
	}
	return best;
}

/** A level's own score: its reports plus the levels right above and below. */
export const levelRisk = (reports: Report[], cat: Category, level: number) =>
	riskOf(bandPoints(reports, cat, Math.max(1, level - 1), Math.min(LEVEL_COUNT, level + 1)));

export type AlertLevel = 'normal' | 'watch' | 'warning' | 'outbreak';
export function alertLevel(risk: number): AlertLevel {
	return risk >= 80 ? 'outbreak' : risk >= 60 ? 'warning' : risk >= 40 ? 'watch' : 'normal';
}
export const ALERT_INFO: Record<AlertLevel, { label: string; color: string }> = {
	normal: { label: 'Normal', color: '#22c55e' },
	watch: { label: 'Watch', color: '#eab308' },
	warning: { label: 'Warning', color: '#f97316' },
	outbreak: { label: 'Outbreak declared', color: '#ef4444' }
};

export interface Alert {
	cat: Category;
	band: Band;
	level: AlertLevel;
	title: string;
	advice: string;
}

/** Banners for every category at warning (60%) or above. */
export function alerts(reports: Report[]): Alert[] {
	const out: Alert[] = [];
	for (const cat of CATEGORIES) {
		const band = hottestBand(reports, cat);
		const level = alertLevel(band.risk);
		if (level !== 'warning' && level !== 'outbreak') continue;
		const where = `Levels ${band.lo} to ${band.hi}`;
		const copy: Record<Category, [string, string]> = {
			lungs: [
				level === 'outbreak' ? `Outbreak declared, ${where}` : `Lung sickness warning, ${where}`,
				level === 'outbreak'
					? 'Oxygen and inhalers flagged for dispatch. Masks in all corridors.'
					: 'Masks in corridors. Anyone short of breath, go to the nearest clinic.'
			],
			water: [
				`Water contamination cluster, ${where}`,
				'Do not drink from block taps. Boil or use sealed water.'
			],
			power: [
				`Blackout spreading, ${where}`,
				'Charge lamps now. Check on neighbors who rely on power.'
			],
			air: [
				`Heat and air warning, ${where}`,
				'Move vulnerable residents to cooler blocks. Keep vents clear.'
			]
		};
		out.push({ cat, band, level, title: copy[cat][0], advice: copy[cat][1] });
	}
	return out.sort((a, b) => b.band.risk - a.band.risk);
}
