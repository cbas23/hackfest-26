/**
 * The live link between the browser and Convex: subscribes to the state's tables, keeps the
 * simulation's current state up to date (`setState`), and sends changes back.
 *
 * Each table is its own subscription, so a change to the points only replaces that list
 * (the others keep their identity, and their cached models stay valid).
 *
 * Read `live.version` in a `$derived` / `$effect` to recompute when the state changes.
 * Without `PUBLIC_CONVEX_URL` it runs offline, read-only, on the starter scenario.
 */
import { ConvexClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference } from 'convex/server';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { api } from '#convex/_generated/api.js';
import type { HollowState } from '#lib/hollow/state.js';
import { currentState, setState } from '#lib/hollow/simulation.js';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'offline';

export const live = $state({
	/** Bumped on every change to the state. */
	version: 0,
	status: 'idle' as LiveStatus,
	/** The last error from Convex, if any. */
	error: null as string | null
});

let client: ConvexClient | null = null;
let state: HollowState = { points: [], blockedTunnels: [] };

function apply(patch: Partial<HollowState>) {
	state = { ...state, ...patch };
	setState(state);
	live.version++;
}

/** A Convex document's own fields, with `_id` as `id`. */
function fromDoc<T extends { _id: string; _creationTime: number }>(doc: T) {
	const { _id, ...rest } = doc;
	delete (rest as Partial<T>)._creationTime;
	return { ...(rest as Omit<T, '_id' | '_creationTime'>), id: _id };
}

const onError = (e: Error) => {
	live.error = e.message;
	console.error('[live]', e);
};

/** Start following the state (once per page load; later calls do nothing). */
export function connectLive() {
	if (live.status !== 'idle') return;
	const url = PUBLIC_CONVEX_URL;
	if (!url) {
		console.warn('[live] PUBLIC_CONVEX_URL is not set: showing the starter scenario offline.');
		live.status = 'offline';
		apply(currentState());
		return;
	}
	live.status = 'connecting';
	setState(state);
	client = new ConvexClient(url);
	// Live once every table has sent its first result.
	let pending = ['points', 'blockedTunnels'];
	const loaded = (key: string) => {
		pending = pending.filter((k) => k !== key);
		if (!pending.length) live.status = 'live';
	};
	client.onUpdate(
		api.points.list,
		{},
		(docs) => {
			apply({ points: docs.map(fromDoc) });
			loaded('points');
		},
		onError
	);
	client.onUpdate(
		api.blockedTunnels.list,
		{},
		(docs) => {
			apply({ blockedTunnels: docs.map(fromDoc) });
			loaded('blockedTunnels');
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
