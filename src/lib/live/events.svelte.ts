/**
 * The live link between the browser and Convex: subscribes to every event table, keeps the
 * simulation's current events up to date (`setEvents`), and sends changes back.
 *
 * Each table is its own subscription, so a change to one kind of event only replaces that
 * list (the others keep their identity, and their cached models stay valid).
 *
 * Read `live.version` in a `$derived` / `$effect` to recompute when any event changes.
 * Without `PUBLIC_CONVEX_URL` it runs offline on the starter scenario, and fixes stay local.
 */
import { ConvexClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference } from 'convex/server';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import type { EventRef, EventTable, HollowEvents } from '#lib/hollow/events.js';
import { DEFAULT_SICKNESS } from '#lib/hollow/sickness.js';
import { currentEvents, setEvents } from '#lib/hollow/simulation.js';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'offline';

export const live = $state({
	/** Bumped on every change to any event. */
	version: 0,
	status: 'idle' as LiveStatus,
	/** The last error from Convex, if any. */
	error: null as string | null
});

let client: ConvexClient | null = null;
let events: HollowEvents = {
	blackouts: [],
	airQuality: [],
	waterCuts: [],
	blockedTunnels: [],
	sickness: DEFAULT_SICKNESS
};

function apply(patch: Partial<HollowEvents>) {
	events = { ...events, ...patch };
	setEvents(events);
	live.version++;
}

/** A Convex document as an event: `_id` → `id`, `_creationTime` → `createdAt`. */
const fromDoc = <T extends { _id: string; _creationTime: number }>({
	_id,
	_creationTime,
	...rest
}: T) => ({ ...rest, id: _id, createdAt: _creationTime });

const onError = (e: Error) => {
	live.error = e.message;
	console.error('[live]', e);
};

/** Start following the events (once per page load; later calls do nothing). */
export function connectLive() {
	if (live.status !== 'idle') return;
	const url = PUBLIC_CONVEX_URL;
	if (!url) {
		console.warn('[live] PUBLIC_CONVEX_URL is not set: showing the starter scenario offline.');
		live.status = 'offline';
		apply(currentEvents());
		return;
	}
	live.status = 'connecting';
	setEvents(events);
	client = new ConvexClient(url);
	// Live once every table has sent its first result.
	let pending = ['blackouts', 'airQuality', 'waterCuts', 'blockedTunnels', 'sickness'];
	const loaded = (key: string) => {
		pending = pending.filter((k) => k !== key);
		if (!pending.length) live.status = 'live';
	};
	const table = <K extends EventTable>(
		key: K,
		query: FunctionReference<
			'query',
			'public',
			Record<string, never>,
			{ _id: string; _creationTime: number }[]
		>
	) =>
		client!.onUpdate(
			query,
			{},
			(docs) => {
				apply({ [key]: docs.map(fromDoc) } as unknown as Partial<HollowEvents>);
				loaded(key);
			},
			onError
		);
	table('blackouts', api.blackouts.list);
	table('airQuality', api.airQuality.list);
	table('waterCuts', api.waterCuts.list);
	table('blockedTunnels', api.blockedTunnels.list);
	client.onUpdate(
		api.sickness.get,
		{},
		(doc) => {
			if (doc) {
				const { seed, hotspots, hotspotsDrop, spread, intensity, background, depthFalloff } = doc;
				apply({
					sickness: { seed, hotspots, hotspotsDrop, spread, intensity, background, depthFalloff }
				});
			} else apply({ sickness: DEFAULT_SICKNESS });
			loaded('sickness');
		},
		onError
	);
}

/** Call a Convex mutation (the control center's edits). Throws when offline. */
export async function mutate<F extends FunctionReference<'mutation'>>(
	fn: F,
	args: FunctionArgs<F>
): Promise<F['_returnType']> {
	if (!client) throw new Error('Not connected to Convex');
	try {
		live.error = null;
		return await client.mutation(fn, args);
	} catch (e) {
		onError(e as Error);
		throw e;
	}
}

type AnyEventId = Id<EventTable>;

/** Offline: patch the local events in place of a mutation. */
function patchLocal(refs: EventRef[], resolvedAt: number | undefined) {
	const ids = new Set(refs.map((r) => r.id));
	const patch = <T extends { id: string; resolvedAt?: number }>(list: T[]) =>
		list.map((e) => (ids.has(e.id) ? { ...e, resolvedAt } : e));
	apply({
		blackouts: patch(events.blackouts),
		airQuality: patch(events.airQuality),
		waterCuts: patch(events.waterCuts),
		blockedTunnels: patch(events.blockedTunnels)
	});
}

/** Mark events fixed. */
export async function resolveEvents(refs: EventRef[]) {
	if (!refs.length) return;
	if (!client) return patchLocal(refs, Date.now());
	await mutate(api.events.resolve, { ids: refs.map((r) => r.id as AnyEventId) });
}

/** Make fixed events active again. */
export async function reopenEvents(refs: EventRef[]) {
	if (!refs.length) return;
	if (!client) return patchLocal(refs, undefined);
	await mutate(api.events.reopen, { ids: refs.map((r) => r.id as AnyEventId) });
}

/** Reopen every fixed event (optionally only on some levels). */
export async function reopenAllEvents(levels?: number[]) {
	if (!client) {
		const refs = (['blackouts', 'airQuality', 'waterCuts', 'blockedTunnels'] as const).flatMap(
			(table) =>
				events[table]
					.filter((e) => e.resolvedAt !== undefined && (!levels || levels.includes(e.level)))
					.map((e) => ({ table, id: e.id }))
		);
		return patchLocal(refs, undefined);
	}
	await mutate(api.events.reopenAll, { levels });
}
