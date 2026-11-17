import { LEVELS } from '#lib/hollow/data.js';
import {
	ANCHOR_CHECK,
	BASELINE_PATIENTS,
	generateHistory,
	HISTORY_LENGTH,
	PAST_INCIDENTS,
	type WeeklyRecord
} from './history.js';
import type { LevelCode, Report } from './types.js';
import { conceptsIn, PLACE_ALIASES } from './vocabulary.js';

function facilityExists(level: LevelCode, place: string): boolean {
	return LEVELS.find((l) => l.code === level)?.facilities.some((f) => f.name === place) ?? false;
}

/**
 * Consistency checks for the report dataset. Returns a list of problems; empty means valid.
 * Catches the mistakes that would silently break the story: a facility renamed in the map
 * data, a level that doesn't exist, duplicate IDs, or impossible dates.
 */
export function validateReports(reports: Report[]): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();

	for (const r of reports) {
		if (seen.has(r.id)) problems.push(`${r.id}: duplicate document ID`);
		seen.add(r.id);

		const level = LEVELS.find((l) => l.code === r.location.level);
		if (!level) {
			problems.push(`${r.id}: unknown level ${r.location.level}`);
			continue;
		}

		const place = r.location.place;
		if (place && !level.facilities.some((f) => f.name === place)) {
			problems.push(`${r.id}: "${place}" is not a facility on ${level.code} ${level.name}`);
		}

		if (Date.parse(r.period.start) > Date.parse(r.period.end)) {
			problems.push(`${r.id}: reporting period starts after it ends`);
		}
		if (Date.parse(r.submittedAt) > Date.parse(r.receivedAt)) {
			problems.push(`${r.id}: received before it was submitted`);
		}
		for (const key of ['submittedAt', 'receivedAt'] as const) {
			if (Number.isNaN(Date.parse(r[key]))) problems.push(`${r.id}: invalid ${key}`);
		}

		if (r.figures.length === 0) problems.push(`${r.id}: no figures`);
		for (const f of r.figures) {
			if (!Number.isFinite(f.value) || f.value < 0) {
				problems.push(`${r.id}: figure "${f.label}" has an invalid value`);
			}
		}
	}

	return problems;
}

/**
 * Every figure that counts sick people must map to a health concept, so the counting logic can
 * compare reports that use different words. Every place alias must point to a real place.
 */
export function validateVocabulary(reports: Report[]): string[] {
	const problems: string[] = [];

	for (const r of reports) {
		for (const f of r.figures) {
			if (f.countType === 'signal') continue;
			if (!conceptsIn(`${f.label} ${r.body}`).includes('respiratory')) {
				problems.push(`${r.id}: case figure "${f.label}" maps to no health concept`);
			}
		}
	}

	for (const [alias, target] of Object.entries(PLACE_ALIASES)) {
		if (target.place && !facilityExists(target.level, target.place)) {
			problems.push(`alias "${alias}": "${target.place}" is not a facility on ${target.level}`);
		}
	}

	return problems;
}

/**
 * The history must be complete, repeatable, and tell the intended story: a normal range per
 * level, the past incident standing out, and the pitch figures for L3.
 */
export function validateHistory(history: WeeklyRecord[]): string[] {
	const problems: string[] = [];

	if (JSON.stringify(generateHistory()) !== JSON.stringify(history)) {
		problems.push('history is not repeatable: the same seed gave different data');
	}

	for (const level of LEVELS) {
		const code = level.code as LevelCode;
		const weeks = history.filter((w) => w.level === code);
		if (weeks.length !== HISTORY_LENGTH) {
			problems.push(`${code}: expected ${HISTORY_LENGTH} weeks, found ${weeks.length}`);
		}
		for (const w of weeks) {
			if (!facilityExists(code, w.clinic)) problems.push(`${code}: unknown clinic "${w.clinic}"`);
			for (const key of ['clinicPatients', 'directorateConfirmed', 'inhalersDispensed'] as const) {
				if (!Number.isInteger(w[key]) || w[key] < 0) {
					problems.push(`${code} week ${w.isoWeek}: invalid ${key}`);
				}
			}
			if (w.directorateConfirmed > w.clinicPatients) {
				problems.push(`${code} week ${w.isoWeek}: more confirmed cases than patients`);
			}
		}
	}

	for (const inc of PAST_INCIDENTS) {
		if (!facilityExists(inc.level, inc.place)) {
			problems.push(`${inc.id}: "${inc.place}" is not a facility on ${inc.level}`);
		}
		const peak = history.find((w) => w.level === inc.level && w.isoWeek === inc.isoWeeks[0]);
		if (!peak || peak.clinicPatients < BASELINE_PATIENTS[inc.level] * 1.5) {
			problems.push(`${inc.id}: incident week does not stand out from normal`);
		}
	}

	for (const [isoWeek, value] of ANCHOR_CHECK) {
		const w = history.find((h) => h.level === 'L3' && h.isoWeek === isoWeek);
		if (w?.clinicPatients !== value) problems.push(`L3 week ${isoWeek}: expected ${value}`);
	}

	return problems;
}
