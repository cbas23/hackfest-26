import { LEVELS } from '#lib/hollow/data.js';
import { mulberry32 } from '#lib/random.js';
import type { LevelCode } from './types.js';

/**
 * FICTIONAL, SIMULATED HISTORY. Sixteen weeks of past data per level (ISO weeks 30–45 of 2087),
 * generated from a fixed seed so the same history appears on every run.
 *
 * Why it exists: history teaches Hollow Guardian what normal looks like, so it can recognize
 * when something is wrong. Without it, "31 patients this week" means nothing; with it, the
 * system knows The Warrens usually sees 8–10.
 *
 * It also carries:
 * - the Directorate's track record (close to local counts on upper levels, far below on deep
 *   ones, so a gap that repeats and grows with depth can be told apart from noise),
 * - one past incident with a known cause (Stackhouse Vents fan failure, week 31) to compare
 *   new clusters against,
 * - past blackouts and how late reports arrived after them.
 *
 * Rates are shaped after real surveillance patterns (weekly noise of roughly ±15%), but every
 * number here is invented. History detects unusual patterns; it does not prove an outbreak or
 * its cause.
 */

export const HISTORY_SEED = 2087_46;

/** The live week the fictional reports cover. History ends the week before. */
export const CURRENT_WEEK = { isoWeek: 46, start: '2087-11-10', end: '2087-11-14' } as const;

export const HISTORY_LENGTH = 16;

/**
 * Usual clinic patients with respiratory symptoms per week, per level. Deeper levels are hotter
 * with worse air, so their normal is higher. L3 and L4 match what their clinics say is usual in
 * the current reports.
 */
export const BASELINE_PATIENTS: Record<LevelCode, number> = {
	L1: 2,
	L2: 5,
	L3: 9,
	L4: 10,
	L5: 12,
	L6: 13,
	L7: 15
};

/**
 * Share of clinic patients the Directorate reports as lab-confirmed, per level. Upper levels
 * have Directorate test sites and count close to local numbers; the deep levels don't, and the
 * gap grows with depth.
 */
export const DIRECTORATE_SHARE: Record<LevelCode, number> = {
	L1: 0.9,
	L2: 0.85,
	L3: 0.4,
	L4: 0.35,
	L5: 0.3,
	L6: 0.25,
	L7: 0.25
};

/**
 * The share of patients we'd expect to be lab-confirmed anywhere, taken from the upper levels
 * where testing is available. The difference between this and a level's reported share is the
 * unexplained part of the Directorate gap.
 */
export const EXPECTED_CONFIRMED_SHARE = 0.85;

/** Inhalers a clinic dispenses per respiratory patient in a normal week. */
export const INHALERS_PER_PATIENT = 1.5;

export interface PastBlackout {
	level: LevelCode;
	start: string;
	hours: number;
}

export const PAST_BLACKOUTS: PastBlackout[] = [
	{ level: 'L3', start: '2087-07-27T03:00', hours: 26 },
	{ level: 'L5', start: '2087-09-14T01:00', hours: 40 },
	{ level: 'L4', start: '2087-09-28T22:00', hours: 18 },
	{ level: 'L6', start: '2087-10-02T05:00', hours: 52 },
	{ level: 'L7', start: '2087-10-20T00:00', hours: 60 }
];

export interface PastIncident {
	id: string;
	level: LevelCode;
	place: string;
	isoWeeks: number[];
	/** Multiplier on normal patients for each week in `isoWeeks`. */
	multipliers: number[];
	cause: string;
	resolvedOn: string;
	/** What the cluster looked like, for comparison with new alerts. */
	pattern: string;
}

export const PAST_INCIDENTS: PastIncident[] = [
	{
		id: 'INC-2087-31',
		level: 'L3',
		place: 'Stackhouse Vents',
		isoWeeks: [31, 32],
		multipliers: [2.3, 1.6],
		cause: 'Two main fans failed to restart after the 27 July blackout.',
		resolvedOn: '2087-08-06',
		pattern:
			"Cases stayed inside Warrens Air Exchange's service area, did not spread along tunnels, and fell back to normal within ten days of the repair."
	}
];

export interface WeeklyRecord {
	level: LevelCode;
	/** The level's clinic, from `hollow/data.ts`. */
	clinic: string;
	isoWeek: number;
	weekStart: string;
	weekEnd: string;
	/** Count type: patients. */
	clinicPatients: number;
	/** Count type: confirmed (Directorate definition). */
	directorateConfirmed: number;
	/** Count type: signal. */
	inhalersDispensed: number;
	/** Hours of blackout on this level during the week. */
	blackoutHours: number;
	/** How long after the week ended the clinic report reached the system. */
	receivedLagHours: number;
	incidentId?: string;
}

const DAY = 864e5;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * L3's last four weeks are fixed to the figures in the pitch (7, 9, 8, 10) so the demo,
 * the slides and the data tell the same story.
 */
const ANCHORS: Partial<Record<LevelCode, Record<number, number>>> = {
	L3: { 42: 7, 43: 9, 44: 8, 45: 10 }
};

/** The L3 pitch figures as [isoWeek, patients] pairs, for validation. */
export const ANCHOR_CHECK: [number, number][] = Object.entries(ANCHORS.L3 ?? {}).map(
	([week, value]) => [Number(week), value]
);

export function generateHistory(seed = HISTORY_SEED): WeeklyRecord[] {
	const rand = mulberry32(seed);
	const jitter = (spread: number) => 1 + (rand() - 0.5) * 2 * spread;
	const currentStart = Date.parse(`${CURRENT_WEEK.start}T00:00Z`);
	const records: WeeklyRecord[] = [];

	for (const level of LEVELS) {
		const code = level.code as LevelCode;
		const clinic = level.facilities.find((f) => f.kind === 'clinic')?.name ?? 'Unknown clinic';
		const depthLag = 1 + level.index; // deeper levels report a little later even on good weeks

		for (let back = HISTORY_LENGTH; back >= 1; back--) {
			const start = currentStart - back * 7 * DAY;
			const end = start + 4 * DAY;
			const isoWeek = CURRENT_WEEK.isoWeek - back;

			const incident = PAST_INCIDENTS.find((i) => i.level === code && i.isoWeeks.includes(isoWeek));
			const multiplier = incident ? incident.multipliers[incident.isoWeeks.indexOf(isoWeek)] : 1;

			const anchored = ANCHORS[code]?.[isoWeek];
			const patients =
				anchored ?? Math.max(0, Math.round(BASELINE_PATIENTS[code] * multiplier * jitter(0.15)));

			const confirmed = Math.round(patients * DIRECTORATE_SHARE[code] * jitter(0.1));
			const inhalers = Math.round(patients * INHALERS_PER_PATIENT * jitter(0.1));

			const blackoutHours = PAST_BLACKOUTS.filter((b) => {
				const t = Date.parse(`${b.start}Z`);
				return b.level === code && t >= start - 2 * DAY && t < start + 5 * DAY;
			}).reduce((sum, b) => sum + b.hours, 0);

			const lag = blackoutHours > 0 ? 48 + blackoutHours : Math.round(depthLag * jitter(0.5));

			records.push({
				level: code,
				clinic,
				isoWeek,
				weekStart: isoDate(start),
				weekEnd: isoDate(end),
				clinicPatients: patients,
				directorateConfirmed: confirmed,
				inhalersDispensed: inhalers,
				blackoutHours,
				receivedLagHours: lag,
				...(incident ? { incidentId: incident.id } : {})
			});
		}
	}

	return records;
}

/** The history every part of the app reads. */
export const HISTORY: WeeklyRecord[] = generateHistory();

export function historyFor(level: LevelCode): WeeklyRecord[] {
	return HISTORY.filter((r) => r.level === level);
}
