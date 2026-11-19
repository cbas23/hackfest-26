/**
 * The Hollow's simulated data, in one place: the shared city, its current events, and
 * everything derived from them. All of it is fictional.
 *
 * - The city (`getHollow()`): tunnels, rooms, facilities and residents, built in the browser
 *   from `HOLLOW_SEED`. It never changes.
 * - The events (`currentEvents()`): blackouts, air quality, water cuts, blocked tunnels and
 *   the sickness settings. They live in Convex and change over time; `#lib/live` keeps them
 *   here with `setEvents`. Pages that never connect get the starter scenario (read-only).
 * - The models turn the two into what pages show: `power.ts` (blackouts), `sensors.ts`
 *   (air, water and the stress model), `impact.ts`, `sickness.ts`, `water.ts` (tap-water
 *   health), `airflow.ts`, `alerts.ts`.
 *
 * Pages read the data through `simulateFloor()`; `snapshot()` dumps it as plain data.
 */
import { alertsOn, type FloorAlerts } from './alerts.js';
import { HOLLOW_SEED, LEVELS } from './data.js';
import { isActive, type HollowEvents } from './events.js';
import { assessImpact, type ImpactAssessment } from './impact.js';
import { placesOn, type Place } from './nav.js';
import { powerOn, type FloorPower } from './power.js';
import { starterScenario, withLocalIds } from './scenario.js';
import { facilityStatus, type FacilityStatus } from './sensors.js';
import { sicknessOf, sicknessTotals as totals, type BlockSickness } from './sickness.js';
import { waterHealthOf, waterTotals as wTotals, type BlockWater } from './water.js';
import { airflowOf, airflowTotals as aTotals, type BlockAirflow } from './airflow.js';
import { createHollow, perFloorWith, type Floor, type Hollow } from './world.js';

export { SIM, streamSeed, type SimStream } from './simConfig.js';

let shared: Hollow | null = null;

/** The city every page shows, seeded with `HOLLOW_SEED`. Created once and shared. */
export const getHollow = (): Hollow => (shared ??= createHollow(HOLLOW_SEED));

let events: HollowEvents | null = null;

/** The events every page shows. Until `setEvents` is called: the starter scenario. */
export const currentEvents = (): HollowEvents =>
	(events ??= withLocalIds(starterScenario(getHollow())));

/** Replace the current events (`#lib/live` does this as Convex updates arrive). */
export function setEvents(next: HollowEvents) {
	events = next;
}

/** A floor's events, active and resolved. */
export type FloorEvents = Omit<HollowEvents, 'sickness'>;

/** Everything simulated about one floor, for the current events. Parts compute on first use. */
export interface FloorSimulation {
	readonly floor: Floor;
	/** The city's events (all levels). */
	readonly events: HollowEvents;
	/** This floor's events. */
	readonly local: FloorEvents;
	/** Every named place on the floor. */
	readonly places: Place[];
	/** Which blocks have power, and each blackout's blocks. */
	readonly power: FloorPower;
	/** Room id → has power (shorthand for `power.lit`). */
	readonly lit: boolean[];
	readonly litShare: number;
	/** Room id → lung-sickness reports (null for rooms that aren't housing). */
	readonly sickness: (BlockSickness | null)[];
	/** Room id → tap-water health (null for rooms that aren't housing). */
	readonly water: (BlockWater | null)[];
	/** Room id → airflow (null for rooms that aren't housing). */
	readonly airflow: (BlockAirflow | null)[];
	/** Sensor readings of a place on this floor, or null if it has no sensors. */
	status(place: Place): FacilityStatus | null;
	/** What a monitored facility's status means for the residents who depend on it. */
	impact(place: Place): ImpactAssessment | null;
	/** Blackout, air and water alerts on the floor. */
	readonly alerts: FloorAlerts;
	/** Tunnel tiles blocked by an active event ("x,y"). */
	readonly blocked: Set<string>;
}

const lazy = <T>(fn: () => T) => {
	let v: { value: T } | null = null;
	return () => (v ??= { value: fn() }).value;
};

const simulate = perFloorWith((floor: Floor, events: HollowEvents): FloorSimulation => {
	const on = <T extends { level: number }>(list: T[]) =>
		list.filter((e) => e.level === floor.index);
	const local = lazy(() => ({
		blackouts: on(events.blackouts),
		airQuality: on(events.airQuality),
		waterCuts: on(events.waterCuts),
		blockedTunnels: on(events.blockedTunnels)
	}));
	const statuses = new Map<number, FacilityStatus | null>();
	const impacts = new Map<number, ImpactAssessment | null>();
	const status = (place: Place) => {
		if (!statuses.has(place.room.id))
			statuses.set(place.room.id, facilityStatus(floor, place, events));
		return statuses.get(place.room.id)!;
	};
	const alerts = lazy(() => alertsOn(sim));
	const blocked = lazy(
		() =>
			new Set(
				local()
					.blockedTunnels.filter(isActive)
					.flatMap((e) => e.tiles.map((t) => `${t.x},${t.y}`))
			)
	);
	const sim: FloorSimulation = {
		floor,
		events,
		get local() {
			return local();
		},
		get places() {
			return placesOn(floor);
		},
		get power() {
			return powerOn(floor, events.blackouts);
		},
		get lit() {
			return powerOn(floor, events.blackouts).lit;
		},
		get litShare() {
			return powerOn(floor, events.blackouts).litShare;
		},
		get sickness() {
			return sicknessOf(floor, events.sickness);
		},
		get water() {
			return waterHealthOf(floor, events.waterCuts);
		},
		get airflow() {
			return airflowOf(floor, events.airQuality);
		},
		status,
		impact(place) {
			if (!impacts.has(place.room.id))
				impacts.set(place.room.id, assessImpact(floor, place, status(place)));
			return impacts.get(place.room.id)!;
		},
		get alerts() {
			return alerts();
		},
		get blocked() {
			return blocked();
		}
	};
	return sim;
});

/** Everything simulated about one floor, for the current events. */
export const simulateFloor = (floor: Floor): FloorSimulation => simulate(floor, currentEvents());

/** Lung-sickness reports summed over some floors. */
export const sicknessTotals = (floors: Floor[]) =>
	totals(floors.map((f) => simulateFloor(f).sickness));

/** Tap-water health summed over some floors. */
export const waterTotals = (floors: Floor[]) =>
	wTotals(floors.map((f) => ({ floor: f, water: simulateFloor(f).water })));

/** Airflow summed over some floors. */
export const airflowTotals = (floors: Floor[]) =>
	aTotals(floors.map((f) => ({ floor: f, airflow: simulateFloor(f).airflow })));

/** Active blocked tunnels over some floors: how many, and how many tiles they close. */
export function blockedTotals(floors: Floor[]) {
	let count = 0;
	let tiles = 0;
	for (const f of floors) {
		const sim = simulateFloor(f);
		count += sim.local.blockedTunnels.filter(isActive).length;
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
		events: currentEvents(),
		levels: LEVELS.map((level) => {
			const sim = simulateFloor(city.floor(level.index));
			const { floor } = sim;
			return {
				level: level.code,
				powered: sim.lit,
				residents: floor.residents,
				facilities: [...floor.facilities].map(([room, spec]) => ({ room, name: spec.name })),
				sickness: sim.sickness,
				water: sim.water,
				airflow: sim.airflow,
				alerts: sim.alerts.alerts.map((a) => ({ ...a, place: a.place?.key })),
				sensors: sim.places.flatMap((place) => {
					const status = sim.status(place);
					if (!status) return [];
					const impact = sim.impact(place);
					return [
						{
							place: place.key,
							name: place.label,
							...status,
							dependent: impact?.dependentTotal ?? 0,
							affected: impact?.affectedTotal ?? 0
						}
					];
				})
			};
		})
	};
}
