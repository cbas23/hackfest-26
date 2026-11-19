/**
 * Notices for one home block (simulated): what the state says about that address, as short
 * alerts for the resident. Blocked tunnels are left out on purpose.
 * - Power, water, air: the block's score for that kind reaches a poor step
 *   (`conditions.ts`): the third step is a warning, the fourth high, the fifth critical.
 * - Sickness: a large share of the block's health reports are lung sickness (`sickness.ts`).
 *
 * Each kind gives at most one notice, worst first. No notice means all clear. The wording is
 * a placeholder; the note of the strongest point reaching the block replaces the default
 * detail.
 */
import { CONDITION_STEPS, conditionStep } from './conditions.js';
import { formatCount, formatPercent } from './format.js';
import type { Place } from './nav.js';
import { sickStep } from './sickness.js';
import type { FloorSimulation } from './simulation.js';
import type { PointKind } from './state.js';
import { STATUS_INFO, type Status } from './status.js';

export type NoticeKind = PointKind | 'sickness';

export interface HomeNotice {
	/** Stable for the same kind and severity, so a dismissed notice stays dismissed. */
	id: string;
	kind: NoticeKind;
	severity: Status;
	title: string;
	detail: string;
}

/** What each kind says, by severity (placeholder wording). */
const POINT_NOTICE: Record<PointKind, Record<Exclude<Status, 'normal'>, string>> = {
	power: {
		warning: 'Brownouts at your home',
		high: 'Power cuts at your home',
		critical: 'Blackout at your home'
	},
	water: {
		warning: 'Poor tap water at your home',
		high: 'Unsafe tap water at your home',
		critical: 'Toxic tap water at your home'
	},
	air: {
		warning: 'Stale air at your home',
		high: 'Poor air at your home',
		critical: 'Hazardous air at your home'
	}
};
const POINT_DETAIL: Record<PointKind, (step: string) => string> = {
	power: (s) => `Power at your block reads ${s}.`,
	water: (s) => `Tap water at your block reads ${s}. Boil it before drinking.`,
	air: (s) => `Air at your block reads ${s}. Limit effort and keep vents clear.`
};

const rank = (s: Status) => STATUS_INFO[s].rank;

/** Severity from a 0–4 step, where `bad` steps (worst last) map to warning → critical. */
const stepSeverity = (
	step: number,
	bad: [number, number, number]
): Exclude<Status, 'normal'> | null =>
	step >= bad[2] ? 'critical' : step >= bad[1] ? 'high' : step >= bad[0] ? 'warning' : null;

/** The notices for a home block, worst first. `sim` must be the block's floor. */
export function homeNotices(sim: FloorSimulation, home: Place): HomeNotice[] {
	const id = home.room.id;
	const out: HomeNotice[] = [];

	for (const kind of ['power', 'water', 'air'] as const) {
		const score = sim.score(kind)[id];
		if (score === null) continue;
		const step = conditionStep(score);
		const severity = stepSeverity(step, [2, 3, 4]);
		if (!severity) continue;
		const note = sim.conditions.areas
			.filter((a) => a.point.kind === kind && a.point.note && a.blocks.includes(id))
			.sort((a, b) => (b.point.strength ?? 1) - (a.point.strength ?? 1))[0]?.point.note;
		const label = CONDITION_STEPS[kind][step].label.toLowerCase();
		out.push({
			id: `${kind}:${severity}`,
			kind,
			severity,
			title: POINT_NOTICE[kind][severity],
			detail: note ?? POINT_DETAIL[kind](label)
		});
	}

	const sick = sim.sickness[id];
	const sSeverity = sick ? stepSeverity(sickStep(sick.score), [2, 3, 4]) : null;
	if (sick && sSeverity)
		out.push({
			id: `sickness:${sSeverity}`,
			kind: 'sickness',
			severity: sSeverity,
			title: sSeverity === 'warning' ? 'Lung sickness nearby' : 'Lung sickness outbreak',
			detail: `${formatPercent(sick.score)} of ${formatCount(sick.reported)} health reports from your block are lung sickness. Wear a mask outside.`
		});

	return out.sort((a, b) => rank(b.severity) - rank(a.severity));
}
