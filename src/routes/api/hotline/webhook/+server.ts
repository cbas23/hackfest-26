import { createHmac, timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import type { Line } from '#lib/hotline/engine.js';
import { addReport } from '#lib/server/hotline.js';
import type { RequestHandler } from './$types';

/**
 * ElevenLabs post-call webhook. When a hotline call ends, ElevenLabs sends the transcript and
 * the data-collection fields here; we score it and push it to every open dashboard.
 *
 * Set ELEVENLABS_WEBHOOK_SECRET to the webhook's secret to reject unsigned requests.
 */

interface Payload {
	type?: string;
	data?: {
		transcript?: { role: string; message?: string | null }[];
		analysis?: {
			data_collection_results?: Record<string, { value?: unknown } | undefined>;
		};
	};
}

function verify(raw: string, header: string | null, secret: string) {
	if (!header) return false;
	const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
	if (!parts.t || !parts.v0) return false;
	if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 30 * 60) return false;
	const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
	const a = Buffer.from(expected);
	const b = Buffer.from(parts.v0);
	return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
	if (secret && !verify(raw, request.headers.get('elevenlabs-signature'), secret))
		error(401, 'bad signature');

	let body: Payload;
	try {
		body = JSON.parse(raw);
	} catch {
		error(400, 'invalid json');
	}
	if (body.type && body.type !== 'post_call_transcription') return json({ ignored: body.type });

	const transcript: Line[] = (body.data?.transcript ?? [])
		.filter((t) => t.message)
		.map((t) => ({ role: t.role === 'agent' ? 'agent' : 'caller', text: t.message! }));
	if (!transcript.length) error(400, 'no transcript');

	const dc = body.data?.analysis?.data_collection_results ?? {};
	const val = (k: string) => dc[k]?.value;
	const n = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
	const name = val('name');
	const building = val('building');

	const report = addReport({
		transcript,
		source: 'phone',
		fields: {
			level: n(val('level')),
			people: n(val('people_affected')),
			name: typeof name === 'string' ? name : undefined,
			anonymous: val('anonymous') === true || val('anonymous') === 'true',
			building: typeof building === 'string' && building ? building : undefined,
			needsDelivery: val('needs_delivery') === true || val('needs_delivery') === 'true'
		}
	});
	return json({ ok: true, id: report.id, level: report.level, categories: report.categories });
};
