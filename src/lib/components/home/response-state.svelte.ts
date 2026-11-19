import { resolved, type Action } from '#lib/hollow/response.js';
import { mapNav } from './home-state.svelte.js';

export interface Outcome {
	id: number;
	verb: string;
	where: string;
	/** Alerts resolved, including any that cleared with the root cause. */
	count: number;
	residents: number;
}

/** Dispatch simulation state, shared by the sidebar list and the map HUD. */
export const response = $state({
	/** Bumped whenever the set of fixes changes; read it to recompute alert state. */
	version: 0,
	/** Alert id a crew is working on right now. */
	working: null as string | null,
	/** The last finished fix, shown as a banner. */
	last: null as Outcome | null
});

/** How long a crew takes on the map, in ms. */
const WORK_MS = 2600;
let seq = 0;

/** Send a crew for an action: fly there, show it working, then resolve what it fixes. */
export function dispatch(action: Action) {
	if (response.working) return;
	// A 'cause' action is fixed at its root: the blackout upstream.
	const target = action.cause ?? action.alert;
	response.working = target.id;
	mapNav.focus(target.floor, target.x, target.y);
	mapNav.crew({ level: target.floor, x: target.x, y: target.y });
	setTimeout(() => {
		resolved.add(target.id);
		response.version++;
		response.working = null;
		mapNav.crew(null);
		mapNav.refresh();
		response.last = {
			id: ++seq,
			verb: action.cause ? 'Restore power' : action.verb,
			where: target.where,
			count: action.clears.length,
			residents: action.residents
		};
	}, WORK_MS);
}

/** Undo every fix (start the simulation over). */
export function resetResponse() {
	resolved.clear();
	response.version++;
	response.last = null;
	mapNav.refresh();
}
