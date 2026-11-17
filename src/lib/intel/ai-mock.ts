/**
 * MOCK AI text. Stand-in for the Claude API until it's connected.
 *
 * The wording is templated from numbers the code already worked out, so it never invents a
 * count. When the API lands, these functions are replaced by a call that receives the same
 * numbers and returns an explanation; the numbers themselves still come from code.
 */
import type { ClinicStock } from './stock.js';
import type { PlannedReorder } from './supply.js';

export const AI_MOCK_LABEL = 'AI reasoning · mock (Claude API coming)';

export interface AiNote {
	summary: string;
	points: string[];
}

export function supplyReasoning(
	stock: ClinicStock[],
	plans: PlannedReorder<ClinicStock>[]
): AiNote {
	if (!plans.length)
		return {
			summary: 'Every clinic has at least a week of inhalers. No reorders needed.',
			points: []
		};
	const first = plans[0];
	const deep = plans.filter((p) => +p.target.level.slice(1) >= 5).length;
	const total = plans.reduce((s, p) => s + p.amount, 0);
	const donors = [...new Set(plans.map((p) => p.from))];
	const unknownFresh = stock.filter((s) => s.source.startsWith('runner count')).length;
	return {
		summary: `${plans.length} clinics run out within a week, ${deep} of them on the deep levels. ${first.target.place} is first, in ${first.target.daysLeft} day${first.target.daysLeft === 1 ? '' : 's'}. Moving ${total} inhalers from ${donors.join(' and ')} covers all of them for about two weeks without leaving any donor short.`,
		points: [
			`Serve ${first.target.place} first: it has ${first.target.inStock} left and uses about ${Math.round(first.target.dispensedThisWeek / 7)} a day.`,
			`Deeper levels use more inhalers each week, so the same stock lasts less the further down a clinic is.`,
			unknownFresh
				? `${unknownFresh} figures are runner counts, not this week's reports. Ask dashers to recount on delivery.`
				: `All figures come from this week's reports.`
		]
	};
}

export interface DashRun {
	id: string;
	dasher: string;
	plan: PlannedReorder<ClinicStock>;
	minutes?: number;
	via?: string;
	approved: boolean;
}

export function dashReasoning(runs: DashRun[]): AiNote {
	if (!runs.length) return { summary: 'No deliveries to coordinate right now.', points: [] };
	const ready = runs.filter((r) => r.approved);
	const waiting = runs.length - ready.length;
	const longest = [...runs].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];
	const byDonor = Object.entries(
		runs.reduce<Record<string, number>>(
			(acc, r) => ((acc[r.plan.from] = (acc[r.plan.from] ?? 0) + 1), acc),
			{}
		)
	).sort((a, b) => b[1] - a[1])[0];
	return {
		summary: `${runs.length} dashes planned, ${ready.length} approved and ready to go${waiting ? `, ${waiting} waiting for a person to approve` : ''}. Start with ${runs[0].plan.target.place}: it runs out soonest.`,
		points: [
			byDonor && byDonor[1] > 1
				? `${byDonor[1]} dashes start at ${byDonor[0]}. Send them together as far as the shared shaft, then split.`
				: `Each dash starts from a different clinic, so they can leave at the same time.`,
			longest?.minutes
				? `Longest run: ${longest.dasher} to ${longest.plan.target.place}, about ${longest.minutes} min. Leave it first.`
				: `Route times appear once the map has loaded.`,
			runs.every((r) => !r.plan.donor || r.plan.donor.level <= r.plan.target.level)
				? `Every route goes down, and downward shafts need no permit, so there are no checkpoint stops.`
				: `Some routes go up: those dashers need a Directorate lift permit.`
		]
	};
}
