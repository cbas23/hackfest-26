import { allReports, subscribe, type HotlineEvent } from '#lib/server/hotline.js';
import type { RequestHandler } from './$types';

/** Server-sent events: a snapshot on connect, then every new report as it lands. */
export const GET: RequestHandler = ({ request }) => {
	let cleanup = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (e: HotlineEvent) =>
				controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
			send({ type: 'snapshot', reports: allReports() });
			const unsubscribe = subscribe(send);
			const ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 15_000);
			cleanup = () => {
				clearInterval(ping);
				unsubscribe();
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
