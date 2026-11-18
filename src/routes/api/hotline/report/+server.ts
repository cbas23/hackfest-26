import { error, json } from '@sveltejs/kit';
import type { Line } from '#lib/hotline/engine.js';
import { addReport, allReports, resetReports } from '#lib/server/hotline.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(allReports());

/** Add a report from a transcript. Used by the dashboard's "simulate call" button. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { transcript?: Line[] } | null;
	const transcript = body?.transcript?.filter(
		(l) => (l.role === 'agent' || l.role === 'caller') && typeof l.text === 'string'
	);
	if (!transcript?.length) error(400, 'transcript required');
	return json(addReport({ transcript, source: 'simulated' }));
};

/** Reset to the seeded starting point for another rehearsal. */
export const DELETE: RequestHandler = () => {
	resetReports();
	return json({ ok: true });
};
