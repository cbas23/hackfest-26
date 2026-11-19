/**
 * The Hollow's simulated data, in one place: the shared city, its current state, and
 * everything derived from them. All of it is fictional.
 *
 * - The city (`getHollow()`): tunnels, rooms, facilities and residents, built in the browser
 *   from `HOLLOW_SEED`. It never changes.
 * - The state (`currentState()`): power, water and air points, blocked tunnels and the
 *   sickness settings. It lives in Convex and changes over time; `#lib/live` keeps it here
 *   with `setState`. Pages that never connect get the starter scenario (read-only).
 * - The models turn the two into what pages show: `conditions.ts` (power, water and air per
 *   block, graded from the points) and `sickness.ts` (lung-sickness reports per block).
 *
 * Pages read the data through `simulateFloor()`; `snapshot()` dumps it as plain data.
 */
import { conditionsOn, conditionTotals, type FloorConditions } from './conditions.js';
import { HOLLOW_SEED, LEVELS } from './data.js';
import { placesOn, type Place } from './nav.js';
import { starterScenario, withLocalIds } from './scenario.js';
import { sicknessOf, sicknessTotals as totals, type BlockSickness } from './sickness.js';
import type { BlockedTunnel, HollowState, PointKind, StatePoint } from './state.js';
import { createHollow, perFloorWith, type Floor, type Hollow } from './world.js';

export { SIM, streamSeed, type SimStream } from './simConfig.js';

let shared: Hollow | null = null;

/** The city every page shows, seeded with `HOLLOW_SEED`. Created once and shared. */
export const getHollow = (): Hollow => (shared ??= createHollow(HOLLOW_SEED));

let state: HollowState | null = null;

/** The state every page shows. Until `setState` is called: the starter scenario. */
export const currentState = (): HollowState =>
	(state ??= withLocalIds(starterScenario(getHollow())));

/** Replace the current state (`#lib/live` does this as Convex updates arrive). */
export function setState(next: HollowState) {
	state = next;
}

/** Everything simulated about one floor, for the current state. Parts compute on first use. */
export interface FloorSimulation {
	readonly floor: Floor;
	/** The city's state (all levels). */
	readonly state: HollowState;
	/** This floor's points and blocked tunnels. */
	readonly local: { points: StatePoint[]; blockedTunnels: BlockedTunnel[] };
	/** Every named place on the floor. */
	readonly places: Place[];
	/** Power, water and air scores per block, and each point's blocks. */
	readonly conditions: FloorConditions;
	/** Room id → score for that kind, 0 (good) to 1 (bad); null for rooms that aren't housing. */
	score(kind: PointKind): (number | null)[];
	/** Room id → lung-sickness reports (null for rooms that aren't housing). */
	readonly sickness: (BlockSickness | null)[];
	/** Tunnel tiles blocked on this floor ("x,y"). */
	readonly blocked: Set<string>;
}

const lazy = <T>(fn: () => T) => {
	let v: { value: T } | null = null;
	return () => (v ??= { value: fn() }).value;
};

const simulate = perFloorWith((floor: Floor, state: HollowState): FloorSimulation => {
	const on = <T extends { level: number }>(list: T[]) =>
		list.filter((e) => e.level === floor.index);
	const local = lazy(() => ({
		points: on(state.points),
		blockedTunnels: on(state.blockedTunnels)
	}));
	const blocked = lazy(
		() => new Set(local().blockedTunnels.flatMap((e) => e.tiles.map((t) => `${t.x},${t.y}`)))
	);
	const conditions = () => conditionsOn(floor, state.points);
	return {
		floor,
		state,
		get local() {
			return local();
		},
		get places() {
			return placesOn(floor);
		},
		get conditions() {
			return conditions();
		},
		score: (kind) => conditions().score[kind],
		get sickness() {
			return sicknessOf(floor, state.sickness);
		},
		get blocked() {
			return blocked();
		}
	};
});

/** Everything simulated about one floor, for the current state. */
export const simulateFloor = (floor: Floor): FloorSimulation => simulate(floor, currentState());

/** Lung-sickness reports summed over some floors. */
export const sicknessTotals = (floors: Floor[]) =>
	totals(floors.map((f) => simulateFloor(f).sickness));

/** Residents per power, water or air step over some floors (and how many are at a bad step). */
export const pointTotals = (floors: Floor[], kind: PointKind) =>
	conditionTotals(
		floors.map((f) => ({ floor: f, conditions: simulateFloor(f).conditions })),
		kind
	);

/** Blocked tunnels over some floors: how many, and how many tiles they close. */
export function blockedTotals(floors: Floor[]) {
	let count = 0;
	let tiles = 0;
	for (const f of floors) {
		const sim = simulateFloor(f);
		count += sim.local.blockedTunnels.length;
		tiles += sim.blocked.size;
	}
	return { count, tiles };
}

/**
 * Every simulated number for a city as plain, JSON-ready data. Builds every floor, so it is
 * slow the first time.
 */
export function snapshot(city: Hollow = getHollow()) {
	return {
		seed: city.seed,
		state: currentState(),
		levels: LEVELS.map((level) => {
			const sim = simulateFloor(city.floor(level.index));
			const { floor } = sim;
			return {
				level: level.code,
				residents: floor.residents,
				facilities: [...floor.facilities].map(([room, spec]) => ({ room, name: spec.name })),
				conditions: sim.conditions.score,
				sickness: sim.sickness
			};
		})
	};
}
