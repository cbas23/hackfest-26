import { LEVELS } from '#lib/hollow/data.js';
import type { Report } from './types.js';

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
