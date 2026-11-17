/**
 * The agent pipeline behind the Agents page:
 *   clinic shift report (typed in by staff) + anonymous kiosk reports
 *   → Intake merges them → Investigator summarizes the graph, insights and warnings
 *   → Supply and Dash agents update.
 *
 * Every number comes from code (vocabulary, history, merge rules, planner). The sentences in
 * the thought bubbles and the summary are a mock of what the Claude API will write from the
 * same numbers.
 */
import { LEVELS } from '#lib/hollow/data.js';
import { assessLevel, compareToNormal, type Anomaly, type InhalerStock } from './detect.js';
import { CURRENT_WEEK, historyFor } from './history.js';
import { REPORTS } from './reports.js';
import { allClinicStock, type ClinicStock } from './stock.js';
import { planAll, type PlannedReorder } from './supply.js';
import type { LevelCode, Report } from './types.js';
import { CONCEPTS, conceptsIn, placeAliasesIn } from './vocabulary.js';

export type NodeId = 'clinic' | 'kiosk' | 'intake' | 'investigator' | 'supply' | 'dash';

export const SAMPLE_SHIFT_REPORT = `Clinic Nine shift report, 10–14 Nov. We saw 31 patients with cough, chest tightness or shortness of breath, logged by resident ID. Most live near the Stackhouse stairs. Running low on inhalers.`;

export interface KioskInput {
	id: string;
	place: string;
	count: number;
	/** How many said they never went to a clinic (read from the free text). */
	notAtClinic?: number;
}

export interface Pipeline {
	level: LevelCode;
	levelName: string;
	clinic: { count?: number; concepts: string[]; place?: string };
	kiosks: KioskInput[];
	merged?: { low: number; high: number; clinic: number; kiosk: number; notAtClinic: number };
	anomaly?: Anomaly;
	points: { week: number; value?: number; incident?: string; now?: boolean }[];
	summary: string;
	insights: string[];
	warnings: string[];
	stock?: ClinicStock;
	plan?: PlannedReorder<ClinicStock>;
	thoughts: Record<NodeId, string[]>;
}

const CLINIC_LEVEL = Object.fromEntries(
	LEVELS.flatMap((l) =>
		l.facilities.filter((f) => f.kind === 'clinic').map((f) => [f.name.toLowerCase(), l.code])
	)
) as Record<string, LevelCode>;

function kioskInputs(level: LevelCode): (KioskInput & { report: Report })[] {
	return REPORTS.filter((r) => r.source === 'kiosk' && r.location.level === level).flatMap((r) => {
		const f = r.figures.find((x) => x.countType === 'reports');
		if (!f) return [];
		const n = Number(r.body.match(/(\d+) of them also selected "did not visit a clinic"/)?.[1]);
		return [
			{
				id: r.id,
				place: r.location.place ?? level,
				count: f.value,
				...(Number.isFinite(n) ? { notAtClinic: n } : {}),
				report: r
			}
		];
	});
}

export function runPipeline(text: string, sheetStock?: InhalerStock): Pipeline {
	const lower = text.toLowerCase();
	const concepts = conceptsIn(text);
	const alias = placeAliasesIn(text)[0];
	const clinicName = Object.keys(CLINIC_LEVEL).find((c) => lower.includes(c));
	const level: LevelCode = clinicName ? CLINIC_LEVEL[clinicName] : (alias?.level ?? 'L3');
	const levelName = LEVELS.find((l) => l.code === level)?.name ?? level;
	const parsed = Number(text.match(/(\d+)\s+(?:patients|residents|people|cases)/i)?.[1]);
	const count = Number.isFinite(parsed) && concepts.includes('respiratory') ? parsed : undefined;
	const kiosks = kioskInputs(level);

	// Merge: never add sources together blindly. Kiosk people who say they skipped the clinic
	// can't be in the clinic count, so they raise the floor; the rest might be duplicates.
	const kioskTotal = kiosks.reduce((s, k) => s + k.count, 0);
	const notAtClinic = kiosks.reduce((s, k) => s + (k.notAtClinic ?? 0), 0);
	const merged =
		count !== undefined
			? {
					clinic: count,
					kiosk: kioskTotal,
					notAtClinic,
					low: count + notAtClinic,
					high: count + kioskTotal
				}
			: undefined;

	const anomaly = count !== undefined ? compareToNormal(level, 'clinicPatients', count) : undefined;
	const assessed = assessLevel(level, REPORTS);
	const gap = assessed.gap;
	const inc = anomaly?.exceedsIncident;
	const points = [
		...historyFor(level).map((w) => ({
			week: w.isoWeek,
			value: w.clinicPatients,
			...(w.incidentId ? { incident: w.incidentId } : {})
		})),
		{ week: CURRENT_WEEK.isoWeek, ...(count !== undefined ? { value: count } : {}), now: true }
	];

	const stockAll = allClinicStock(sheetStock);
	const stock = stockAll.find((s) => s.level === level);
	const plans = planAll(stockAll);
	const planIndex = plans.findIndex((p) => p.target.level === level);
	const plan = planIndex >= 0 ? plans[planIndex] : undefined;

	// --- What the Investigator writes (mock wording, real numbers) ---
	const weeks = historyFor(level).length;
	const record = count !== undefined && historyFor(level).every((w) => w.clinicPatients < count);
	const alert = anomaly && anomaly.severity !== 'normal';
	const summary = !anomaly
		? `No respiratory patient count in the clinic report, so there is nothing to compare with ${level}'s history.`
		: alert
			? `Over ${weeks} weeks ${level} ${levelName} usually saw about ${anomaly.baseline.mean} respiratory patients a week. This week the clinic logged ${count}, ${anomaly.ratio}× normal${record ? ' and the highest on record' : ''}. With the kiosk reports, ${merged!.low}–${merged!.high} people are sick${gap ? `, while the Directorate confirms ${gap.confirmed}` : ''}.`
			: `${level} is inside its normal range: ${count} patients against about ${anomaly.baseline.mean} a week over ${weeks} weeks. No alert.`;

	const insights = alert
		? [
				`${anomaly!.ratio}× normal: ${count} patients vs ${anomaly!.baseline.mean} a week.`,
				notAtClinic
					? `${notAtClinic} kiosk reporters never went to a clinic: the clinic count misses people.`
					: `Kiosk reports agree with the clinic: the spike is real.`,
				inc
					? `Bigger than ${inc.id} at ${inc.place}, which was a fan failure. Check ventilation first.`
					: `No past incident to compare with on ${level}.`,
				...(gap?.flagged
					? [
							`Directorate: ${gap.confirmed} confirmed. ${gap.unexplainedGap} cases aren't explained.`
						]
					: [])
			]
		: [];

	const warnings = [
		...(stock && stock.daysLeft < 7
			? [
					`${stock.place} runs out of inhalers in ~${stock.daysLeft} day${stock.daysLeft === 1 ? '' : 's'}.`
				]
			: []),
		...(!assessed.completeness.complete
			? [`Data may be incomplete: ${assessed.completeness.reasons.join(', ')}. Counts may rise.`]
			: []),
		...(kioskTotal ? [`Kiosk reports are anonymous and unverified; treat them as a range.`] : [])
	];

	const thoughts: Record<NodeId, string[]> = {
		clinic: [
			count !== undefined ? `${count} patients, logged by ID` : 'no patient count',
			clinicName ? `from ${clinicName.replace(/\b\w/g, (c) => c.toUpperCase())}` : `level ${level}`
		],
		kiosk: kiosks.length
			? kiosks.map(
					(k) =>
						`${k.count} anonymous at ${k.place}${k.notAtClinic ? `, ${k.notAtClinic} skipped clinic` : ''}`
				)
			: ['no kiosk reports this week'],
		intake: [
			concepts.length
				? `Wording → codes: ${concepts.map((c) => CONCEPTS[c].label.toLowerCase()).join(', ')}.`
				: 'No symptoms from the shared vocabulary.',
			alias
				? `"${alias.alias}" → ${alias.level}${alias.place ? ` · ${alias.place}` : ''}.`
				: `Level ${level}.`,
			merged
				? `Merging: clinic ${merged.clinic} + kiosk ${merged.kiosk}. ${merged.notAtClinic} never saw a clinic → at least ${merged.low}, at most ${merged.high}.`
				: 'Nothing to merge without a clinic count.'
		],
		investigator: anomaly
			? [
					`Comparing with ${weeks} weeks of ${level} history…`,
					`${count} ÷ ${anomaly.baseline.mean} = ${anomaly.ratio}× normal → ${anomaly.severity}.`,
					inc ? `Matches the pattern of ${inc.id} (${inc.place}).` : 'No similar past incident.',
					'Writing summary, insights and warnings.'
				]
			: ['No count to investigate.'],
		supply: stock
			? [
					`${stock.place}: ${stock.inStock} inhalers, ${stock.daysLeft} days left.`,
					plan
						? `Plan: ${plan.amount} from ${plan.from}, waits for approval.`
						: 'Stock is fine. No reorder.'
				]
			: ['No stock figure for this level.'],
		dash: plan
			? [
					`New job: ${plan.from} → ${plan.target.place}.`,
					planIndex === 0
						? 'First in the queue: it runs out soonest.'
						: `Queued behind ${planIndex} more urgent dash${planIndex === 1 ? '' : 'es'}.`
				]
			: ['No delivery needed.']
	};

	return {
		level,
		levelName,
		clinic: {
			...(count !== undefined ? { count } : {}),
			concepts,
			...(clinicName ? { place: clinicName } : {})
		},
		kiosks: kiosks.map((k) => ({
			id: k.id,
			place: k.place,
			count: k.count,
			...(k.notAtClinic !== undefined ? { notAtClinic: k.notAtClinic } : {})
		})),
		...(merged ? { merged } : {}),
		...(anomaly ? { anomaly } : {}),
		points,
		summary,
		insights,
		warnings,
		...(stock ? { stock } : {}),
		...(plan ? { plan } : {}),
		thoughts
	};
}
