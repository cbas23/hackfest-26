/**
 * The resident's last report: it goes to the report agent (`POST /api/report`), which edits the
 * shared state in the background, and the map picks the edits up live from Convex. This only
 * tracks how the report is going, for the line under the Report button. Kept outside the
 * component so it survives the phone drawer closing.
 */

/** How long "Report sent" stays before the line clears. */
const DONE_MS = 4000;

export const report = $state({
	status: 'idle' as 'idle' | 'working' | 'done' | 'failed',
	/** Why the last report failed. */
	error: ''
});

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Send a report; resolves once the agent has answered (or failed). */
export async function sendReport(message: string, home: string) {
	clearTimeout(clearTimer);
	report.status = 'working';
	report.error = '';
	try {
		const res = await fetch('/api/report', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message, home })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.message ?? `The report desk answered ${res.status}`);
		}
		report.status = 'done';
		clearTimer = setTimeout(() => (report.status = 'idle'), DONE_MS);
	} catch (e) {
		report.status = 'failed';
		report.error = (e as Error).message;
	}
}
