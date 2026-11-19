/**
 * Notices for one home block (simulated): what the sidebar's data layers say about that
 * address, as short alerts for the resident. Blocked tunnels are left out on purpose.
 * - Power: the block is inside an active blackout.
 * - Water: the recycler serving the block has an active alert (at the block's severity,
 *   see `alerts.ts`), or its tap water reads unsafe or toxic (`water.ts`).
 * - Air: the ventilation plant serving the block has an active alert, or the air at the block
 *   is still (`airflow.ts`).
 * - Sickness: a large share of the block's health reports are lung sickness (`sickness.ts`).
 *
 * Each kind gives at most one notice, worst first. No notice means all clear.
 */
import { airStep } from './airflow.js';
import type { AlertKind } from './alerts.js';
import { formatCount, formatPercent } from './format.js';
import type { Place } from './nav.js';
import { STATUS_INFO, type Status } from './sensors.js';
import { sickStep } from './sickness.js';
import type { FloorSimulation } from './simulation.js';
import { waterStep } from './water.js';

export type NoticeKind = 'power' | 'water' | 'air' | 'sickness';

export interface HomeNotice {
	/** Stable for the same cause and severity, so a dismissed notice stays dismissed. */
	id: string;
	kind: NoticeKind;
	severity: Status;
	title: string;
	detail: string;
}

const rank = (s: Status) => STATUS_INFO[s].rank;

/** The worst active alert of a kind that covers a block, with its severity at that block. */
function alertFor(sim: FloorSimulation, kind: AlertKind, block: number) {
	const severity = sim.alerts.blocks.get(block)?.[kind];
	const alert =
		severity && sim.alerts.alerts.find((a) => a.kind === kind && a.blocks.includes(block));
	return alert ? { alert, severity } : null;
}

/** Severity from a 0–4 step, where `bad` steps (worst last) map to warning → critical. */
const stepSeverity = (step: number, bad: [number, number, number]): Status | null =>
	step >= bad[2] ? 'critical' : step >= bad[1] ? 'high' : step >= bad[0] ? 'warning' : null;

/** The notices for a home block, worst first. `sim` must be the block's floor. */
export function homeNotices(sim: FloorSimulation, home: Place): HomeNotice[] {
	const id = home.room.id;
	const out: HomeNotice[] = [];

	// Power
	if (!sim.lit[id]) {
		const a = alertFor(sim, 'blackout', id)?.alert;
		const severity = a?.severity ?? 'high';
		out.push({
			id: `power:${a?.id ?? 'dark'}:${severity}`,
			kind: 'power',
			severity,
			title: 'Power outage at your home',
			detail: a
				? `Blackout over ${a.where.split(' · ')[0]}: ${a.detail}.`
				: 'Your block is without power.'
		});
	}

	// Water
	const water = sim.water[id];
	const wHit = alertFor(sim, 'water', id);
	const wAlert = wHit?.alert;
	const wStep = water ? waterStep(water.score) : 0;
	// Most blocks read fair or poor; only unsafe and toxic tap water is worth a notice.
	const wSeverity = worst(wHit?.severity, wStep === 4 ? 'high' : wStep === 3 ? 'warning' : null);
	if (wSeverity) {
		const quality = ['clean', 'fair', 'poor', 'unsafe', 'toxic'][wStep];
		out.push({
			id: `water:${wAlert?.id ?? 'tap'}:${wSeverity}`,
			kind: 'water',
			severity: wSeverity,
			title: wAlert ? wAlert.title : `Tap water ${quality}`,
			detail: wAlert
				? `${wAlert.place?.label ?? 'Your recycler'} reports ${wAlert.detail}. Tap water here reads ${quality}.`
				: `Tap water at your block reads ${quality}. Boil it before drinking.`
		});
	}

	// Air
	const air = sim.airflow[id];
	const aHit = alertFor(sim, 'air', id);
	const aAlert = aHit?.alert;
	// Air steps run the other way: 0 is still air. Weak air is common on the deep levels.
	const aStep = air ? airStep(air.score) : 4;
	const aSeverity = worst(aHit?.severity, aStep === 0 ? 'warning' : null);
	if (aSeverity) {
		const flow = ['still', 'weak', 'fair', 'good', 'strong'][aStep];
		out.push({
			id: `air:${aAlert?.id ?? 'flow'}:${aSeverity}`,
			kind: 'air',
			severity: aSeverity,
			title: aAlert ? aAlert.title : 'Stale air at your home',
			detail: aAlert
				? `${aAlert.place?.label ?? 'Your ventilation plant'} reports ${aAlert.detail}. Air flow here is ${flow}.`
				: `Little fresh air reaches your block (${flow}). Limit effort and keep vents clear.`
		});
	}

	// Sickness
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

function worst(a: Status | null | undefined, b: Status | null): Status | null {
	if (!a || a === 'normal') return b;
	if (!b) return a;
	return rank(a) >= rank(b) ? a : b;
}
