/**
 * Notices for one home block (simulated): what the state says about that address, as short
 * alerts for the resident. Blocked tunnels are left out on purpose.
 * - Power, water, air: the block is inside a point of that kind (`conditions.ts`).
 * - Sickness: a large share of the block's health reports are lung sickness (`sickness.ts`).
 *
 * Each kind gives at most one notice, worst first. No notice means all clear. The wording is
 * a placeholder; a point's `note` replaces the default detail.
 */
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

/** What a bad point says, by kind. */
const POINT_NOTICE: Record<PointKind, { title: string; detail: string }> = {
	power: { title: 'No power at your home', detail: 'Your block is without power.' },
	water: { title: 'Bad water at your home', detail: 'Tap water at your block is unsafe to drink.' },
	air: { title: 'Bad air at your home', detail: 'The air at your block is unsafe to breathe.' }
};

/** Severity of a bad point: there are no grades, so every one is the same. */
const POINT_SEVERITY: Status = 'high';

const rank = (s: Status) => STATUS_INFO[s].rank;

/** Severity from a 0–4 step, where `bad` steps (worst last) map to warning → critical. */
const stepSeverity = (step: number, bad: [number, number, number]): Status | null =>
	step >= bad[2] ? 'critical' : step >= bad[1] ? 'high' : step >= bad[0] ? 'warning' : null;

/** The notices for a home block, worst first. `sim` must be the block's floor. */
export function homeNotices(sim: FloorSimulation, home: Place): HomeNotice[] {
	const id = home.room.id;
	const out: HomeNotice[] = [];

	for (const kind of ['power', 'water', 'air'] as const) {
		if (!sim.bad(kind)[id]) continue;
		const note = sim.conditions.areas.find(
			(a) => a.point.kind === kind && a.point.note && a.blocks.includes(id)
		)?.point.note;
		out.push({
			id: `${kind}:${POINT_SEVERITY}`,
			kind,
			severity: POINT_SEVERITY,
			title: POINT_NOTICE[kind].title,
			detail: note ?? POINT_NOTICE[kind].detail
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
