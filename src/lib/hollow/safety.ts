/**
 * Escape routes (simulated): the quickest way from a block to the nearest safe one. A block
 * is safe when its power, water and air all read good or fair (`conditions.ts`) and lung
 * sickness there is low (`sickness.ts`). Routes go around blocked tunnels and only use the
 * shafts any resident may ride (no permit, no unmapped vents).
 */
import { conditionStep } from './conditions.js';
import { LEVELS } from './data.js';
import { placesOn, routeToNearest, type Place, type Route } from './nav.js';
import { sickStep } from './sickness.js';
import { getHollow, simulateFloor, type FloorSimulation } from './simulation.js';
import { POINT_KINDS } from './state.js';

/** Worst step (0–4) a safe block may read for power, water, air and sickness. */
const SAFE_STEP = 1;

/** Whether a housing block counts as safe right now. `sim` must be the block's floor. */
export function isSafe(sim: FloorSimulation, place: Place): boolean {
	if (place.kind !== 'block') return false;
	const id = place.room.id;
	for (const kind of POINT_KINDS) {
		const score = sim.score(kind)[id];
		if (score === null || conditionStep(score) > SAFE_STEP) return false;
	}
	const sick = sim.sickness[id];
	return !sick || sickStep(sick.score) <= SAFE_STEP;
}

export interface Escape {
	route: Route;
	/** Blocked tunnels in the city the route had to steer around. */
	blockedTunnels: number;
}

/** The quickest route from `from` to the nearest safe block, or null when none is reachable. */
export function escapeRoute(from: Place): Escape | null {
	const hollow = getHollow();
	const sims = LEVELS.map((l) => simulateFloor(hollow.floor(l.index)));
	const targets = sims.flatMap((sim) =>
		placesOn(sim.floor).filter((p) => p.key !== from.key && isSafe(sim, p))
	);
	if (!targets.length) return null;
	const route = routeToNearest(hollow, from, targets, {
		permit: false,
		unregistered: false,
		blocked: (f) => sims[f].blocked
	});
	if (!route) return null;
	return {
		route,
		blockedTunnels: sims.reduce((n, s) => n + s.local.blockedTunnels.length, 0)
	};
}
