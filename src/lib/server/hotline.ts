/**
 * In-memory hotline store. Holds every report and pushes new ones to open dashboards.
 * Kept on globalThis so dev-server reloads don't wipe it mid-demo.
 */
import { buildReport, type Report, type ReportInput } from '#lib/hotline/engine.js';
import { seedReports } from '#lib/hotline/seed.js';

export type HotlineEvent =
	{ type: 'snapshot'; reports: Report[] } | { type: 'report'; report: Report };

type Listener = (e: HotlineEvent) => void;

const g = globalThis as unknown as {
	__hotline?: { reports: Report[]; listeners: Set<Listener> };
};
const store = (g.__hotline ??= { reports: seedReports(), listeners: new Set() });

function emit(e: HotlineEvent) {
	for (const fn of store.listeners) fn(e);
}

export const allReports = () => store.reports;

export function addReport(input: ReportInput): Report {
	const report = buildReport(input, store.reports);
	store.reports = [...store.reports, report];
	emit({ type: 'report', report });
	return report;
}

/** Back to the seeded starting point (57% outbreak), for rehearsals. */
export function resetReports() {
	store.reports = seedReports();
	emit({ type: 'snapshot', reports: store.reports });
}

export function subscribe(fn: Listener) {
	store.listeners.add(fn);
	return () => store.listeners.delete(fn);
}
