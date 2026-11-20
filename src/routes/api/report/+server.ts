/**
 * POST a resident's report: `{ message, home }` (see `#lib/hollow/report.ts`). The report agent
 * edits the shared state to match and answers with its reply and changes.
 */
import { error, json } from '@sveltejs/kit';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { OPENROUTER_API_KEY } from '$app/env/private';
import { REPORT_MAX_LENGTH, type ReportRequest } from '#lib/hollow/report.js';
import { handleReport, placeByKey } from '#lib/server/reportAgent.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Partial<ReportRequest> | null;
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!message) error(400, 'Write what is wrong first.');
	if (message.length > REPORT_MAX_LENGTH)
		error(400, `Keep it under ${REPORT_MAX_LENGTH} characters.`);
	const home = typeof body?.home === 'string' ? placeByKey(body.home) : null;
	if (!home || home.kind !== 'block') error(400, 'Save a habitation block as your home first.');
	if (!PUBLIC_CONVEX_URL) error(503, 'Reports need the live city (PUBLIC_CONVEX_URL is not set).');
	if (!OPENROUTER_API_KEY) error(503, 'The report desk is closed (OPENROUTER_API_KEY is not set).');

	try {
		return json(await handleReport(message, home));
	} catch (e) {
		console.error('[report]', e);
		error(502, 'The report desk could not handle that just now. Try again in a moment.');
	}
};
