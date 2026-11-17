import { CURRENT_WEEK, EXPECTED_CONFIRMED_SHARE, HISTORY, PAST_INCIDENTS } from './history.js';
import type { PastIncident, WeeklyRecord } from './history.js';
import type { LevelCode, Report, ReportFigure, Sector } from './types.js';
import { conceptsIn } from './vocabulary.js';

/**
 * Detection logic. Plain code, no AI: every number the app shows about an outbreak comes from
 * here, so it can be checked and explained.
 *
 * Three jobs:
 * 1. Compare this week with normal (history) and say how unusual it is.
 * 2. Turn overlapping local reports into a range instead of a sum, and split the gap with the
 *    Directorate into the part their definition explains and the part it doesn't.
 * 3. Flag late and missing data, so a blackout reads as "incomplete", not as fewer sick people.
 */

const HOUR = 36e5;

/** Dates without a time mean the end of that day; all times are in the Hollow's local clock. */
function toMs(s: string, endOfDay = false): number {
	if (s.length === 10) return Date.parse(`${s}T${endOfDay ? '23:59' : '00:00'}`);
	return Date.parse(s);
}

function overlapsCurrentWeek(r: Report): boolean {
	return (
		toMs(r.period.start) <= toMs(CURRENT_WEEK.end, true) &&
		toMs(r.period.end, true) >= toMs(CURRENT_WEEK.start)
	);
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------
// 1. Normal vs now
// ---------------------------------------------------------------------------

export type Metric = 'clinicPatients' | 'inhalersDispensed';
export type Severity = 'normal' | 'watch' | 'alert';

export interface Baseline {
	level: LevelCode;
	metric: Metric;
	/** Weeks used: incident weeks are left out so a past outbreak doesn't raise "normal". */
	weeks: number;
	mean: number;
	sd: number;
	/** Lowest and highest value seen in a normal week. */
	low: number;
	high: number;
}

export function baselineFor(
	level: LevelCode,
	metric: Metric,
	history: WeeklyRecord[] = HISTORY
): Baseline {
	const values = history.filter((w) => w.level === level && !w.incidentId).map((w) => w[metric]);
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	// Weekly case counts vary at least as much as a Poisson count (√mean), even when 16 weeks of
	// history happen to look calmer. The floor keeps z-scores honest on small numbers.
	const observed = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
	const sd = Math.max(observed, Math.sqrt(mean));
	return {
		level,
		metric,
		weeks: values.length,
		mean: round1(mean),
		sd: round1(sd),
		low: Math.min(...values),
		high: Math.max(...values)
	};
}

export interface Anomaly {
	baseline: Baseline;
	value: number;
	/** value ÷ normal, e.g. 3.5 means "3.5× normal". */
	ratio: number;
	/** How many standard deviations above normal. */
	z: number;
	severity: Severity;
	/** The past incident this week is bigger than, if any. */
	exceedsIncident?: PastIncident;
}

/**
 * Alert: at least twice normal and far outside normal noise (z ≥ 3).
 * Watch: clearly above normal (≥ 1.25×, or z ≥ 2) but not yet an alert.
 * Both conditions matter: on small levels a jump from 2 to 4 is "2×" but still noise.
 */
export function compareToNormal(
	level: LevelCode,
	metric: Metric,
	value: number,
	history: WeeklyRecord[] = HISTORY
): Anomaly {
	const baseline = baselineFor(level, metric, history);
	const ratio = round1(value / Math.max(baseline.mean, 1));
	const z = round1((value - baseline.mean) / baseline.sd);
	const severity: Severity =
		ratio >= 2 && z >= 3 ? 'alert' : ratio >= 1.25 || z >= 2 ? 'watch' : 'normal';

	let exceedsIncident: PastIncident | undefined;
	if (metric === 'clinicPatients') {
		exceedsIncident = PAST_INCIDENTS.find((inc) => {
			const peak = history.find((w) => w.level === inc.level && w.isoWeek === inc.isoWeeks[0]);
			return inc.level === level && peak !== undefined && value > peak.clinicPatients;
		});
	}

	return { baseline, value, ratio, z, severity, ...(exceedsIncident ? { exceedsIncident } : {}) };
}

// ---------------------------------------------------------------------------
// 2. Ranges, not sums, and the Directorate gap
// ---------------------------------------------------------------------------

/**
 * The figure in a report that counts people with respiratory symptoms: a `patients` or
 * `reports` count whose label maps to the respiratory concept. Sub-counts such as "admitted for
 * oxygen" and other units such as households are left out, so nobody is counted twice inside
 * one report.
 */
export function caseFigure(r: Report): ReportFigure | undefined {
	return r.figures.find(
		(f) =>
			(f.countType === 'patients' || f.countType === 'reports') &&
			(f.unit === 'patients' || f.unit === 'reports') &&
			conceptsIn(f.label).includes('respiratory')
	);
}

export interface CaseSource {
	reportId: string;
	value: number;
	countType: 'patients' | 'reports';
	verified: boolean;
}

export interface CaseRange {
	level: LevelCode;
	sources: CaseSource[];
	/** People counted by verified clinics with resident IDs: the number we're certain of. */
	verified: number;
	/** The largest single source: at least this many people say they're sick. */
	likely: number;
	/** Every source added up: only true if nobody was counted twice. An upper bound, never the answer. */
	high: number;
}

/**
 * Local sources overlap (a resident can see the clinic, tell the coordinator and use the kiosk),
 * so they are never added into one number. The result is a range: from what is verified, through
 * the largest single source, up to the total if nobody appears twice.
 */
export function caseRange(level: LevelCode, reports: Report[]): CaseRange {
	const sources: CaseSource[] = [];
	for (const r of reports) {
		if (r.location.level !== level || !overlapsCurrentWeek(r)) continue;
		const f = caseFigure(r);
		if (!f) continue;
		sources.push({
			reportId: r.id,
			value: f.value,
			countType: f.countType as 'patients' | 'reports',
			verified: r.verification === 'verified' && f.countType === 'patients'
		});
	}
	const verified = sources.filter((s) => s.verified).reduce((a, s) => a + s.value, 0);
	const likely = Math.max(0, ...sources.map((s) => s.value));
	const high = sources.reduce((a, s) => a + s.value, 0);
	return { level, sources, verified, likely, high };
}

export interface DirectorateGap {
	level: LevelCode;
	/** Verified clinic patients this week (the conservative local figure). */
	local: number;
	/** Lab-confirmed cases in the Directorate bulletin. */
	confirmed: number;
	/** What the Directorate would report if it confirmed cases at the usual rate. */
	expectedConfirmed: number;
	/** Part of the gap explained by "lab-confirmed" being a narrower definition. */
	expectedGap: number;
	/** Part of the gap the definition does not explain. */
	unexplainedGap: number;
	/** confirmed ÷ local this week. */
	shareNow: number;
	/** confirmed ÷ clinic patients over the 16 weeks of history. */
	shareHistory: number;
	/** The unexplained part is big enough to raise. */
	flagged: boolean;
	/** This week's share is in line with the level's long-run share: a pattern, not a one-off. */
	consistentWithHistory: boolean;
	bulletinId?: string;
}

/**
 * Splits the gap between local counts and the Directorate's bulletin in two:
 * - expected: "lab-confirmed" is narrower than "patients with symptoms". On levels with test
 *   sites the Directorate confirms about 85% of patients, so that much gap is normal.
 * - unexplained: whatever is left. Only this part is flagged, so the system doesn't accuse the
 *   Directorate by default.
 * Uses verified clinic patients only, so the flag still holds if every unverified report is wrong.
 */
export function directorateGap(
	level: LevelCode,
	reports: Report[],
	history: WeeklyRecord[] = HISTORY
): DirectorateGap | undefined {
	const bulletin = reports.find(
		(r) => r.source === 'directorate' && r.location.level === level && overlapsCurrentWeek(r)
	);
	const confirmedFig = bulletin?.figures.find((f) => f.countType === 'confirmed');
	if (!bulletin || !confirmedFig) return undefined;

	const local = caseRange(level, reports).verified;
	const confirmed = confirmedFig.value;
	const expectedConfirmed = Math.round(local * EXPECTED_CONFIRMED_SHARE);
	const expectedGap = Math.max(0, local - expectedConfirmed);
	const unexplainedGap = Math.max(0, expectedConfirmed - confirmed);

	const weeks = history.filter((w) => w.level === level);
	const patients = weeks.reduce((a, w) => a + w.clinicPatients, 0);
	const conf = weeks.reduce((a, w) => a + w.directorateConfirmed, 0);
	const shareHistory = patients ? Math.round((conf / patients) * 100) / 100 : 0;
	const shareNow = local ? Math.round((confirmed / local) * 100) / 100 : 0;

	return {
		level,
		local,
		confirmed,
		expectedConfirmed,
		expectedGap,
		unexplainedGap,
		shareNow,
		shareHistory,
		// At least 3 people and at least a fifth of local patients unexplained.
		flagged: unexplainedGap >= 3 && unexplainedGap >= local * 0.2,
		consistentWithHistory: Math.abs(shareNow - shareHistory) <= 0.15,
		bulletinId: bulletin.id
	};
}

// ---------------------------------------------------------------------------
// 3. Late and missing data
// ---------------------------------------------------------------------------

export type Freshness = 'on-time' | 'late';

export interface ReportTiming {
	reportId: string;
	/** Hours from the end of the reporting period to arrival. */
	hoursAfterPeriod: number;
	/** Hours from being sent to arriving. Long means it was stuck on the way. */
	hoursInTransit: number;
	freshness: Freshness;
	reason?: string;
}

/** Usual hours from the end of the week to a clinic report arriving, from history. */
export function usualLagHours(level: LevelCode, history: WeeklyRecord[] = HISTORY): number {
	return median(
		history.filter((w) => w.level === level && w.blackoutHours === 0).map((w) => w.receivedLagHours)
	);
}

/** A report is late if it spent more than a day in transit. */
export function reportTiming(r: Report): ReportTiming {
	const received = toMs(r.receivedAt);
	const hoursAfterPeriod = Math.round((received - toMs(r.period.end, true)) / HOUR);
	const hoursInTransit = Math.round((received - toMs(r.submittedAt)) / HOUR);
	const late = hoursInTransit > 24;
	return {
		reportId: r.id,
		hoursAfterPeriod,
		hoursInTransit,
		freshness: late ? 'late' : 'on-time',
		...(late ? { reason: `sent ${hoursInTransit} h before it arrived` } : {})
	};
}

export interface LevelCompleteness {
	level: LevelCode;
	complete: boolean;
	/** Why the numbers for this week may be too low. */
	reasons: string[];
	blackoutHours: number;
	lateReports: string[];
	hasClinicReport: boolean;
}

/**
 * Whether this week's numbers for a level can be read at face value. A blackout this week, a
 * report that arrived late, or no clinic report at all mean the count may still rise: the app
 * shows "incomplete", never a drop.
 */
export function levelCompleteness(level: LevelCode, reports: Report[]): LevelCompleteness {
	const mine = reports.filter((r) => r.location.level === level && overlapsCurrentWeek(r));
	const reasons: string[] = [];

	const outages = mine.filter((r) => conceptsIn(`${r.title} ${r.body}`).includes('power-outage'));
	const blackoutHours = outages.reduce(
		(a, r) => a + (r.figures.find((f) => f.unit === 'hours')?.value ?? 0),
		0
	);
	if (blackoutHours > 0) reasons.push(`${blackoutHours} h blackout this week`);

	const lateReports = mine.filter((x) => reportTiming(x).freshness === 'late').map((x) => x.id);
	if (lateReports.length) reasons.push(`${lateReports.length} report(s) arrived late`);

	const hasClinicReport = mine.some((x) => x.source === 'clinic');
	if (!hasClinicReport) reasons.push('no clinic report yet');

	return {
		level,
		complete: reasons.length === 0,
		reasons,
		blackoutHours,
		lateReports,
		hasClinicReport
	};
}

// ---------------------------------------------------------------------------
// Everything for one level
// ---------------------------------------------------------------------------

export interface LevelAssessment {
	level: LevelCode;
	patients?: Anomaly;
	inhalers?: Anomaly;
	range: CaseRange;
	gap?: DirectorateGap;
	completeness: LevelCompleteness;
}

/** This week's verified clinic patients, or undefined if no clinic reported. */
function clinicPatientsNow(level: LevelCode, reports: Report[]): number | undefined {
	const range = caseRange(level, reports);
	return range.sources.some((s) => s.verified) ? range.verified : undefined;
}

function inhalersNow(level: LevelCode, reports: Report[]): number | undefined {
	for (const r of reports) {
		if (r.location.level !== level || !overlapsCurrentWeek(r)) continue;
		const f = r.figures.find((f) => /dispensed this week/i.test(f.label) && f.unit === 'inhalers');
		if (f) return f.value;
	}
	return undefined;
}

export function assessLevel(level: LevelCode, reports: Report[]): LevelAssessment {
	const patients = clinicPatientsNow(level, reports);
	const inhalers = inhalersNow(level, reports);
	const gap = directorateGap(level, reports);
	return {
		level,
		...(patients !== undefined
			? { patients: compareToNormal(level, 'clinicPatients', patients) }
			: {}),
		...(inhalers !== undefined
			? { inhalers: compareToNormal(level, 'inhalersDispensed', inhalers) }
			: {}),
		range: caseRange(level, reports),
		...(gap ? { gap } : {}),
		completeness: levelCompleteness(level, reports)
	};
}

// ---------------------------------------------------------------------------
// Where on the level, and is medicine running out
// ---------------------------------------------------------------------------

export const SECTORS: Sector[] = [
	'North-West',
	'North',
	'North-East',
	'West',
	'Central',
	'East',
	'South-West',
	'South',
	'South-East'
];

export type AreaRisk = 'high' | 'elevated' | 'normal';

export interface SectorRisk {
	sector: Sector;
	risk: AreaRisk;
	/** Report IDs that name this sector. */
	reportIds: string[];
}

/**
 * Risk per sector of a level, from the sectors reports name this week.
 * High: a case report of 20+ people, or an infrastructure failure, names the sector.
 * Elevated: any smaller case report names it. Normal: nothing points there.
 */
export function sectorRisk(level: LevelCode, reports: Report[]): SectorRisk[] {
	const mine = reports.filter((r) => r.location.level === level && overlapsCurrentWeek(r));
	return SECTORS.map((sector) => {
		const naming = mine.filter((r) => r.location.sectors?.includes(sector));
		const high = naming.some((r) => {
			const f = caseFigure(r);
			const failure = conceptsIn(r.body).includes('ventilation-failure');
			return (f !== undefined && f.value >= 20) || failure;
		});
		const elevated = naming.some((r) => caseFigure(r) !== undefined);
		return {
			sector,
			risk: high ? 'high' : elevated ? 'elevated' : 'normal',
			reportIds: naming.map((r) => r.id)
		};
	});
}

export interface InhalerStock {
	level: LevelCode;
	place?: string;
	inStock: number;
	dispensedThisWeek: number;
	/** Days until stock runs out at this week's rate. */
	daysLeft: number;
	reportId: string;
}

/** Inhaler stock per clinic from this week's reports. */
export function inhalerStock(reports: Report[]): InhalerStock[] {
	const out: InhalerStock[] = [];
	for (const r of reports) {
		if (!overlapsCurrentWeek(r)) continue;
		const stock = r.figures.find((f) => f.unit === 'inhalers' && /in stock/i.test(f.label));
		if (!stock) continue;
		const used =
			r.figures.find((f) => f.unit === 'inhalers' && /dispensed this week/i.test(f.label))?.value ??
			0;
		out.push({
			level: r.location.level,
			...(r.location.place ? { place: r.location.place } : {}),
			inStock: stock.value,
			dispensedThisWeek: used,
			daysLeft: used > 0 ? Math.round((stock.value / used) * 7) : Infinity,
			reportId: r.id
		});
	}
	return out;
}
