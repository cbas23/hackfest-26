/**
 * Inhaler stock for every clinic. Fictional data.
 *
 * Clinics with a pharmacy note this week use that report. The rest use the last count a runner
 * brought back (`LAST_COUNTS`) and their usual weekly use from the seeded history, so the deep
 * levels run out first, as the challenge describes.
 */
import { LEVELS } from '#lib/hollow/data.js';
import { inhalerStock, type InhalerStock } from './detect.js';
import { historyFor } from './history.js';
import { REPORTS } from './reports.js';
import type { LevelCode } from './types.js';

/** Last runner count per clinic without a pharmacy note this week (fictional). */
export const LAST_COUNTS: Partial<Record<LevelCode, { inStock: number; counted: string }>> = {
	L1: { inStock: 60, counted: '13 Nov' },
	L4: { inStock: 40, counted: '13 Nov' },
	L5: { inStock: 12, counted: '12 Nov' },
	L6: { inStock: 4, counted: '11 Nov' },
	L7: { inStock: 9, counted: '12 Nov' }
};

export interface ClinicStock extends InhalerStock {
	place: string;
	/** Where the number comes from, in plain words. */
	source: string;
}

/** One stock line per clinic, top level first. A sheet's figure (if given) wins for its clinic. */
export function allClinicStock(sheet?: InhalerStock): ClinicStock[] {
	const reported = inhalerStock(REPORTS);
	return LEVELS.flatMap((l): ClinicStock[] => {
		const code = l.code as LevelCode;
		const place = l.facilities.find((f) => f.kind === 'clinic')?.name ?? code;
		if (sheet && sheet.place === place)
			return [{ ...sheet, place, source: 'clinic sheet (runner)' }];
		const used = historyFor(code).at(-1)?.inhalersDispensed ?? 0;
		const r = reported.find((s) => s.place === place);
		if (r) {
			// A note without a dispensing figure: fall back to the clinic's usual week.
			const perWeek = r.dispensedThisWeek || used;
			const daysLeft = perWeek > 0 ? Math.round((r.inStock / perWeek) * 7) : Infinity;
			return [
				{ ...r, place, dispensedThisWeek: perWeek, daysLeft, source: 'pharmacy note this week' }
			];
		}
		const count = LAST_COUNTS[code];
		if (!count) return [];
		return [
			{
				level: code,
				place,
				inStock: count.inStock,
				dispensedThisWeek: used,
				daysLeft: used > 0 ? Math.round((count.inStock / used) * 7) : Infinity,
				reportId: `COUNT:${code}`,
				source: `runner count ${count.counted}`
			}
		];
	});
}
