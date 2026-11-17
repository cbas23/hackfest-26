/**
 * Inhaler reorder suggestions. Deterministic: the amount comes from this week's dispensing rate,
 * never from the AI. A person approves every reorder in the UI.
 */
import type { InhalerStock } from './detect.js';

/** How many days of stock a reorder aims for. */
export const TARGET_DAYS = 14;
/** Below this many days left, the UI suggests a reorder. */
export const LOW_DAYS = 7;

export interface ReorderPlan {
	/** Inhalers to send. */
	amount: number;
	/** Where they come from: a clinic with spare stock, or the central depot. */
	from: string;
	/** Days of stock after the delivery, at this week's rate. */
	daysAfter: number;
	stockAfter: number;
}

const perDay = (s: InhalerStock) => s.dispensedThisWeek / 7;

/** What a clinic can give away and still keep TARGET_DAYS for itself. */
const spare = (s: InhalerStock) => Math.max(0, s.inStock - Math.ceil(perDay(s) * TARGET_DAYS));

export function reorderPlan(target: InhalerStock, all: InhalerStock[]): ReorderPlan | undefined {
	const daily = perDay(target);
	if (daily <= 0) return undefined;
	const amount = Math.ceil(daily * TARGET_DAYS) - target.inStock;
	if (amount <= 0) return undefined;
	const donor = all
		.filter((s) => s !== target && spare(s) >= amount)
		.sort((a, b) => spare(b) - spare(a))[0];
	const stockAfter = target.inStock + amount;
	return {
		amount,
		from: donor ? `${donor.place ?? donor.level} (${donor.level})` : 'Central depot',
		daysAfter: Math.round(stockAfter / daily),
		stockAfter
	};
}

/** One approved reorder, as it goes into the supply ledger. */
export interface LedgerEntry extends ReorderPlan {
	level: string;
	to: string;
	/** ISO time the person approved it. */
	approvedAt: string;
}

const csvCell = (v: string | number) => {
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Supply ledger as CSV: opens in Excel or Google Sheets, travels on a stick when offline. */
export function ledgerCsv(entries: LedgerEntry[]): string {
	const head = [
		'Approved at',
		'Level',
		'To',
		'From',
		'Item',
		'Amount',
		'Stock after',
		'Days after',
		'Approved by',
		'Status'
	];
	const rows = entries.map((e) => [
		e.approvedAt,
		e.level,
		e.to,
		e.from,
		'Inhalers',
		e.amount,
		e.stockAfter,
		e.daysAfter,
		'Duty officer (demo)',
		'Awaiting delivery'
	]);
	return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface PlannedReorder<T extends InhalerStock = InhalerStock> extends ReorderPlan {
	target: T;
	/** Donor clinic, or undefined for the central depot. */
	donor?: T;
	/** Deterministic one-line reason, shown next to the AI's explanation. */
	reason: string;
}

/**
 * Reorders for every clinic under LOW_DAYS, most urgent first. Each donor's spare stock is used
 * up as it's promised, so two clinics never get the same inhalers. Fair by rule: whoever runs out
 * soonest is served first, whatever level they're on.
 */
export function planAll<T extends InhalerStock>(all: T[]): PlannedReorder<T>[] {
	const left = new Map(all.map((s) => [s, spare(s)]));
	const out: PlannedReorder<T>[] = [];
	for (const target of [...all]
		.filter((s) => s.daysLeft < LOW_DAYS)
		.sort((a, b) => a.daysLeft - b.daysLeft)) {
		const daily = perDay(target);
		if (daily <= 0) continue;
		const amount = Math.ceil(daily * TARGET_DAYS) - target.inStock;
		if (amount <= 0) continue;
		const donor = all
			.filter((s) => s !== target && (left.get(s) ?? 0) >= amount)
			.sort((a, b) => (left.get(b) ?? 0) - (left.get(a) ?? 0))[0];
		if (donor) left.set(donor, (left.get(donor) ?? 0) - amount);
		const stockAfter = target.inStock + amount;
		out.push({
			target,
			...(donor ? { donor } : {}),
			amount,
			from: donor ? `${donor.place ?? donor.level} (${donor.level})` : 'Central depot',
			stockAfter,
			daysAfter: Math.round(stockAfter / daily),
			reason: `${target.inStock} left at ~${Math.round(daily)}/day: out in ${target.daysLeft} day${target.daysLeft === 1 ? '' : 's'}`
		});
	}
	return out;
}

/** Time stamp for a ledger entry. */
export const nowIso = () => new Date().toISOString();
