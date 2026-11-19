import type { Action } from '#lib/hollow/response.js';
import { reopenAllEvents, resolveEvents } from '#lib/live/events.svelte.js';
import { mapNav } from './home-state.svelte.js';

export interface Outcome {
	id: number;
	verb: string;
	where: string;
	/** Alerts resolved. */
	count: number;
	residents: number;
}

/**
 * Dispatch state, shared by the sidebar list and the map HUD. The fixes themselves are
 * shared: a crew resolves the alert's events in Convex, so every viewer sees it fixed.
 */
export const response = $state({
	/** Alert id a crew is working on right now. */
	working: null as string | null,
	/** The last finished fix, shown as a banner. */
	last: null as Outcome | null
});

/** How long a crew takes on the map, in ms. */
const WORK_MS = 2600;
let seq = 0;

/** Send a crew for an action: fly there, show it working, then resolve its events. */
export function dispatch(action: Action) {
	if (response.working) return;
	const target = action.alert;
	response.working = target.id;
	mapNav.focus(target.floor, target.x, target.y);
	mapNav.crew({ level: target.floor, x: target.x, y: target.y });
	setTimeout(async () => {
		try {
			await resolveEvents(action.clears.flatMap((a) => a.events));
			response.last = {
				id: ++seq,
				verb: action.verb,
				where: target.where,
				count: action.clears.length,
				residents: action.residents
			};
		} finally {
			response.working = null;
			mapNav.crew(null);
		}
	}, WORK_MS);
}

/** Reopen every fixed event (start the response over). */
export function resetResponse() {
	response.last = null;
	void reopenAllEvents();
}
